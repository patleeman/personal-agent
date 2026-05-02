import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  loadDurableRunCheckpoint,
  loadDurableRunManifest,
  loadDurableRunStatus,
  readDurableRunEvents,
  resolveDurableRunPaths,
} from './store.js';
import {
  createBackgroundRunId,
  createBackgroundRunRecord,
  finalizeBackgroundRun,
  markBackgroundRunCancelling,
  markBackgroundRunInterrupted,
  markBackgroundRunStarted,
} from './background-runs.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('background runs', () => {
  it('builds stable run ids from slugs and timestamps', () => {
    const runId = createBackgroundRunId('  Fancy Task / Name!  ', '2026-03-19T20:00:00.123Z');
    expect(runId).toMatch(/^run-fancy-task-name-2026-03-19T20-00-00-123Z-[a-f0-9]{8}$/);

    const fallback = createBackgroundRunId('   ', '2026-03-19T20:00:00.123Z');
    expect(fallback).toMatch(/^run-background-2026-03-19T20-00-00-123Z-[a-f0-9]{8}$/);
  });

  it('materializes agent runs into durable argv and stores the structured agent spec', async () => {
    const runsRoot = createTempDir('pa-background-run-record-');
    const record = await createBackgroundRunRecord(runsRoot, {
      taskSlug: 'code-review',
      cwd: '/tmp/workspace',
      agent: {
        prompt: 'Review the latest diff',
        profile: 'datadog',
        model: 'openai-codex/gpt-5.4',
      },
      createdAt: '2026-03-19T20:00:00.000Z',
    });

    expect(record.argv).toBeDefined();
    expect(record.shellCommand).toBeUndefined();
    expect(record.argv).toContain('tui');
    expect(record.argv).toContain('--plain');
    expect(record.argv).toContain('--profile');
    expect(record.argv).toContain('datadog');
    expect(record.argv).toContain('--model');
    expect(record.argv).toContain('openai-codex/gpt-5.4');
    expect(record.argv).toContain('-p');
    expect(record.argv).toContain('Review the latest diff');

    const manifest = loadDurableRunManifest(record.paths.manifestPath);
    const checkpoint = loadDurableRunCheckpoint(record.paths.checkpointPath);

    expect(manifest?.kind).toBe('background-run');
    expect(manifest?.resumePolicy).toBe('manual');

    const target = manifest?.spec.target as Record<string, unknown>;
    expect(target?.type).toBe('agent');
    expect(target?.prompt).toBe('Review the latest diff');
    expect(target?.profile).toBe('datadog');
    expect(target?.model).toBe('openai-codex/gpt-5.4');

    const metadata = manifest?.spec.metadata as Record<string, unknown>;
    expect(metadata?.taskSlug).toBe('code-review');
    expect(metadata?.cwd).toBe('/tmp/workspace');

    const payload = checkpoint?.payload as Record<string, unknown>;
    const payloadTarget = payload?.target as Record<string, unknown>;
    expect(payloadTarget?.prompt).toBe('Review the latest diff');
    expect(metadata?.taskSlug).toBe('code-review');
  });

  it('stores shell command runs and trims argv-based shell targets', async () => {
    const daemonRoot = createTempDir('pa-background-run-shell-');
    const shellRecord = await createBackgroundRunRecord(join(daemonRoot, 'runs'), {
      taskSlug: 'shell-task',
      cwd: '/tmp/workspace',
      shellCommand: '  echo hello world  ',
      manifestMetadata: { sourceKind: 'manual' },
      createdAt: '2026-03-19T20:00:00.000Z',
    });

    expect(shellRecord.argv).toBeUndefined();
    expect(shellRecord.shellCommand).toBe('echo hello world');
    const shellManifest = loadDurableRunManifest(shellRecord.paths.manifestPath);
    expect(shellManifest?.source).toEqual({ type: 'background-run', id: 'shell-task' });
    expect(shellManifest?.spec.target).toEqual({
      type: 'shell',
      command: 'echo hello world',
      cwd: '/tmp/workspace',
    });
    expect(shellManifest?.spec.metadata).toEqual(expect.objectContaining({
      taskSlug: 'shell-task',
      cwd: '/tmp/workspace',
      sourceKind: 'manual',
    }));

    const argvRecord = await createBackgroundRunRecord(daemonRoot, {
      taskSlug: 'argv-task',
      cwd: '/tmp/argv',
      argv: [' node ', ' ', '--version '],
    });

    expect(argvRecord.argv).toEqual(['node', '--version']);
    const argvManifest = loadDurableRunManifest(argvRecord.paths.manifestPath);
    expect(argvManifest?.spec.target).toEqual({
      type: 'shell',
      command: 'node --version',
      cwd: '/tmp/argv',
      argv: ['node', '--version'],
    });
  });

  it('rejects invalid command specifications', async () => {
    const runsRoot = createTempDir('pa-background-run-errors-');

    await expect(createBackgroundRunRecord(runsRoot, {
      taskSlug: 'missing-command',
      cwd: '/tmp/workspace',
    })).rejects.toThrow('Background run must include argv, shellCommand, or agent.');

    await expect(createBackgroundRunRecord(runsRoot, {
      taskSlug: 'multiple-specs',
      cwd: '/tmp/workspace',
      argv: ['node'],
      shellCommand: 'echo hi',
    })).rejects.toThrow('Background run must use exactly one of argv, shellCommand, or agent.');

    await expect(createBackgroundRunRecord(runsRoot, {
      taskSlug: 'empty-agent-prompt',
      cwd: '/tmp/workspace',
      agent: {
        prompt: '   ',
      },
    })).rejects.toThrow('Background agent run prompt must be non-empty.');
  });

  it('marks a run started and preserves checkpoint payload', async () => {
    const runsRoot = createTempDir('pa-background-run-started-');
    const record = await createBackgroundRunRecord(runsRoot, {
      taskSlug: 'code-review',
      cwd: '/tmp/workspace',
      argv: ['node', '--version'],
      checkpointPayload: {
        resumeParentOnExit: true,
      },
      createdAt: '2026-03-19T20:00:00.000Z',
    });

    await markBackgroundRunStarted({
      runId: record.runId,
      runPaths: record.paths,
      startedAt: '2026-03-19T20:01:00.000Z',
      pid: 4242,
      taskSlug: 'code-review',
      cwd: '/tmp/workspace',
    });

    expect(loadDurableRunStatus(record.paths.statusPath)).toEqual(expect.objectContaining({
      runId: record.runId,
      status: 'running',
      activeAttempt: 1,
      startedAt: '2026-03-19T20:01:00.000Z',
      checkpointKey: 'spawned',
    }));
    expect(loadDurableRunCheckpoint(record.paths.checkpointPath)).toEqual(expect.objectContaining({
      step: 'spawned',
      payload: expect.objectContaining({
        metadata: expect.objectContaining({
          resumeParentOnExit: true,
          taskSlug: 'code-review',
          cwd: '/tmp/workspace',
        }),
        taskSlug: 'code-review',
        cwd: '/tmp/workspace',
        pid: 4242,
        startedAt: '2026-03-19T20:01:00.000Z',
      }),
    }));
    expect(readDurableRunEvents(record.paths.eventsPath).at(-1)).toEqual(expect.objectContaining({
      type: 'run.attempt.started',
      payload: expect.objectContaining({
        taskSlug: 'code-review',
        cwd: '/tmp/workspace',
        pid: 4242,
      }),
    }));
    const output = readFileSync(record.paths.outputLogPath, 'utf-8');
    expect(output).toContain('# startedAt=2026-03-19T20:01:00.000Z');
    expect(output).toContain('# pid=4242');
  });

  it('finalizes failed and cancelled runs with status, events, and result files', async () => {
    const runsRoot = createTempDir('pa-background-run-finalize-');
    const failedRecord = await createBackgroundRunRecord(runsRoot, {
      taskSlug: 'failed-task',
      cwd: '/tmp/failed',
      argv: ['node', '--version'],
    });

    await finalizeBackgroundRun({
      runId: failedRecord.runId,
      runPaths: failedRecord.paths,
      taskSlug: 'failed-task',
      cwd: '/tmp/failed',
      startedAt: '2026-03-19T20:00:01.000Z',
      endedAt: '2026-03-19T20:00:05.000Z',
      exitCode: 2,
      signal: 'SIGTERM',
      cancelled: false,
      error: 'boom',
    });

    expect(loadDurableRunStatus(failedRecord.paths.statusPath)).toEqual(expect.objectContaining({
      status: 'failed',
      checkpointKey: 'failed',
      completedAt: '2026-03-19T20:00:05.000Z',
      lastError: 'boom',
    }));
    expect(loadDurableRunCheckpoint(failedRecord.paths.checkpointPath)).toEqual(expect.objectContaining({
      step: 'failed',
      payload: expect.objectContaining({
        exitCode: 2,
        signal: 'SIGTERM',
        cancelled: false,
        error: 'boom',
      }),
    }));
    expect(readDurableRunEvents(failedRecord.paths.eventsPath).at(-1)?.type).toBe('run.failed');
    expect(JSON.parse(readFileSync(failedRecord.paths.resultPath, 'utf-8'))).toEqual(expect.objectContaining({
      runId: failedRecord.runId,
      exitCode: 2,
      signal: 'SIGTERM',
      cancelled: false,
      success: false,
      error: 'boom',
    }));
    const failedOutput = readFileSync(failedRecord.paths.outputLogPath, 'utf-8');
    expect(failedOutput).toContain('__PA_RUN_EXIT_CODE=2');
    expect(failedOutput).toContain('# status=failed');

    const cancelledRecord = await createBackgroundRunRecord(runsRoot, {
      taskSlug: 'cancelled-task',
      cwd: '/tmp/cancelled',
      shellCommand: 'sleep 10',
    });

    await finalizeBackgroundRun({
      runId: cancelledRecord.runId,
      runPaths: cancelledRecord.paths,
      taskSlug: 'cancelled-task',
      cwd: '/tmp/cancelled',
      startedAt: '2026-03-19T20:01:00.000Z',
      endedAt: '2026-03-19T20:01:05.000Z',
      exitCode: 1,
      signal: null,
      cancelled: true,
    });

    expect(loadDurableRunStatus(cancelledRecord.paths.statusPath)).toEqual(expect.objectContaining({
      status: 'cancelled',
      checkpointKey: 'cancelled',
      completedAt: '2026-03-19T20:01:05.000Z',
    }));
    expect(readDurableRunEvents(cancelledRecord.paths.eventsPath).at(-1)?.type).toBe('run.cancelled');
    expect(JSON.parse(readFileSync(cancelledRecord.paths.resultPath, 'utf-8'))).toEqual(expect.objectContaining({
      cancelled: true,
      success: false,
    }));
  });

  it('marks active runs cancelled before the child process exits', async () => {
    const runsRoot = createTempDir('pa-background-run-cancelling-');
    const record = await createBackgroundRunRecord(runsRoot, {
      taskSlug: 'cancel-me',
      cwd: '/tmp/cancel-me',
      shellCommand: 'sleep 10',
      createdAt: '2026-03-19T20:00:00.000Z',
    });

    await markBackgroundRunStarted({
      runId: record.runId,
      runPaths: record.paths,
      startedAt: '2026-03-19T20:00:01.000Z',
      pid: 4343,
      taskSlug: 'cancel-me',
      cwd: '/tmp/cancel-me',
    });

    await expect(markBackgroundRunCancelling({
      runId: record.runId,
      runPaths: record.paths,
      reason: 'Cancelled by user',
      cancelledAt: '2026-03-19T20:00:02.000Z',
    })).resolves.toBe(true);

    expect(loadDurableRunStatus(record.paths.statusPath)).toEqual(expect.objectContaining({
      status: 'cancelled',
      checkpointKey: 'cancelled',
      completedAt: '2026-03-19T20:00:02.000Z',
      lastError: 'Cancelled by user',
    }));
    expect(loadDurableRunCheckpoint(record.paths.checkpointPath)).toEqual(expect.objectContaining({
      step: 'cancelled',
      payload: expect.objectContaining({
        cancelledAt: '2026-03-19T20:00:02.000Z',
        cancelled: true,
        error: 'Cancelled by user',
      }),
    }));
    expect(readDurableRunEvents(record.paths.eventsPath).at(-1)).toEqual(expect.objectContaining({
      type: 'run.cancelled',
      attempt: 1,
      payload: { cancelled: true, error: 'Cancelled by user' },
    }));
    const output = readFileSync(record.paths.outputLogPath, 'utf-8');
    expect(output).toContain('# cancelledAt=2026-03-19T20:00:02.000Z');

    await finalizeBackgroundRun({
      runId: record.runId,
      runPaths: record.paths,
      taskSlug: 'cancel-me',
      cwd: '/tmp/cancel-me',
      startedAt: '2026-03-19T20:00:01.000Z',
      endedAt: '2026-03-19T20:00:04.000Z',
      exitCode: 1,
      signal: 'SIGTERM',
      cancelled: false,
      error: 'Command exited with code 1',
    });

    expect(loadDurableRunStatus(record.paths.statusPath)).toEqual(expect.objectContaining({
      status: 'cancelled',
      completedAt: '2026-03-19T20:00:02.000Z',
      lastError: 'Cancelled by user',
    }));
    expect(readDurableRunEvents(record.paths.eventsPath).at(-1)).toEqual(expect.objectContaining({
      type: 'run.cancelled',
    }));

    await expect(markBackgroundRunCancelling({
      runId: record.runId,
      runPaths: record.paths,
      reason: 'should not change final state',
      cancelledAt: '2026-03-19T20:00:03.000Z',
    })).resolves.toBe(false);
  });

  it('interrupts active runs and ignores missing or already-finalized ones', async () => {
    const runsRoot = createTempDir('pa-background-run-interrupt-');
    const missingPaths = resolveDurableRunPaths(runsRoot, 'missing-run');

    await expect(markBackgroundRunInterrupted({
      runId: 'missing-run',
      runPaths: missingPaths,
      reason: 'lost child process',
      interruptedAt: '2026-03-19T20:00:00.000Z',
    })).resolves.toBe(false);

    const record = await createBackgroundRunRecord(runsRoot, {
      taskSlug: 'interrupt-me',
      cwd: '/tmp/interrupt',
      agent: {
        prompt: 'Investigate the interrupted background run',
      },
    });

    await markBackgroundRunStarted({
      runId: record.runId,
      runPaths: record.paths,
      startedAt: '2026-03-19T20:00:01.000Z',
      pid: 4343,
      taskSlug: 'interrupt-me',
      cwd: '/tmp/interrupt',
    });

    await expect(markBackgroundRunInterrupted({
      runId: record.runId,
      runPaths: record.paths,
      reason: 'lost child process',
      interruptedAt: '2026-03-19T20:00:02.000Z',
    })).resolves.toBe(true);

    expect(loadDurableRunStatus(record.paths.statusPath)).toEqual(expect.objectContaining({
      status: 'interrupted',
      checkpointKey: 'interrupted',
      lastError: 'lost child process',
    }));
    expect(loadDurableRunCheckpoint(record.paths.checkpointPath)).toEqual(expect.objectContaining({
      step: 'interrupted',
      payload: expect.objectContaining({
        interruptedAt: '2026-03-19T20:00:02.000Z',
        error: 'lost child process',
      }),
    }));
    const interruptEvent = readDurableRunEvents(record.paths.eventsPath).at(-1);
    expect(interruptEvent).toEqual(expect.objectContaining({
      type: 'run.interrupted',
      attempt: 1,
      payload: { error: 'lost child process' },
    }));
    const output = readFileSync(record.paths.outputLogPath, 'utf-8');
    expect(output).toContain('# interruptedAt=2026-03-19T20:00:02.000Z');
    expect(output).toContain('# error=lost child process');

    await expect(markBackgroundRunInterrupted({
      runId: record.runId,
      runPaths: record.paths,
      reason: 'should not change final state',
      interruptedAt: '2026-03-19T20:00:03.000Z',
    })).resolves.toBe(false);
  });
});
