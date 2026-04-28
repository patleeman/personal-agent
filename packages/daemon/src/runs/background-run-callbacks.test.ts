import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  loadDeferredResumeState,
  resolveDeferredResumeStateFile,
} from '@personal-agent/core';
import { describe, expect, it } from 'vitest';
import { createBackgroundRunRecord, finalizeBackgroundRun } from './background-runs.js';
import { deliverBackgroundRunCallbackWakeup } from './background-run-callbacks.js';
import { surfaceBackgroundRunResultsIfReady } from './background-run-deferred-resumes.js';
import { loadDurableRunCheckpoint, loadDurableRunStatus, resolveDurableRunPaths, resolveDurableRunsRoot, saveDurableRunStatus } from './store.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function createFinishedBackgroundRun(input: {
  daemonRoot: string;
  sessionFile: string;
  taskSlug: string;
  endedAt: string;
  exitCode?: number;
  cancelled?: boolean;
}): Promise<{ runId: string; checkpointPath: string }> {
  const record = await createBackgroundRunRecord(input.daemonRoot, {
    taskSlug: input.taskSlug,
    cwd: createTempDir('bg-run-callback-cwd-'),
    argv: [process.execPath, '-e', 'console.log("done")'],
    source: {
      type: 'tool',
      id: 'conv-123',
      filePath: input.sessionFile,
    },
    callbackConversation: {
      conversationId: 'conv-123',
      sessionFile: input.sessionFile,
      profile: 'shared',
      repoRoot: '/repo',
    },
    checkpointPayload: {
      resumeParentOnExit: true,
    },
    createdAt: '2026-04-04T01:00:00.000Z',
  });

  await finalizeBackgroundRun({
    runId: record.runId,
    runPaths: record.paths,
    taskSlug: input.taskSlug,
    cwd: createTempDir('bg-run-callback-finished-cwd-'),
    startedAt: '2026-04-04T01:00:01.000Z',
    endedAt: input.endedAt,
    exitCode: input.exitCode ?? 0,
    signal: null,
    cancelled: input.cancelled ?? false,
  });

  return {
    runId: record.runId,
    checkpointPath: record.paths.checkpointPath,
  };
}

describe('background run callbacks', () => {
  it('creates a ready wakeup for callback-bound runs', async () => {
    const daemonRoot = createTempDir('pa-background-run-callback-daemon-');
    const stateRoot = createTempDir('pa-background-run-callback-state-');
    const runsRoot = join(daemonRoot, 'runs');
    const sessionFile = '/tmp/conversations/callback.jsonl';

    const run = await createFinishedBackgroundRun({
      daemonRoot,
      sessionFile,
      taskSlug: 'wiki-raw-activity-drain',
      endedAt: '2026-04-04T01:05:00.000Z',
    });

    const delivered = await deliverBackgroundRunCallbackWakeup({
      daemonRoot,
      stateRoot,
      runsRoot,
      runId: run.runId,
    });

    expect(delivered).toEqual({
      delivered: true,
      wakeupId: expect.stringContaining('background-run-'),
      conversationId: 'conv-123',
    });

    const deferredState = loadDeferredResumeState(resolveDeferredResumeStateFile(stateRoot));
    const wakeup = deferredState.resumes[delivered.wakeupId ?? ''];
    expect(wakeup).toEqual(expect.objectContaining({
      id: delivered.wakeupId,
      sessionFile,
      status: 'ready',
      title: 'Background run wiki-raw-activity-drain completed',
      source: {
        kind: 'background-run',
        id: run.runId,
      },
      delivery: expect.objectContaining({
        alertLevel: 'passive',
        autoResumeIfOpen: true,
        requireAck: false,
      }),
    }));
    expect(wakeup?.prompt).toContain(run.runId);
    expect(wakeup?.prompt).toContain('taskSlug=wiki-raw-activity-drain');

    const checkpoint = loadDurableRunCheckpoint(run.checkpointPath);
    expect(checkpoint?.payload?.backgroundRunCallback).toEqual({
      wakeupId: delivered.wakeupId,
      deliveredAt: '2026-04-04T01:05:00.000Z',
    });
  });

  it('keeps callback wakeups deliverable when status timestamps are malformed', async () => {
    const daemonRoot = createTempDir('pa-background-run-callback-daemon-');
    const stateRoot = createTempDir('pa-background-run-callback-state-');
    const runsRoot = join(daemonRoot, 'runs');
    const sessionFile = '/tmp/conversations/callback-invalid-time.jsonl';

    const run = await createFinishedBackgroundRun({
      daemonRoot,
      sessionFile,
      taskSlug: 'invalid-time-callback',
      endedAt: '2026-04-04T01:05:00.000Z',
    });
    const paths = resolveDurableRunPaths(resolveDurableRunsRoot(daemonRoot), run.runId);
    const status = loadDurableRunStatus(paths.statusPath);
    saveDurableRunStatus(paths.statusPath, {
      ...status!,
      completedAt: 'not-a-date',
      updatedAt: 'also-not-a-date',
    });

    const delivered = await deliverBackgroundRunCallbackWakeup({
      daemonRoot,
      stateRoot,
      runsRoot,
      runId: run.runId,
    });

    const deferredState = loadDeferredResumeState(resolveDeferredResumeStateFile(stateRoot));
    const wakeup = deferredState.resumes[delivered.wakeupId ?? ''];
    expect(delivered.delivered).toBe(true);
    expect(wakeup).toEqual(expect.objectContaining({
      id: delivered.wakeupId,
      status: 'ready',
      source: {
        kind: 'background-run',
        id: run.runId,
      },
    }));
    expect(Number.isFinite(Date.parse(wakeup?.dueAt ?? ''))).toBe(true);
    expect(Number.isFinite(Date.parse(wakeup?.readyAt ?? ''))).toBe(true);
    expect(Number.isFinite(Date.parse(wakeup?.createdAt ?? ''))).toBe(true);
  });

  it('does not also surface hidden background-run context after callback delivery', async () => {
    const daemonRoot = createTempDir('pa-background-run-callback-daemon-');
    const stateRoot = createTempDir('pa-background-run-callback-state-');
    const runsRoot = join(daemonRoot, 'runs');
    const sessionFile = '/tmp/conversations/callback-hidden.jsonl';

    const run = await createFinishedBackgroundRun({
      daemonRoot,
      sessionFile,
      taskSlug: 'code-review',
      endedAt: '2026-04-04T01:10:00.000Z',
    });

    await deliverBackgroundRunCallbackWakeup({
      daemonRoot,
      stateRoot,
      runsRoot,
      runId: run.runId,
    });

    await expect(surfaceBackgroundRunResultsIfReady({
      runsRoot,
      triggerRunId: run.runId,
      now: new Date('2026-04-04T01:10:00.000Z'),
    })).resolves.toEqual({ surfacedRunIds: [] });
  });

  it('does not create callback wakeups for cancelled runs', async () => {
    const daemonRoot = createTempDir('pa-background-run-callback-daemon-');
    const stateRoot = createTempDir('pa-background-run-callback-state-');
    const runsRoot = join(daemonRoot, 'runs');
    const sessionFile = '/tmp/conversations/callback-cancelled.jsonl';

    const run = await createFinishedBackgroundRun({
      daemonRoot,
      sessionFile,
      taskSlug: 'sidebar-check',
      endedAt: '2026-04-04T01:15:00.000Z',
      exitCode: 1,
      cancelled: true,
    });

    await expect(deliverBackgroundRunCallbackWakeup({
      daemonRoot,
      stateRoot,
      runsRoot,
      runId: run.runId,
    })).resolves.toEqual({ delivered: false });

    const deferredState = loadDeferredResumeState(resolveDeferredResumeStateFile(stateRoot));
    expect(Object.keys(deferredState.resumes)).toEqual([]);
  });
});
