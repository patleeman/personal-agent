import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const childProcessMocks = vi.hoisted(() => ({
    spawnSync: vi.fn(),
}));
const daemonMocks = vi.hoisted(() => ({
    emitDaemonEvent: vi.fn(),
    getDaemonStatus: vi.fn(),
    loadDaemonConfig: vi.fn(),
    pingDaemon: vi.fn(),
    resolveDaemonPaths: vi.fn(),
}));
const resourcesMocks = vi.hoisted(() => ({
    getRepoRoot: vi.fn(),
}));
vi.mock('node:child_process', () => ({
    spawnSync: childProcessMocks.spawnSync,
}));
vi.mock('@personal-agent/daemon', () => ({
    emitDaemonEvent: daemonMocks.emitDaemonEvent,
    getDaemonStatus: daemonMocks.getDaemonStatus,
    loadDaemonConfig: daemonMocks.loadDaemonConfig,
    pingDaemon: daemonMocks.pingDaemon,
    resolveDaemonPaths: daemonMocks.resolveDaemonPaths,
}));
vi.mock('@personal-agent/resources', () => ({
    getRepoRoot: resourcesMocks.getRepoRoot,
}));
import { parseSyncSetupInput, readSyncState, requestSyncRunAndReadState, setupSyncAndReadState, } from './sync.js';
function buildDaemonConfig(repoDir) {
    return {
        ipc: {
            socketPath: join(repoDir, 'daemon.sock'),
        },
        modules: {
            sync: {
                enabled: true,
                repoDir,
                remote: 'origin',
                branch: 'main',
                intervalSeconds: 120,
                autoResolveWithAgent: true,
                conflictResolverTaskSlug: 'sync-conflict-resolver',
                resolverCooldownMinutes: 30,
                autoResolveErrorsWithAgent: true,
                errorResolverTaskSlug: 'sync-error-resolver',
                errorResolverCooldownMinutes: 30,
            },
        },
    };
}
describe('sync server helpers', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
        childProcessMocks.spawnSync.mockReset();
        daemonMocks.emitDaemonEvent.mockReset();
        daemonMocks.getDaemonStatus.mockReset();
        daemonMocks.loadDaemonConfig.mockReset();
        daemonMocks.pingDaemon.mockReset();
        daemonMocks.resolveDaemonPaths.mockReset();
        resourcesMocks.getRepoRoot.mockReset();
        resourcesMocks.getRepoRoot.mockReturnValue('/repo');
    });
    it('parses sync setup input with defaults', () => {
        const parsed = parseSyncSetupInput({ repoUrl: '  git@github.com:you/state.git  ' });
        expect(parsed).toEqual({
            repoUrl: 'git@github.com:you/state.git',
            branch: 'main',
            mode: 'fresh',
            repoDir: undefined,
        });
        expect(() => parseSyncSetupInput({ repoUrl: 'git@github.com:you/state.git', mode: 'invalid' }))
            .toThrow('mode must be "fresh" or "bootstrap" when provided');
    });
    it('returns warnings when repo is missing and daemon is offline', async () => {
        const root = mkdtempSync(join(tmpdir(), 'pa-sync-test-'));
        const repoDir = join(root, 'sync');
        const config = buildDaemonConfig(repoDir);
        daemonMocks.loadDaemonConfig.mockReturnValue(config);
        daemonMocks.resolveDaemonPaths.mockReturnValue({ logFile: join(root, 'daemon.log') });
        daemonMocks.pingDaemon.mockResolvedValue(false);
        const snapshot = await readSyncState();
        expect(snapshot.git.hasRepo).toBe(false);
        expect(snapshot.daemon.connected).toBe(false);
        expect(snapshot.warnings.some((warning) => warning.includes('not initialized'))).toBe(true);
        expect(snapshot.warnings.some((warning) => warning.includes('offline'))).toBe(true);
    });
    it('requests sync run through daemon and returns updated state', async () => {
        const root = mkdtempSync(join(tmpdir(), 'pa-sync-test-'));
        const repoDir = join(root, 'sync');
        const config = buildDaemonConfig(repoDir);
        daemonMocks.loadDaemonConfig.mockReturnValue(config);
        daemonMocks.resolveDaemonPaths.mockReturnValue({ logFile: join(root, 'daemon.log') });
        daemonMocks.pingDaemon.mockResolvedValue(true);
        daemonMocks.emitDaemonEvent.mockResolvedValue(true);
        daemonMocks.getDaemonStatus.mockResolvedValue({
            modules: [
                {
                    name: 'sync',
                    enabled: true,
                    detail: {
                        running: false,
                        lastRunAt: '2026-03-14T22:00:00.000Z',
                        lastSuccessAt: '2026-03-14T22:00:00.000Z',
                        lastConflictFiles: [],
                    },
                },
            ],
        });
        vi.useFakeTimers();
        const pending = requestSyncRunAndReadState();
        await vi.advanceTimersByTimeAsync(300);
        const snapshot = await pending;
        expect(daemonMocks.emitDaemonEvent).toHaveBeenCalledWith({
            type: 'sync.run.requested',
            source: 'web:sync',
            payload: {
                reason: 'manual-web',
            },
        }, config);
        expect(snapshot.daemon.connected).toBe(true);
        expect(snapshot.daemon.moduleLoaded).toBe(true);
        expect(snapshot.daemon.moduleEnabled).toBe(true);
    });
    it('runs sync setup via the CLI entrypoint and returns refreshed state', async () => {
        const root = mkdtempSync(join(tmpdir(), 'pa-sync-setup-test-'));
        const repoDir = join(root, 'sync');
        const config = buildDaemonConfig(repoDir);
        const cliEntry = join(root, 'packages', 'cli', 'dist', 'index.js');
        mkdirSync(dirname(cliEntry), { recursive: true });
        writeFileSync(cliEntry, 'console.log("ok");\n');
        resourcesMocks.getRepoRoot.mockReturnValue(root);
        childProcessMocks.spawnSync.mockReturnValue({ status: 0, stdout: 'ok', stderr: '' });
        daemonMocks.loadDaemonConfig.mockReturnValue(config);
        daemonMocks.resolveDaemonPaths.mockReturnValue({ logFile: join(root, 'daemon.log') });
        daemonMocks.pingDaemon.mockResolvedValue(false);
        const snapshot = await setupSyncAndReadState({
            repoUrl: 'git@github.com:you/personal-agent-state.git',
            branch: 'main',
            mode: 'fresh',
        });
        expect(childProcessMocks.spawnSync).toHaveBeenCalledWith(process.execPath, [
            cliEntry,
            'sync',
            'setup',
            '--repo',
            'git@github.com:you/personal-agent-state.git',
            '--branch',
            'main',
            '--fresh',
        ], expect.objectContaining({
            cwd: root,
            encoding: 'utf-8',
        }));
        expect(snapshot.config.repoDir).toBe(repoDir);
    });
    it('surfaces sync setup failures from the CLI command output', async () => {
        const root = mkdtempSync(join(tmpdir(), 'pa-sync-setup-test-'));
        const cliEntry = join(root, 'packages', 'cli', 'dist', 'index.js');
        mkdirSync(dirname(cliEntry), { recursive: true });
        writeFileSync(cliEntry, 'console.log("ok");\n');
        resourcesMocks.getRepoRoot.mockReturnValue(root);
        childProcessMocks.spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'push failed' });
        await expect(setupSyncAndReadState({
            repoUrl: 'git@github.com:you/personal-agent-state.git',
            branch: 'main',
            mode: 'fresh',
        })).rejects.toThrow('push failed');
    });
});
