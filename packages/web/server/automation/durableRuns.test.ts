import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { markDurableRunAttentionRead } from '@personal-agent/core';
import {
  PersonalAgentDaemon,
  createDurableRunManifest,
  createInitialDurableRunStatus,
  resolveDaemonPaths,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  saveDurableRunManifest,
  saveDurableRunStatus,
  type DaemonConfig,
} from '@personal-agent/daemon';
import { clearDurableRunsListCache, getDurableRun, listDurableRunsWithTelemetry, normalizeDurableRunLogTail, readDurableRunLogDelta } from './durableRuns.js';

const tempDirs: string[] = [];
const originalEnv = process.env;

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function createTestConfig(socketPath: string): DaemonConfig {
  return {
    logLevel: 'error',
    queue: { maxDepth: 100 },
    ipc: { socketPath },
    modules: {
      maintenance: {
        enabled: false,
        cleanupIntervalMinutes: 60,
      },
      tasks: {
        enabled: false,
        taskDir: join(createTempDir('tasks-'), 'definitions'),
        tickIntervalSeconds: 30,
        maxRetries: 3,
        reapAfterDays: 7,
        defaultTimeoutSeconds: 1800,
      },
    },
  };
}

describe('durable run reads', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = originalEnv;
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('does not floor fractional durable run log cursors', () => {
    const dir = createTempDir('pa-web-durable-run-log-delta-');
    const logPath = join(dir, 'run.log');
    writeFileSync(logPath, 'abcdef');

    expect(readDurableRunLogDelta(logPath, 1.5)).toEqual({
      path: logPath,
      delta: 'abcdef',
      nextCursor: 6,
      reset: false,
    });

    expect(readDurableRunLogDelta(logPath, Number.MAX_SAFE_INTEGER + 1)).toEqual({
      path: logPath,
      delta: 'abcdef',
      nextCursor: 6,
      reset: false,
    });
  });

  it('defaults malformed durable run log tails and caps expensive tails', () => {
    expect(normalizeDurableRunLogTail(25)).toBe(25);
    expect(normalizeDurableRunLogTail(25.5)).toBe(120);
    expect(normalizeDurableRunLogTail(Number.MAX_SAFE_INTEGER + 1)).toBe(120);
    expect(normalizeDurableRunLogTail(5000)).toBe(1000);
  });

  it('reports cache telemetry when durable runs fall back to filesystem scanning', async () => {
    const stateRoot = createTempDir('pa-web-durable-runs-cache-state-');
    const daemonSocketDir = createTempDir('pa-web-durable-runs-cache-sock-');
    const socketPath = join(daemonSocketDir, 'personal-agentd.sock');

    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
      PERSONAL_AGENT_DAEMON_SOCKET_PATH: socketPath,
    };

    const firstRead = await listDurableRunsWithTelemetry();
    expect(firstRead.result.runs).toEqual([]);
    expect(firstRead.telemetry).toMatchObject({
      cache: 'miss',
      source: 'scan',
      runCount: 0,
    });
    expect(firstRead.telemetry.durationMs).toBeGreaterThanOrEqual(0);

    const secondRead = await listDurableRunsWithTelemetry();
    expect(secondRead.result.runs).toEqual([]);
    expect(secondRead.telemetry).toMatchObject({
      cache: 'hit',
      source: 'scan',
      runCount: 0,
    });
    expect(secondRead.telemetry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('decorates runs with reviewed attention state from local storage', async () => {
    const stateRoot = createTempDir('pa-web-durable-runs-attention-state-');
    const daemonSocketDir = createTempDir('pa-web-durable-runs-attention-sock-');
    const socketPath = join(daemonSocketDir, 'personal-agentd.sock');

    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
      PERSONAL_AGENT_DAEMON_SOCKET_PATH: socketPath,
    };

    const runsRoot = resolveDurableRunsRoot(resolveDaemonPaths().root);
    const runPaths = resolveDurableRunPaths(runsRoot, 'run-review');
    saveDurableRunManifest(runPaths.manifestPath, createDurableRunManifest({
      id: 'run-review',
      kind: 'background-run',
      resumePolicy: 'manual',
      createdAt: '2026-03-24T12:00:00.000Z',
      source: {
        type: 'background-run',
        id: 'reviewable-work',
      },
    }));
    saveDurableRunStatus(runPaths.statusPath, createInitialDurableRunStatus({
      runId: 'run-review',
      status: 'waiting',
      createdAt: '2026-03-24T12:00:00.000Z',
      updatedAt: '2026-03-24T12:05:00.000Z',
      activeAttempt: 1,
      startedAt: '2026-03-24T12:01:00.000Z',
    }));

    clearDurableRunsListCache();
    const firstRead = await listDurableRunsWithTelemetry();
    const run = firstRead.result.runs.find((entry) => entry.runId === 'run-review') as ((typeof firstRead.result.runs)[number] & {
      attentionDismissed?: boolean;
      attentionSignature?: string | null;
    }) | undefined;
    expect(run).toBeDefined();
    expect(run?.attentionDismissed).toBe(false);
    expect(run?.attentionSignature).toBeTruthy();

    markDurableRunAttentionRead({
      stateRoot,
      runId: 'run-review',
      attentionSignature: run?.attentionSignature ?? '',
      readAt: '2026-03-24T12:06:00.000Z',
    });

    clearDurableRunsListCache();
    const secondRead = await listDurableRunsWithTelemetry();
    expect(secondRead.result.runs.find((entry) => entry.runId === 'run-review')).toMatchObject({
      attentionDismissed: true,
      attentionSignature: run?.attentionSignature,
    });
  });

  it('falls back to filesystem scan when daemon connection times out', async () => {
    const stateRoot = createTempDir('pa-web-durable-runs-timeout-state-');
    const daemonSocketDir = createTempDir('pa-web-durable-runs-timeout-sock-');
    const socketPath = join(daemonSocketDir, 'personal-agentd.sock');

    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
      PERSONAL_AGENT_DAEMON_SOCKET_PATH: socketPath,
    };

    clearDurableRunsListCache();
    // No daemon running — client should time out and fall back to scan
    const result = await listDurableRunsWithTelemetry();
    expect(result.telemetry.source).toBe('scan');
    expect(result.result.runs).toEqual([]);
  });

  it('falls back to filesystem scan when daemon socket is missing', async () => {
    const stateRoot = createTempDir('pa-web-durable-runs-nodaemon-state-');
    const daemonSocketDir = createTempDir('pa-web-durable-runs-nodaemon-sock-');
    const socketPath = join(daemonSocketDir, 'missing.sock');

    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
      PERSONAL_AGENT_DAEMON_SOCKET_PATH: socketPath,
    };

    clearDurableRunsListCache();
    const result = await listDurableRunsWithTelemetry();
    expect(result.telemetry.source).toBe('scan');
    expect(result.result.runs).toEqual([]);
  });

  it('returns undefined instead of throwing when daemon reports a missing run', async () => {
    const stateRoot = createTempDir('pa-web-durable-runs-state-');
    const daemonSocketDir = createTempDir('pa-web-durable-runs-sock-');
    const socketPath = join(daemonSocketDir, 'personal-agentd.sock');

    process.env = {
      ...originalEnv,
      PERSONAL_AGENT_STATE_ROOT: stateRoot,
      PERSONAL_AGENT_DAEMON_SOCKET_PATH: socketPath,
    };

    const daemon = new PersonalAgentDaemon(createTestConfig(socketPath));
    await daemon.start();

    try {
      await expect(getDurableRun('missing-run-id')).resolves.toBeUndefined();
    } finally {
      await daemon.stop();
    }
  });
});
