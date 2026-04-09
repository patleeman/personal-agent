import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeActivityDbs, listProfileActivityEntries, resolveProfileActivityDbPath } from '@personal-agent/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonStateSnapshot } from '../automation/daemon.js';
import {
  classifyDaemonAttentionState,
  clearMonitoredServiceAttentionSuppression,
  createServiceAttentionMonitor,
  suppressMonitoredServiceAttention,
  writeInternalAttentionEntry,
} from './internalAttention.js';

function createDaemonSnapshot(input: {
  running: boolean;
  installed?: boolean;
  warnings?: string[];
  serviceError?: string;
}): DaemonStateSnapshot {
  return {
    warnings: input.warnings ?? [],
    service: {
      platform: 'launchd',
      identifier: 'personal-agent-daemon',
      manifestPath: '/tmp/personal-agent-daemon.plist',
      installed: input.installed ?? true,
      running: input.running,
      ...(input.serviceError ? { error: input.serviceError } : {}),
    },
    runtime: {
      running: input.running,
      socketPath: '/tmp/personal-agentd.sock',
      moduleCount: input.running ? 4 : 0,
    },
    log: {
      path: '/tmp/personal-agentd.log',
      lines: [],
    },
  };
}

const tempDirs: string[] = [];

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-internal-attention-'));
  tempDirs.push(dir);
  return dir;
}

const flushAsyncWork = async () => {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
};

describe('internalAttention', () => {
  afterEach(async () => {
    clearMonitoredServiceAttentionSuppression();
    closeActivityDbs();
    vi.useRealTimers();
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('writes internal attention activity entries with sanitized ids and stored details', () => {
    const stateRoot = createTempStateRoot();
    const createdAt = '2026-03-13T12:00:00.000Z';

    const path = writeInternalAttentionEntry({
      repoRoot: '/repo',
      stateRoot,
      profile: 'assistant',
      kind: 'service',
      summary: 'Daemon recovered!!!',
      details: 'Recovered after a short restart.',
      createdAt,
    });

    expect(path).toBe(`${resolveProfileActivityDbPath({ stateRoot, profile: 'assistant' })}#activity/service-2026-03-13t12-00-00-000z-daemon-recovered`);
    expect(listProfileActivityEntries({ stateRoot, profile: 'assistant' }).map(({ entry }) => entry)).toEqual([
      {
        id: 'service-2026-03-13t12-00-00-000z-daemon-recovered',
        createdAt,
        profile: 'assistant',
        kind: 'service',
        summary: 'Daemon recovered!!!',
        details: 'Recovered after a short restart.',
        relatedProjectIds: undefined,
        notificationState: 'none',
      },
    ]);
  });

  it('classifies daemon attention states across healthy, inspection, offline, and inactive cases', () => {
    expect(classifyDaemonAttentionState(createDaemonSnapshot({ running: true }))).toEqual({
      key: 'healthy',
      label: 'healthy',
    });

    expect(classifyDaemonAttentionState(createDaemonSnapshot({ running: false, serviceError: 'launchctl failed' }))).toEqual({
      key: 'issue:inspection',
      label: 'inspection error',
      details: undefined,
    });

    expect(classifyDaemonAttentionState(createDaemonSnapshot({
      running: false,
      warnings: ['Could not inspect daemon runtime: timeout', 'Daemon runtime is not responding on the local socket.'],
    }))).toEqual({
      key: 'issue:inspection',
      label: 'inspection error',
      details: 'Could not inspect daemon runtime: timeout\nDaemon runtime is not responding on the local socket.',
    });

    expect(classifyDaemonAttentionState(createDaemonSnapshot({
      running: false,
      warnings: ['Daemon runtime is not responding on the local socket.'],
    }))).toEqual({
      key: 'issue:offline',
      label: 'offline',
      details: 'Daemon runtime is not responding on the local socket.',
    });

    expect(classifyDaemonAttentionState(createDaemonSnapshot({ running: false, installed: false }))).toEqual({
      key: 'inactive',
      label: 'inactive',
    });
  });

  it('does not write daemon issue or recovery activity for brief restarts', async () => {
    let nowMs = Date.parse('2026-03-13T12:00:00.000Z');
    const writeEntry = vi.fn();
    const snapshots = [
      createDaemonSnapshot({ running: false, warnings: ['Daemon runtime is not responding on the local socket.'] }),
      createDaemonSnapshot({ running: false, warnings: ['Daemon runtime is not responding on the local socket.'] }),
      createDaemonSnapshot({ running: true }),
    ];

    const monitor = createServiceAttentionMonitor({
      repoRoot: '/repo',
      stateRoot: '/state',
      getCurrentProfile: () => 'assistant',
      readDaemonState: vi.fn(async () => snapshots.shift() ?? createDaemonSnapshot({ running: true })),
      writeEntry,
      now: () => new Date(nowMs),
    });

    await monitor.tick();
    nowMs += 30_000;
    await monitor.tick();
    nowMs += 10_000;
    await monitor.tick();

    expect(writeEntry).not.toHaveBeenCalled();
  });

  it('suppresses daemon issue and recovery entries until the suppression window expires', async () => {
    let nowMs = Date.parse('2026-03-13T12:00:00.000Z');
    const writeEntry = vi.fn();
    const snapshots = [
      createDaemonSnapshot({ running: false, warnings: ['Daemon runtime is not responding on the local socket.'] }),
      createDaemonSnapshot({ running: false, warnings: ['Daemon runtime is not responding on the local socket.'] }),
      createDaemonSnapshot({ running: true }),
      createDaemonSnapshot({ running: false, warnings: ['Daemon runtime is not responding on the local socket.'] }),
      createDaemonSnapshot({ running: false, warnings: ['Daemon runtime is not responding on the local socket.'] }),
      createDaemonSnapshot({ running: true }),
    ];

    vi.spyOn(Date, 'now').mockImplementation(() => nowMs);
    suppressMonitoredServiceAttention('daemon', 30_000);

    const monitor = createServiceAttentionMonitor({
      repoRoot: '/repo',
      stateRoot: '/state',
      getCurrentProfile: () => 'assistant',
      readDaemonState: vi.fn(async () => snapshots.shift() ?? createDaemonSnapshot({ running: true })),
      writeEntry,
      now: () => new Date(nowMs),
      issueGraceMs: 0,
    });

    await monitor.tick();
    nowMs += 5_000;
    await monitor.tick();
    nowMs += 5_000;
    await monitor.tick();

    nowMs += 31_000;
    await monitor.tick();
    nowMs += 1;
    await monitor.tick();
    nowMs += 1;
    await monitor.tick();

    expect(writeEntry).toHaveBeenCalledTimes(2);
    expect(writeEntry.mock.calls[0]?.[0]).toMatchObject({
      summary: 'Daemon is offline.',
      idPrefix: 'daemon-issue',
    });
    expect(writeEntry.mock.calls[1]?.[0]).toMatchObject({
      summary: 'Daemon recovered.',
      idPrefix: 'daemon-recovery',
    });
  });

  it('writes daemon issue and recovery activity when the outage persists', async () => {
    let nowMs = Date.parse('2026-03-13T12:00:00.000Z');
    const writeEntry = vi.fn();
    const snapshots = [
      createDaemonSnapshot({ running: false, warnings: ['Daemon runtime is not responding on the local socket.'] }),
      createDaemonSnapshot({ running: false, warnings: ['Daemon runtime is not responding on the local socket.'] }),
      createDaemonSnapshot({ running: true }),
    ];

    const monitor = createServiceAttentionMonitor({
      repoRoot: '/repo',
      stateRoot: '/state',
      getCurrentProfile: () => 'assistant',
      readDaemonState: vi.fn(async () => snapshots.shift() ?? createDaemonSnapshot({ running: true })),
      writeEntry,
      now: () => new Date(nowMs),
    });

    await monitor.tick();
    nowMs += 61_000;
    await monitor.tick();
    nowMs += 5_000;
    await monitor.tick();

    expect(writeEntry).toHaveBeenCalledTimes(2);
    expect(writeEntry.mock.calls[0]?.[0]).toMatchObject({
      profile: 'assistant',
      kind: 'service',
      summary: 'Daemon is offline.',
      idPrefix: 'daemon-issue',
    });
    expect(writeEntry.mock.calls[1]?.[0]).toMatchObject({
      profile: 'assistant',
      kind: 'service',
      summary: 'Daemon recovered.',
      idPrefix: 'daemon-recovery',
    });
  });

  it('logs polling failures and only starts one interval at a time', async () => {
    vi.useFakeTimers();
    const logger = { warn: vi.fn() };
    const readDaemonState = vi.fn()
      .mockRejectedValueOnce(new Error('poll failed'))
      .mockResolvedValue(createDaemonSnapshot({ running: true }));

    const monitor = createServiceAttentionMonitor({
      repoRoot: '/repo',
      stateRoot: '/state',
      getCurrentProfile: () => 'assistant',
      readDaemonState,
      logger,
    });

    await monitor.tick();
    expect(logger.warn).toHaveBeenCalledWith('internal attention daemon poll failed', { message: 'poll failed' });

    monitor.start();
    monitor.start();
    await flushAsyncWork();
    expect(readDaemonState).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(20_000);
    await flushAsyncWork();
    expect(readDaemonState).toHaveBeenCalledTimes(4);

    monitor.stop();
    monitor.stop();
    await vi.advanceTimersByTimeAsync(20_000);
    await flushAsyncWork();
    expect(readDaemonState).toHaveBeenCalledTimes(4);
  });
});
