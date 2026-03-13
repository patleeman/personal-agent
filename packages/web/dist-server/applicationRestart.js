import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync, } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getStateRoot } from '@personal-agent/core';
import { getWebUiServiceStatus } from '@personal-agent/gateway';
const RESTART_LOCK_MAX_AGE_MS = 30 * 60 * 1000;
function resolveApplicationRestartLockFile() {
    return join(getStateRoot(), 'web', 'app-restart.lock.json');
}
function resolveDefaultWebUiLogFile() {
    return join(getStateRoot(), 'web', 'logs', 'web.log');
}
function resolveCliEntryFile(repoRoot) {
    return join(resolve(repoRoot), 'packages', 'cli', 'dist', 'index.js');
}
function readApplicationRestartLock(filePath) {
    if (!existsSync(filePath)) {
        return undefined;
    }
    try {
        return JSON.parse(readFileSync(filePath, 'utf-8'));
    }
    catch {
        return undefined;
    }
}
function isProcessRunning(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function ensureApplicationRestartNotRunning(lockFile) {
    const current = readApplicationRestartLock(lockFile);
    if (!current) {
        if (existsSync(lockFile)) {
            rmSync(lockFile, { force: true });
        }
        return;
    }
    const requestedAtMs = typeof current.requestedAt === 'string'
        ? Date.parse(current.requestedAt)
        : Number.NaN;
    const staleByAge = Number.isFinite(requestedAtMs)
        ? (Date.now() - requestedAtMs) > RESTART_LOCK_MAX_AGE_MS
        : true;
    if (isProcessRunning(current.pid) && !staleByAge) {
        const suffix = current.requestedAt ? ` (${current.requestedAt})` : '';
        throw new Error(`Application restart already in progress${suffix}.`);
    }
    rmSync(lockFile, { force: true });
}
export function requestApplicationRestart(input) {
    const repoRoot = resolve(input.repoRoot);
    const webUiStatus = getWebUiServiceStatus({ repoRoot });
    if (!webUiStatus.installed) {
        throw new Error('Managed web UI service is not installed. Install it from the Web UI page before restarting the application from inside the UI.');
    }
    const cliEntryFile = resolveCliEntryFile(repoRoot);
    if (!existsSync(cliEntryFile)) {
        throw new Error(`CLI entrypoint is not built: ${cliEntryFile}`);
    }
    const lockFile = resolveApplicationRestartLockFile();
    mkdirSync(dirname(lockFile), { recursive: true });
    ensureApplicationRestartNotRunning(lockFile);
    const logFile = webUiStatus.logFile ?? resolveDefaultWebUiLogFile();
    mkdirSync(dirname(logFile), { recursive: true });
    const requestedAt = new Date().toISOString();
    const command = [process.execPath, cliEntryFile, 'restart', '--rebuild'];
    writeFileSync(lockFile, `${JSON.stringify({ requestedAt, repoRoot, port: webUiStatus.port, command }, null, 2)}\n`, {
        flag: 'wx',
    });
    let logFd;
    try {
        logFd = openSync(logFile, 'a');
        const child = spawn(process.execPath, [cliEntryFile, 'restart', '--rebuild'], {
            cwd: repoRoot,
            detached: true,
            stdio: ['ignore', logFd, logFd],
            env: {
                ...process.env,
                PERSONAL_AGENT_REPO_ROOT: repoRoot,
            },
        });
        if (!Number.isInteger(child.pid) || child.pid <= 0) {
            throw new Error('Detached restart process did not return a valid pid.');
        }
        child.unref();
        writeFileSync(lockFile, `${JSON.stringify({
            pid: child.pid,
            requestedAt,
            repoRoot,
            port: webUiStatus.port,
            command,
        }, null, 2)}\n`);
    }
    catch (error) {
        rmSync(lockFile, { force: true });
        throw error;
    }
    finally {
        if (logFd !== undefined) {
            closeSync(logFd);
        }
    }
    return {
        accepted: true,
        message: 'Application restart requested. Rebuilding packages and restarting background services.',
        requestedAt,
        logFile,
    };
}
