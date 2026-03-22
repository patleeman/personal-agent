import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDurableRun, listDurableRunsWithTelemetry } from './durableRuns.js';
import { PersonalAgentDaemon, type DaemonConfig } from '@personal-agent/daemon';

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
