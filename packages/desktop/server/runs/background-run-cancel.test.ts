import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DaemonConfig } from '../config.js';
import { PersonalAgentDaemon } from '../daemon/server.js';
import { resolveDaemonPaths } from '../paths.js';
import { createBackgroundRunRecord } from './background-runs.js';
import { loadDurableRunStatus, resolveDurableRunsRoot } from './store.js';

const tempDirs: string[] = [];

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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('background run cancellation', () => {
  it('cancels durable shell command records even when they are not in the active process map', async () => {
    const socketPath = join(createTempDir('pa-daemon-cancel-'), 'daemon.sock');
    const config = createTestConfig(socketPath);
    const daemon = new PersonalAgentDaemon({ config, stopRequestBehavior: 'reject' });
    const runsRoot = resolveDurableRunsRoot(resolveDaemonPaths(socketPath).root);
    const record = await createBackgroundRunRecord(runsRoot, {
      taskSlug: 'test-run',
      cwd: '/tmp/test-run',
      shellCommand: 'npm test',
      createdAt: '2026-04-29T01:22:23.123Z',
    });

    await expect(daemon.cancelBackgroundRun(record.runId)).resolves.toEqual({
      cancelled: true,
      runId: record.runId,
    });

    expect(loadDurableRunStatus(record.paths.statusPath)).toEqual(
      expect.objectContaining({
        status: 'cancelled',
        checkpointKey: 'cancelled',
      }),
    );
  });
});
