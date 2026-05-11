import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  cancelDeferredResumeConversationRun,
  completeDeferredResumeConversationRun,
  createDeferredResumeConversationRunId,
  markDeferredResumeConversationRunReady,
  markDeferredResumeConversationRunRetryScheduled,
  markDeferredResumeConversationRunSnoozed,
  scheduleDeferredResumeConversationRun,
} from './deferred-resume-conversations.js';
import { readDurableRunEvents, resolveDurableRunPaths, resolveDurableRunsRoot, scanDurableRun } from './store.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('deferred resume conversation durable runs', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('tracks scheduled, ready, retry, and completion lifecycle in a durable conversation run', async () => {
    const daemonRoot = createTempDir('deferred-resume-runs-');
    const sessionDir = join(daemonRoot, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, 'conv-123.jsonl');
    writeFileSync(sessionFile, '{"type":"session","id":"conv-123","timestamp":"2026-03-12T13:00:00.000Z","cwd":"/tmp/workspace"}\n');

    const runId = createDeferredResumeConversationRunId('resume_123');

    await scheduleDeferredResumeConversationRun({
      daemonRoot,
      deferredResumeId: 'resume_123',
      sessionFile,
      prompt: 'check the logs',
      dueAt: '2026-03-12T13:10:00.000Z',
      createdAt: '2026-03-12T13:00:00.000Z',
    });

    expect(scanDurableRun(resolveDurableRunsRoot(daemonRoot), runId)).toMatchObject({
      runId,
      recoveryAction: 'resume',
      status: expect.objectContaining({
        status: 'queued',
      }),
      manifest: expect.objectContaining({
        kind: 'conversation',
        resumePolicy: 'continue',
        source: expect.objectContaining({
          type: 'deferred-resume',
          id: 'resume_123',
          filePath: sessionFile,
        }),
      }),
      checkpoint: expect.objectContaining({
        step: 'deferred-resume.scheduled',
      }),
    });

    await markDeferredResumeConversationRunReady({
      daemonRoot,
      deferredResumeId: 'resume_123',
      sessionFile,
      prompt: 'check the logs',
      dueAt: '2026-03-12T13:10:00.000Z',
      createdAt: '2026-03-12T13:00:00.000Z',
      readyAt: '2026-03-12T13:10:00.000Z',
      conversationId: 'conv-123',
    });

    expect(scanDurableRun(resolveDurableRunsRoot(daemonRoot), runId)).toMatchObject({
      recoveryAction: 'resume',
      status: expect.objectContaining({
        status: 'waiting',
        checkpointKey: 'deferred-resume.ready',
      }),
      checkpoint: expect.objectContaining({
        step: 'deferred-resume.ready',
        payload: expect.objectContaining({
          conversationId: 'conv-123',
        }),
      }),
    });

    await markDeferredResumeConversationRunRetryScheduled({
      daemonRoot,
      deferredResumeId: 'resume_123',
      sessionFile,
      prompt: 'check the logs',
      dueAt: '2026-03-12T13:11:00.000Z',
      createdAt: '2026-03-12T13:00:00.000Z',
      retryAt: '2026-03-12T13:11:00.000Z',
      conversationId: 'conv-123',
      lastError: 'temporary failure',
    });

    expect(scanDurableRun(resolveDurableRunsRoot(daemonRoot), runId)).toMatchObject({
      recoveryAction: 'resume',
      status: expect.objectContaining({
        status: 'queued',
        lastError: 'temporary failure',
      }),
      checkpoint: expect.objectContaining({
        step: 'deferred-resume.retry-scheduled',
        payload: expect.objectContaining({
          lastError: 'temporary failure',
          dueAt: '2026-03-12T13:11:00.000Z',
        }),
      }),
    });

    await completeDeferredResumeConversationRun({
      daemonRoot,
      deferredResumeId: 'resume_123',
      sessionFile,
      prompt: 'check the logs',
      dueAt: '2026-03-12T13:11:00.000Z',
      createdAt: '2026-03-12T13:00:00.000Z',
      readyAt: '2026-03-12T13:10:00.000Z',
      completedAt: '2026-03-12T13:11:30.000Z',
      conversationId: 'conv-123',
      cwd: '/tmp/workspace',
    });

    const completedRun = scanDurableRun(resolveDurableRunsRoot(daemonRoot), runId);
    expect(completedRun).toMatchObject({
      recoveryAction: 'none',
      status: expect.objectContaining({
        status: 'completed',
        completedAt: '2026-03-12T13:11:30.000Z',
      }),
      checkpoint: expect.objectContaining({
        step: 'deferred-resume.completed',
      }),
    });

    const runPaths = resolveDurableRunPaths(resolveDurableRunsRoot(daemonRoot), runId);
    expect(JSON.parse(readFileSync(runPaths.resultPath, 'utf-8'))).toMatchObject({
      deferredResumeId: 'resume_123',
      conversationId: 'conv-123',
      status: 'completed',
    });

    const eventTypes = readDurableRunEvents(runPaths.eventsPath).map((event) => event.type);
    expect(eventTypes).toEqual([
      'run.created',
      'conversation.deferred_resume.scheduled',
      'conversation.deferred_resume.ready',
      'conversation.deferred_resume.retry_scheduled',
      'conversation.deferred_resume.completed',
      'run.completed',
    ]);
  });

  it('keeps snoozed deferred resume runs queued without marking them failed', async () => {
    const daemonRoot = createTempDir('deferred-resume-runs-');
    const sessionDir = join(daemonRoot, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, 'conv-789.jsonl');
    writeFileSync(sessionFile, '{"type":"session","id":"conv-789","timestamp":"2026-03-12T15:00:00.000Z","cwd":"/tmp/workspace"}\n');

    await scheduleDeferredResumeConversationRun({
      daemonRoot,
      deferredResumeId: 'resume_789',
      sessionFile,
      prompt: 'review the rollout',
      dueAt: '2026-03-12T15:10:00.000Z',
      createdAt: '2026-03-12T15:00:00.000Z',
    });

    await markDeferredResumeConversationRunReady({
      daemonRoot,
      deferredResumeId: 'resume_789',
      sessionFile,
      prompt: 'review the rollout',
      dueAt: '2026-03-12T15:10:00.000Z',
      createdAt: '2026-03-12T15:00:00.000Z',
      readyAt: '2026-03-12T15:10:00.000Z',
      conversationId: 'conv-789',
    });

    await markDeferredResumeConversationRunSnoozed({
      daemonRoot,
      deferredResumeId: 'resume_789',
      sessionFile,
      prompt: 'review the rollout',
      dueAt: '2026-03-12T15:25:00.000Z',
      createdAt: '2026-03-12T15:00:00.000Z',
      conversationId: 'conv-789',
      snoozedUntil: '2026-03-12T15:25:00.000Z',
    });

    const runId = createDeferredResumeConversationRunId('resume_789');
    expect(scanDurableRun(resolveDurableRunsRoot(daemonRoot), runId)).toMatchObject({
      recoveryAction: 'resume',
      status: expect.objectContaining({
        status: 'queued',
        completedAt: undefined,
        lastError: undefined,
      }),
      checkpoint: expect.objectContaining({
        step: 'deferred-resume.snoozed',
        payload: expect.objectContaining({
          dueAt: '2026-03-12T15:25:00.000Z',
        }),
      }),
    });

    const eventTypes = readDurableRunEvents(resolveDurableRunPaths(resolveDurableRunsRoot(daemonRoot), runId).eventsPath).map(
      (event) => event.type,
    );
    expect(eventTypes).toEqual([
      'run.created',
      'conversation.deferred_resume.scheduled',
      'conversation.deferred_resume.ready',
      'conversation.deferred_resume.snoozed',
    ]);
  });

  it('marks cancelled deferred resume runs as terminal', async () => {
    const daemonRoot = createTempDir('deferred-resume-runs-');
    const sessionDir = join(daemonRoot, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, 'conv-456.jsonl');
    writeFileSync(sessionFile, '{"type":"session","id":"conv-456","timestamp":"2026-03-12T14:00:00.000Z","cwd":"/tmp/workspace"}\n');

    await scheduleDeferredResumeConversationRun({
      daemonRoot,
      deferredResumeId: 'resume_456',
      sessionFile,
      prompt: 'come back later',
      dueAt: '2026-03-12T14:10:00.000Z',
      createdAt: '2026-03-12T14:00:00.000Z',
    });

    await cancelDeferredResumeConversationRun({
      daemonRoot,
      deferredResumeId: 'resume_456',
      sessionFile,
      prompt: 'come back later',
      dueAt: '2026-03-12T14:10:00.000Z',
      createdAt: '2026-03-12T14:00:00.000Z',
      cancelledAt: '2026-03-12T14:01:00.000Z',
      reason: 'Cancelled by user',
      conversationId: 'conv-456',
    });

    const runId = createDeferredResumeConversationRunId('resume_456');
    const cancelledRun = scanDurableRun(resolveDurableRunsRoot(daemonRoot), runId);
    expect(cancelledRun).toMatchObject({
      recoveryAction: 'none',
      status: expect.objectContaining({
        status: 'cancelled',
        completedAt: '2026-03-12T14:01:00.000Z',
        lastError: 'Cancelled by user',
      }),
      checkpoint: expect.objectContaining({
        step: 'deferred-resume.cancelled',
      }),
    });
  });

  it('rejects invalid deferred resume run timestamps with field errors', async () => {
    const daemonRoot = createTempDir('deferred-resume-runs-');
    const sessionDir = join(daemonRoot, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, 'conv-invalid-time.jsonl');
    writeFileSync(
      sessionFile,
      '{"type":"session","id":"conv-invalid-time","timestamp":"2026-03-12T14:00:00.000Z","cwd":"/tmp/workspace"}\n',
    );

    await expect(
      scheduleDeferredResumeConversationRun({
        daemonRoot,
        deferredResumeId: 'resume_invalid_time',
        sessionFile,
        prompt: 'come back later',
        dueAt: 'not-a-date',
        createdAt: '2026-03-12T14:00:00.000Z',
      }),
    ).rejects.toThrow('Deferred resume run dueAt must be a valid timestamp.');

    await expect(
      markDeferredResumeConversationRunReady({
        daemonRoot,
        deferredResumeId: 'resume_invalid_time',
        sessionFile,
        prompt: 'come back later',
        dueAt: '2026-03-12T14:10:00.000Z',
        createdAt: '2026-03-12T14:00:00.000Z',
        readyAt: 'not-a-date',
      }),
    ).rejects.toThrow('Deferred resume run updatedAt must be a valid timestamp.');
  });

  it('rejects non-ISO deferred resume run timestamps with field errors', async () => {
    const daemonRoot = createTempDir('deferred-resume-runs-');
    const sessionDir = join(daemonRoot, 'sessions');
    mkdirSync(sessionDir, { recursive: true });
    const sessionFile = join(sessionDir, 'conv-non-iso-time.jsonl');
    writeFileSync(
      sessionFile,
      '{"type":"session","id":"conv-non-iso-time","timestamp":"2026-03-12T14:00:00.000Z","cwd":"/tmp/workspace"}\n',
    );

    await expect(
      scheduleDeferredResumeConversationRun({
        daemonRoot,
        deferredResumeId: 'resume_non_iso_time',
        sessionFile,
        prompt: 'come back later',
        dueAt: '9999',
        createdAt: '2026-03-12T14:00:00.000Z',
      }),
    ).rejects.toThrow('Deferred resume run dueAt must be a valid timestamp.');

    await expect(
      scheduleDeferredResumeConversationRun({
        daemonRoot,
        deferredResumeId: 'resume_overflowed_time',
        sessionFile,
        prompt: 'come back later',
        dueAt: '2026-02-31T14:10:00.000Z',
        createdAt: '2026-03-12T14:00:00.000Z',
      }),
    ).rejects.toThrow('Deferred resume run dueAt must be a valid timestamp.');
  });
});
