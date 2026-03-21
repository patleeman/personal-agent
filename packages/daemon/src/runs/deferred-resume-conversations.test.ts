import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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
});
