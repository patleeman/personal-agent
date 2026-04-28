import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBackgroundRunRecord, finalizeBackgroundRun } from './background-runs.js';
import {
  listPendingBackgroundRunResults,
  markBackgroundRunResultsDelivered,
  surfaceBackgroundRunResultsIfReady,
} from './background-run-deferred-resumes.js';
import { loadDurableRunCheckpoint } from './store.js';

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function createFinishedBackgroundRun(input: {
  runsRoot: string;
  taskSlug: string;
  sessionFile: string;
  endedAt: string;
}): Promise<{ runId: string; outputLogPath: string; checkpointPath: string }> {
  const record = await createBackgroundRunRecord(input.runsRoot, {
    taskSlug: input.taskSlug,
    cwd: createTempDir('bg-run-cwd-'),
    argv: [process.execPath, '-e', 'console.log("done")'],
    source: {
      type: 'tool',
      id: input.taskSlug,
      filePath: input.sessionFile,
    },
    checkpointPayload: {
      resumeParentOnExit: true,
    },
    createdAt: '2026-03-22T19:00:00.000Z',
  });

  await finalizeBackgroundRun({
    runId: record.runId,
    runPaths: record.paths,
    taskSlug: input.taskSlug,
    cwd: createTempDir('bg-run-finished-cwd-'),
    startedAt: '2026-03-22T19:00:01.000Z',
    endedAt: input.endedAt,
    exitCode: 0,
    signal: null,
    cancelled: false,
  });

  return {
    runId: record.runId,
    outputLogPath: record.paths.outputLogPath,
    checkpointPath: record.paths.checkpointPath,
  };
}

describe('background run result surfacing', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits until the last active run stops, then surfaces a batched pending result', async () => {
    // Note: runs are stored under <runsRoot>/runs/ due to scheduleRun structure
    const tempRoot = createTempDir('pa-background-run-results-');
    const runsRoot = join(tempRoot, 'runs');
    const sessionFile = '/tmp/conversations/batch.jsonl';

    const slow = await createBackgroundRunRecord(tempRoot, {
      taskSlug: 'slow-task',
      cwd: createTempDir('bg-run-slow-cwd-'),
      argv: [process.execPath, '-e', 'setTimeout(() => {}, 1000)'],
      source: {
        type: 'tool',
        id: 'conv-1',
        filePath: sessionFile,
      },
      checkpointPayload: {
        resumeParentOnExit: true,
      },
      createdAt: '2026-03-22T19:00:00.000Z',
    });
    const fast = await createFinishedBackgroundRun({
      runsRoot: tempRoot,
      taskSlug: 'fast-task',
      sessionFile,
      endedAt: '2026-03-22T19:00:05.000Z',
    });

    await expect(surfaceBackgroundRunResultsIfReady({
      runsRoot,
      triggerRunId: fast.runId,
      now: new Date('2026-03-22T19:00:05.000Z'),
    })).resolves.toEqual({ surfacedRunIds: [] });
    expect(listPendingBackgroundRunResults({ runsRoot, sessionFile })).toEqual([]);

    await finalizeBackgroundRun({
      runId: slow.runId,
      runPaths: slow.paths,
      taskSlug: 'slow-task',
      cwd: createTempDir('bg-run-slow-finished-cwd-'),
      startedAt: '2026-03-22T19:00:01.000Z',
      endedAt: '2026-03-22T19:00:10.000Z',
      exitCode: 0,
      signal: null,
      cancelled: false,
    });

    const surfaced = await surfaceBackgroundRunResultsIfReady({
      runsRoot,
      triggerRunId: slow.runId,
      now: new Date('2026-03-22T19:00:10.000Z'),
    });

    expect(surfaced.resultId).toEqual(expect.stringContaining('result_run_'));
    expect(surfaced.surfacedRunIds).toEqual([fast.runId, slow.runId].sort());

    const pending = listPendingBackgroundRunResults({ runsRoot, sessionFile });
    expect(pending).toEqual([
      expect.objectContaining({
        id: surfaced.resultId,
        sessionFile,
        runIds: [fast.runId, slow.runId].sort(),
      }),
    ]);
    expect(pending[0]?.prompt).toContain(fast.runId);
    expect(pending[0]?.prompt).toContain(slow.runId);
    expect(pending[0]?.prompt).toContain('Use run get/logs');

    const fastCheckpoint = loadDurableRunCheckpoint(fast.checkpointPath);
    const slowCheckpoint = loadDurableRunCheckpoint(slow.paths.checkpointPath);
    expect((fastCheckpoint?.payload?.backgroundRunResume as { batchId?: string } | undefined)?.batchId).toBe(surfaced.resultId);
    expect((slowCheckpoint?.payload?.backgroundRunResume as { batchId?: string } | undefined)?.batchId).toBe(surfaced.resultId);
  });

  it('marks pending result batches delivered after the next prompt consumes them', async () => {
    // Note: runs are stored under <runsRoot>/runs/ due to scheduleRun structure
    const tempRoot = createTempDir('pa-background-run-results-');
    const runsRoot = join(tempRoot, 'runs');
    const sessionFile = '/tmp/conversations/delivered.jsonl';

    const run = await createFinishedBackgroundRun({
      runsRoot: tempRoot,
      taskSlug: 'deliver-task',
      sessionFile,
      endedAt: '2026-03-22T19:00:05.000Z',
    });

    const surfaced = await surfaceBackgroundRunResultsIfReady({
      runsRoot,
      triggerRunId: run.runId,
      now: new Date('2026-03-22T19:00:05.000Z'),
    });
    expect(surfaced.resultId).toBeTruthy();
    expect(listPendingBackgroundRunResults({ runsRoot, sessionFile })).toHaveLength(1);

    const delivered = markBackgroundRunResultsDelivered({
      runsRoot,
      sessionFile,
      resultIds: [surfaced.resultId ?? ''],
      deliveredAt: '2026-03-22T19:00:30.000Z',
    });

    expect(delivered).toEqual([surfaced.resultId]);
    expect(listPendingBackgroundRunResults({ runsRoot, sessionFile })).toEqual([]);

    const checkpoint = loadDurableRunCheckpoint(run.checkpointPath);
    expect((checkpoint?.payload?.backgroundRunResume as { deliveredAt?: string } | undefined)?.deliveredAt).toBe('2026-03-22T19:00:30.000Z');
  });

  it('falls back to the current clock when marking delivered with a malformed timestamp', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T19:00:45.000Z'));
    const tempRoot = createTempDir('pa-background-run-results-');
    const runsRoot = join(tempRoot, 'runs');
    const sessionFile = '/tmp/conversations/delivered-invalid-time.jsonl';

    const run = await createFinishedBackgroundRun({
      runsRoot: tempRoot,
      taskSlug: 'deliver-invalid-time-task',
      sessionFile,
      endedAt: '2026-03-22T19:00:05.000Z',
    });

    const surfaced = await surfaceBackgroundRunResultsIfReady({
      runsRoot,
      triggerRunId: run.runId,
      now: new Date('2026-03-22T19:00:05.000Z'),
    });

    const delivered = markBackgroundRunResultsDelivered({
      runsRoot,
      sessionFile,
      resultIds: [surfaced.resultId ?? ''],
      deliveredAt: 'not-a-date',
    });

    expect(delivered).toEqual([surfaced.resultId]);
    const checkpoint = loadDurableRunCheckpoint(run.checkpointPath);
    expect((checkpoint?.payload?.backgroundRunResume as { deliveredAt?: string } | undefined)?.deliveredAt).toBe('2026-03-22T19:00:45.000Z');
  });

  it('falls back to the current clock when surfacing with an invalid Date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-22T19:00:05.000Z'));
    const tempRoot = createTempDir('pa-background-run-results-');
    const runsRoot = join(tempRoot, 'runs');
    const sessionFile = '/tmp/conversations/invalid-now.jsonl';

    const run = await createFinishedBackgroundRun({
      runsRoot: tempRoot,
      taskSlug: 'invalid-now-task',
      sessionFile,
      endedAt: '2026-03-22T19:00:05.000Z',
    });

    const surfaced = await surfaceBackgroundRunResultsIfReady({
      runsRoot,
      triggerRunId: run.runId,
      now: new Date(Number.NaN),
    });

    expect(surfaced.resultId).toBeTruthy();
    const checkpoint = loadDurableRunCheckpoint(run.checkpointPath);
    expect((checkpoint?.payload?.backgroundRunResume as { surfacedAt?: string } | undefined)?.surfacedAt).toBe('2026-03-22T19:00:05.000Z');
  });

});
