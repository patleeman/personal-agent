import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cancelDurableRunFromDaemonMock,
  closeSyncMock,
  decorateDurableRunAttentionMock,
  decorateDurableRunsAttentionMock,
  existsSyncMock,
  followUpDurableRunFromDaemonMock,
  getDurableRunFromDaemonMock,
  listDurableRunsFromDaemonMock,
  openSyncMock,
  pingDaemonMock,
  readSyncMock,
  resolveDaemonPathsMock,
  resolveDurableRunsRootMock,
  rerunDurableRunFromDaemonMock,
  scanDurableRunMock,
  scanDurableRunsForRecoveryMock,
  statSyncMock,
  summarizeScannedDurableRunsMock,
} = vi.hoisted(() => ({
  cancelDurableRunFromDaemonMock: vi.fn(),
  closeSyncMock: vi.fn(),
  decorateDurableRunAttentionMock: vi.fn(),
  decorateDurableRunsAttentionMock: vi.fn(),
  existsSyncMock: vi.fn(),
  followUpDurableRunFromDaemonMock: vi.fn(),
  getDurableRunFromDaemonMock: vi.fn(),
  listDurableRunsFromDaemonMock: vi.fn(),
  openSyncMock: vi.fn(),
  pingDaemonMock: vi.fn(),
  readSyncMock: vi.fn(),
  resolveDaemonPathsMock: vi.fn(),
  resolveDurableRunsRootMock: vi.fn(),
  rerunDurableRunFromDaemonMock: vi.fn(),
  scanDurableRunMock: vi.fn(),
  scanDurableRunsForRecoveryMock: vi.fn(),
  statSyncMock: vi.fn(),
  summarizeScannedDurableRunsMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  closeSync: closeSyncMock,
  existsSync: existsSyncMock,
  openSync: openSyncMock,
  readSync: readSyncMock,
  statSync: statSyncMock,
}));

vi.mock('@personal-agent/daemon', () => ({
  cancelDurableRun: cancelDurableRunFromDaemonMock,
  followUpDurableRun: followUpDurableRunFromDaemonMock,
  getDurableRun: getDurableRunFromDaemonMock,
  listDurableRuns: listDurableRunsFromDaemonMock,
  pingDaemon: pingDaemonMock,
  resolveDaemonPaths: resolveDaemonPathsMock,
  resolveDurableRunsRoot: resolveDurableRunsRootMock,
  rerunDurableRun: rerunDurableRunFromDaemonMock,
  scanDurableRun: scanDurableRunMock,
  scanDurableRunsForRecovery: scanDurableRunsForRecoveryMock,
  summarizeScannedDurableRuns: summarizeScannedDurableRunsMock,
}));

vi.mock('./durableRunAttention.js', () => ({
  decorateDurableRunAttention: decorateDurableRunAttentionMock,
  decorateDurableRunsAttention: decorateDurableRunsAttentionMock,
}));

import {
  cancelDurableRun,
  clearDurableRunsListCache,
  followUpDurableRun,
  getDurableRun,
  getDurableRunLog,
  getDurableRunSnapshot,
  listDurableRuns,
  listDurableRunsWithTelemetry,
  rerunDurableRun,
} from './durableRuns.js';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createRun(runId: string, outputLogPath = `/tmp/${runId}.log`) {
  return {
    runId,
    status: 'running',
    paths: { outputLogPath },
  };
}

describe('durableRuns', () => {
  beforeEach(() => {
    cancelDurableRunFromDaemonMock.mockReset();
    closeSyncMock.mockReset();
    decorateDurableRunAttentionMock.mockReset();
    decorateDurableRunsAttentionMock.mockReset();
    existsSyncMock.mockReset();
    followUpDurableRunFromDaemonMock.mockReset();
    getDurableRunFromDaemonMock.mockReset();
    listDurableRunsFromDaemonMock.mockReset();
    openSyncMock.mockReset();
    pingDaemonMock.mockReset();
    readSyncMock.mockReset();
    resolveDaemonPathsMock.mockReset();
    resolveDurableRunsRootMock.mockReset();
    rerunDurableRunFromDaemonMock.mockReset();
    scanDurableRunMock.mockReset();
    scanDurableRunsForRecoveryMock.mockReset();
    statSyncMock.mockReset();
    summarizeScannedDurableRunsMock.mockReset();
    clearDurableRunsListCache();

    resolveDaemonPathsMock.mockReturnValue({ root: '/daemon-root' });
    resolveDurableRunsRootMock.mockImplementation((root: string) => `${root}/runs`);
    decorateDurableRunAttentionMock.mockImplementation((run: Record<string, unknown>) => ({
      ...run,
      decorated: true,
    }));
    decorateDurableRunsAttentionMock.mockImplementation((runs: Array<Record<string, unknown>>) => runs.map((run) => ({
      ...run,
      decorated: true,
    })));
  });

  it('lists durable runs via the daemon, reports inflight and hit telemetry, and decorates results', async () => {
    const deferred = createDeferred<{
      scannedAt: string;
      runs: Array<ReturnType<typeof createRun>>;
      summary: { totalRuns: number };
    }>();
    pingDaemonMock.mockResolvedValue(true);
    listDurableRunsFromDaemonMock.mockReturnValue(deferred.promise);

    const firstRequest = listDurableRunsWithTelemetry();
    const inflightRequest = listDurableRunsWithTelemetry();

    deferred.resolve({
      scannedAt: '2026-04-09T11:00:00.000Z',
      runs: [createRun('run-1')],
      summary: { totalRuns: 1 },
    });

    const firstResult = await firstRequest;
    const inflightResult = await inflightRequest;
    const cachedResult = await listDurableRunsWithTelemetry();

    expect(firstResult.result).toEqual({
      scannedAt: '2026-04-09T11:00:00.000Z',
      runs: [{ ...createRun('run-1'), decorated: true }],
      summary: { totalRuns: 1 },
      runsRoot: '/daemon-root/runs',
    });
    expect(firstResult.telemetry).toMatchObject({
      cache: 'miss',
      source: 'daemon',
      runCount: 1,
    });
    expect(inflightResult.telemetry).toMatchObject({
      cache: 'inflight',
      runCount: 1,
    });
    expect(cachedResult.telemetry).toMatchObject({
      cache: 'hit',
      source: 'daemon',
      runCount: 1,
    });
    await expect(listDurableRuns()).resolves.toEqual(firstResult.result);
  });

  it('falls back to scanned runs when the daemon is unavailable or disabled and clears the cache after unexpected failures', async () => {
    pingDaemonMock.mockRejectedValueOnce(new Error('ECONNREFUSED while connecting'));
    scanDurableRunsForRecoveryMock.mockReturnValue([createRun('scan-1')]);
    summarizeScannedDurableRunsMock.mockReturnValue({ totalRuns: 1 });

    await expect(listDurableRunsWithTelemetry()).resolves.toMatchObject({
      result: {
        runs: [{ ...createRun('scan-1'), decorated: true }],
        summary: { totalRuns: 1 },
        runsRoot: '/daemon-root/runs',
      },
      telemetry: {
        cache: 'miss',
        source: 'scan',
        runCount: 1,
      },
    });

    clearDurableRunsListCache();
    pingDaemonMock.mockRejectedValueOnce(new Error('daemon exploded'));
    await expect(listDurableRunsWithTelemetry()).rejects.toThrow('daemon exploded');

    pingDaemonMock.mockResolvedValue(false);
    scanDurableRunsForRecoveryMock.mockReturnValue([]);
    summarizeScannedDurableRunsMock.mockReturnValue({ totalRuns: 0 });
    await expect(listDurableRunsWithTelemetry()).resolves.toMatchObject({
      result: {
        runs: [],
        summary: { totalRuns: 0 },
        runsRoot: '/daemon-root/runs',
      },
      telemetry: {
        cache: 'miss',
        source: 'scan',
        runCount: 0,
      },
    });
  });

  it('gets durable runs from the daemon and handles missing, unavailable, and unexpected failures', async () => {
    pingDaemonMock.mockResolvedValue(true);
    getDurableRunFromDaemonMock.mockResolvedValueOnce({
      scannedAt: '2026-04-09T11:00:00.000Z',
      run: createRun('daemon-run'),
    });

    await expect(getDurableRun('daemon-run')).resolves.toEqual({
      scannedAt: '2026-04-09T11:00:00.000Z',
      run: { ...createRun('daemon-run'), decorated: true },
      runsRoot: '/daemon-root/runs',
    });

    getDurableRunFromDaemonMock.mockRejectedValueOnce(new Error('Run not found on daemon'));
    await expect(getDurableRun('missing-run')).resolves.toBeUndefined();

    getDurableRunFromDaemonMock.mockRejectedValueOnce(new Error('closed without response'));
    scanDurableRunMock.mockReturnValueOnce(createRun('scanned-run'));
    await expect(getDurableRun('scanned-run')).resolves.toEqual({
      scannedAt: expect.any(String),
      run: { ...createRun('scanned-run'), decorated: true },
      runsRoot: '/daemon-root/runs',
    });

    pingDaemonMock.mockResolvedValue(false);
    scanDurableRunMock.mockReturnValueOnce(undefined);
    await expect(getDurableRun('still-missing')).resolves.toBeUndefined();

    pingDaemonMock.mockResolvedValue(true);
    getDurableRunFromDaemonMock.mockRejectedValueOnce(new Error('boom'));
    await expect(getDurableRun('broken-run')).rejects.toThrow('boom');
  });

  it('reads durable run snapshots and log tails from files', async () => {
    pingDaemonMock.mockResolvedValue(false);
    scanDurableRunMock.mockReturnValue(createRun('run-log'));
    existsSyncMock.mockReturnValue(true);
    statSyncMock.mockReturnValue({ size: 13 });
    openSyncMock.mockReturnValue(7);
    readSyncMock.mockImplementation((_fd, buffer: Buffer) => {
      buffer.write('one\ntwo\nthree');
      return 13;
    });

    await expect(getDurableRunSnapshot('run-log', 2)).resolves.toEqual({
      detail: {
        scannedAt: expect.any(String),
        run: { ...createRun('run-log'), decorated: true },
        runsRoot: '/daemon-root/runs',
      },
      log: {
        path: '/tmp/run-log.log',
        log: 'two\nthree',
      },
    });
    await expect(getDurableRunLog('run-log', 1)).resolves.toEqual({
      path: '/tmp/run-log.log',
      log: 'three',
    });
    expect(closeSyncMock).toHaveBeenCalledWith(7);
  });

  it('returns empty log text when log files are missing, empty, or unreadable', async () => {
    pingDaemonMock.mockResolvedValue(false);
    scanDurableRunMock.mockReturnValue(createRun('run-log', '/tmp/missing.log'));

    existsSyncMock.mockReturnValue(false);
    await expect(getDurableRunSnapshot('run-log')).resolves.toMatchObject({
      log: { path: '/tmp/missing.log', log: '' },
    });

    existsSyncMock.mockReturnValue(true);
    statSyncMock.mockReturnValue({ size: 0 });
    await expect(getDurableRunSnapshot('run-log')).resolves.toMatchObject({
      log: { path: '/tmp/missing.log', log: '' },
    });
    expect(openSyncMock).not.toHaveBeenCalled();

    statSyncMock.mockReturnValue({ size: 8 });
    openSyncMock.mockReturnValue(9);
    readSyncMock.mockImplementation(() => {
      throw new Error('read failed');
    });
    await expect(getDurableRunSnapshot('run-log')).resolves.toMatchObject({
      log: { path: '/tmp/missing.log', log: '' },
    });
    expect(closeSyncMock).toHaveBeenCalledWith(9);

    scanDurableRunMock.mockReturnValue(undefined);
    await expect(getDurableRunSnapshot('missing-run')).resolves.toBeUndefined();
    await expect(getDurableRunLog('missing-run')).resolves.toBeUndefined();
  });

  it('proxies cancel, rerun, and follow-up operations to the daemon client', async () => {
    cancelDurableRunFromDaemonMock.mockResolvedValue({ cancelled: true });
    rerunDurableRunFromDaemonMock.mockResolvedValue({ accepted: true, runId: 'rerun-1' });
    followUpDurableRunFromDaemonMock.mockResolvedValue({ accepted: true, runId: 'follow-up-1' });

    await expect(cancelDurableRun('run-1')).resolves.toEqual({ cancelled: true });
    await expect(rerunDurableRun('run-1')).resolves.toEqual({ accepted: true, runId: 'rerun-1' });
    await expect(followUpDurableRun('run-1', 'Continue')).resolves.toEqual({ accepted: true, runId: 'follow-up-1' });

    expect(cancelDurableRunFromDaemonMock).toHaveBeenCalledWith('run-1');
    expect(rerunDurableRunFromDaemonMock).toHaveBeenCalledWith('run-1');
    expect(followUpDurableRunFromDaemonMock).toHaveBeenCalledWith('run-1', 'Continue');
  });
});
