import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const daemonMocks = vi.hoisted(() => ({
    emitDaemonEvent: vi.fn(),
    getDaemonStatus: vi.fn(),
    loadDaemonConfig: vi.fn(),
    pingDaemon: vi.fn(),
    resolveDaemonPaths: vi.fn(),
}));
vi.mock('@personal-agent/daemon', () => ({
    emitDaemonEvent: daemonMocks.emitDaemonEvent,
    getDaemonStatus: daemonMocks.getDaemonStatus,
    loadDaemonConfig: daemonMocks.loadDaemonConfig,
    pingDaemon: daemonMocks.pingDaemon,
    resolveDaemonPaths: daemonMocks.resolveDaemonPaths,
}));
import { readSyncState, requestSyncRunAndReadState } from './sync.js';
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
        daemonMocks.emitDaemonEvent.mockReset();
        daemonMocks.getDaemonStatus.mockReset();
        daemonMocks.loadDaemonConfig.mockReset();
        daemonMocks.pingDaemon.mockReset();
        daemonMocks.resolveDaemonPaths.mockReset();
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
});
