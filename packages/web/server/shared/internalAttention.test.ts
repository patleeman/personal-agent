import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonStateSnapshot } from '../automation/daemon.js';
import {
  clearMonitoredServiceAttentionSuppression,
  createServiceAttentionMonitor,
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

describe('internalAttention', () => {
  afterEach(() => {
    clearMonitoredServiceAttentionSuppression();
    vi.restoreAllMocks();
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
});
