import { spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readSync, statSync, } from 'node:fs';
import { join } from 'node:path';
import { emitDaemonEvent, getDaemonStatus, loadDaemonConfig, pingDaemon, resolveDaemonPaths, } from '@personal-agent/daemon';
function readTailLines(filePath, maxLines = 80, maxBytes = 96 * 1024) {
    if (!filePath || !existsSync(filePath)) {
        return [];
    }
    let fd;
    try {
        const stats = statSync(filePath);
        const readLength = Math.min(maxBytes, stats.size);
        if (readLength <= 0) {
            return [];
        }
        const buffer = Buffer.alloc(readLength);
        fd = openSync(filePath, 'r');
        readSync(fd, buffer, 0, readLength, stats.size - readLength);
        return buffer
            .toString('utf-8')
            .split(/\r?\n/)
            .map((line) => line.trimEnd())
            .filter((line) => line.length > 0)
            .slice(-maxLines);
    }
    catch {
        return [];
    }
    finally {
        if (fd !== undefined) {
            closeSync(fd);
        }
    }
}
function runGit(repoDir, args, allowFailure = false) {
    const result = spawnSync('git', ['-C', repoDir, ...args], {
        encoding: 'utf-8',
    });
    if (result.error) {
        throw result.error;
    }
    const code = result.status ?? 1;
    const stdout = (result.stdout ?? '').trim();
    const stderr = (result.stderr ?? '').trim();
    if (!allowFailure && code !== 0) {
        throw new Error(stderr || stdout || `git ${args.join(' ')} failed with exit code ${code}`);
    }
    return { code, stdout, stderr };
}
function toOptionalString(value) {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function toStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
        .filter((entry) => entry.length > 0);
}
function parseSyncModuleDetail(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    const record = value;
    return {
        running: record.running === true,
        lastRunAt: toOptionalString(record.lastRunAt),
        lastSuccessAt: toOptionalString(record.lastSuccessAt),
        lastCommitAt: toOptionalString(record.lastCommitAt),
        lastConflictAt: toOptionalString(record.lastConflictAt),
        lastConflictFiles: toStringArray(record.lastConflictFiles),
        lastResolverStartedAt: toOptionalString(record.lastResolverStartedAt),
        lastResolverResult: toOptionalString(record.lastResolverResult),
        lastErrorResolverStartedAt: toOptionalString(record.lastErrorResolverStartedAt),
        lastErrorResolverResult: toOptionalString(record.lastErrorResolverResult),
        lastError: toOptionalString(record.lastError),
    };
}
function readSyncGitSummary(repoDir, remote) {
    const normalizedRepoDir = repoDir.trim();
    if (normalizedRepoDir.length === 0) {
        return {
            hasRepo: false,
        };
    }
    const gitDir = join(normalizedRepoDir, '.git');
    if (!existsSync(gitDir)) {
        return {
            hasRepo: false,
        };
    }
    const branch = runGit(normalizedRepoDir, ['rev-parse', '--abbrev-ref', 'HEAD'], true);
    const status = runGit(normalizedRepoDir, ['status', '--porcelain'], true);
    const lastCommit = runGit(normalizedRepoDir, ['log', '-1', '--pretty=%h %ad %s', '--date=iso'], true);
    const remoteUrl = runGit(normalizedRepoDir, ['remote', 'get-url', remote], true);
    return {
        hasRepo: true,
        currentBranch: branch.code === 0 ? branch.stdout || undefined : undefined,
        dirtyEntries: status.code === 0
            ? (status.stdout.length > 0 ? status.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length : 0)
            : undefined,
        lastCommit: lastCommit.code === 0 ? lastCommit.stdout || undefined : undefined,
        remoteUrl: remoteUrl.code === 0 ? remoteUrl.stdout || undefined : undefined,
    };
}
async function readSyncDaemonSummary() {
    const config = loadDaemonConfig();
    if (!(await pingDaemon(config))) {
        return {
            connected: false,
            moduleLoaded: false,
            moduleEnabled: false,
        };
    }
    const status = await getDaemonStatus(config);
    const moduleEntry = status.modules.find((entry) => entry.name === 'sync');
    return {
        connected: true,
        moduleLoaded: Boolean(moduleEntry),
        moduleEnabled: moduleEntry?.enabled === true,
        moduleDetail: parseSyncModuleDetail(moduleEntry?.detail),
    };
}
function readSyncConfig() {
    const config = loadDaemonConfig();
    const sync = config.modules.sync;
    return {
        enabled: sync?.enabled === true,
        repoDir: sync?.repoDir ?? '',
        remote: sync?.remote ?? 'origin',
        branch: sync?.branch ?? 'main',
        intervalSeconds: typeof sync?.intervalSeconds === 'number' ? sync.intervalSeconds : 120,
        autoResolveWithAgent: sync?.autoResolveWithAgent !== false,
        conflictResolverTaskSlug: sync?.conflictResolverTaskSlug ?? 'sync-conflict-resolver',
        resolverCooldownMinutes: typeof sync?.resolverCooldownMinutes === 'number' ? sync.resolverCooldownMinutes : 30,
        autoResolveErrorsWithAgent: sync?.autoResolveErrorsWithAgent !== false,
        errorResolverTaskSlug: sync?.errorResolverTaskSlug ?? 'sync-error-resolver',
        errorResolverCooldownMinutes: typeof sync?.errorResolverCooldownMinutes === 'number' ? sync.errorResolverCooldownMinutes : 30,
    };
}
function buildWarnings(input) {
    const warnings = [];
    if (!input.config.enabled) {
        warnings.push('Sync module is disabled in daemon configuration.');
    }
    if (!input.git.hasRepo) {
        warnings.push(`Sync repo is not initialized at ${input.config.repoDir}. Run "pa sync setup --repo <git-url> --fresh".`);
    }
    if (!input.daemon.connected) {
        warnings.push('Daemon is offline; automatic sync is not running.');
    }
    else if (!input.daemon.moduleLoaded) {
        warnings.push('Daemon does not report the sync module. Restart daemon after upgrading.');
    }
    if (input.daemon.moduleDetail?.lastConflictFiles.length) {
        warnings.push(`Sync has unresolved conflicts in ${input.daemon.moduleDetail.lastConflictFiles.length} file(s).`);
    }
    if (input.daemon.moduleDetail?.lastError) {
        warnings.push(`Last sync error: ${input.daemon.moduleDetail.lastError}`);
    }
    return warnings;
}
export async function readSyncState() {
    const config = readSyncConfig();
    const git = readSyncGitSummary(config.repoDir, config.remote);
    const daemon = await readSyncDaemonSummary();
    const daemonPaths = resolveDaemonPaths(loadDaemonConfig().ipc.socketPath);
    return {
        warnings: buildWarnings({ config, git, daemon }),
        config,
        git,
        daemon,
        log: {
            path: daemonPaths.logFile,
            lines: readTailLines(daemonPaths.logFile).filter((line) => line.includes('[module:sync]') || line.includes('sync ')).slice(-60),
        },
    };
}
export async function requestSyncRunAndReadState() {
    const config = loadDaemonConfig();
    if (!(await pingDaemon(config))) {
        throw new Error('Daemon is offline. Start it from the Daemon page or run "pa daemon start".');
    }
    const accepted = await emitDaemonEvent({
        type: 'sync.run.requested',
        source: 'web:sync',
        payload: {
            reason: 'manual-web',
        },
    }, config);
    if (!accepted) {
        throw new Error('Daemon queue is full; sync run was not accepted. Try again in a moment.');
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    return readSyncState();
}
