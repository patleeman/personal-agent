import { spawn } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getStateRoot } from '@personal-agent/core';
import { getWebUiServiceStatus } from '@personal-agent/gateway';

const RESTART_LOCK_MAX_AGE_MS = 30 * 60 * 1000;

interface ApplicationRestartLock {
  pid?: number;
  requestedAt?: string;
  repoRoot?: string;
  profile?: string;
  port?: number;
  command?: string[];
}

export interface ApplicationRestartRequestResult {
  accepted: true;
  message: string;
  requestedAt: string;
  logFile: string;
}

function resolveApplicationRestartLockFile(): string {
  return join(getStateRoot(), 'web', 'app-restart.lock.json');
}

function resolveDefaultWebUiLogFile(): string {
  return join(getStateRoot(), 'web', 'logs', 'web.log');
}

function resolveCliEntryFile(repoRoot: string): string {
  return join(resolve(repoRoot), 'packages', 'cli', 'dist', 'index.js');
}

function readApplicationRestartLock(filePath: string): ApplicationRestartLock | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ApplicationRestartLock;
  } catch {
    return undefined;
  }
}

function isProcessRunning(pid: number | undefined): boolean {
  if (!Number.isInteger(pid) || (pid as number) <= 0) {
    return false;
  }

  try {
    process.kill(pid as number, 0);
    return true;
  } catch {
    return false;
  }
}

function ensureApplicationRestartNotRunning(lockFile: string): void {
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

export function requestApplicationRestart(input: {
  repoRoot: string;
  profile: string;
}): ApplicationRestartRequestResult {
  const repoRoot = resolve(input.repoRoot);
  const profile = input.profile.trim();
  if (profile.length === 0) {
    throw new Error('Application restart requires a profile.');
  }

  const webUiStatus = getWebUiServiceStatus({ repoRoot });

  if (!webUiStatus.installed) {
    throw new Error(
      'Managed web UI service is not installed. Install it from the Web UI page before restarting the application from inside the UI.',
    );
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

  writeFileSync(lockFile, `${JSON.stringify({ requestedAt, repoRoot, profile, port: webUiStatus.port, command }, null, 2)}\n`, {
    flag: 'wx',
  });

  let logFd: number | undefined;

  try {
    logFd = openSync(logFile, 'a');
    const child = spawn(process.execPath, [cliEntryFile, 'restart', '--rebuild'], {
      cwd: repoRoot,
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: {
        ...process.env,
        PERSONAL_AGENT_REPO_ROOT: repoRoot,
        PERSONAL_AGENT_RESTART_NOTIFY_INBOX: '1',
        PERSONAL_AGENT_RESTART_NOTIFY_PROFILE: profile,
        PERSONAL_AGENT_RESTART_REQUESTED_AT: requestedAt,
      },
    });

    if (!Number.isInteger(child.pid) || (child.pid as number) <= 0) {
      throw new Error('Detached restart process did not return a valid pid.');
    }

    child.unref();

    writeFileSync(lockFile, `${JSON.stringify({
      pid: child.pid,
      requestedAt,
      repoRoot,
      profile,
      port: webUiStatus.port,
      command,
    }, null, 2)}\n`);
  } catch (error) {
    rmSync(lockFile, { force: true });
    throw error;
  } finally {
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
