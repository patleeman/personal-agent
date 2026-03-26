import { mkdirSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { readSessionConversationId } from '@personal-agent/core';
import {
  appendDurableRunEvent,
  createDurableRunManifest,
  createInitialDurableRunStatus,
  loadDurableRunManifest,
  loadDurableRunStatus,
  resolveDurableRunPaths,
  resolveDurableRunsRoot,
  saveDurableRunCheckpoint,
  saveDurableRunManifest,
  saveDurableRunStatus,
  type DurableRunPaths,
  type DurableRunStatus,
} from './store.js';

function sanitizeIdSegment(value: string): string {
  const sanitized = value
    .replace(/[^a-zA-Z0-9-_]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');

  return sanitized.length > 0 ? sanitized : 'resume';
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

function resolveConversationId(input: { conversationId?: string; sessionFile: string }): string | undefined {
  return input.conversationId?.trim() || readSessionConversationId(input.sessionFile);
}

interface DeferredResumeConversationRunInput {
  daemonRoot: string;
  deferredResumeId: string;
  sessionFile: string;
  prompt: string;
  dueAt: string;
  createdAt?: string;
  readyAt?: string;
  profile?: string;
  cwd?: string;
  conversationId?: string;
}

interface DeferredResumeConversationRunResult {
  runId: string;
  paths: DurableRunPaths;
}

interface DeferredResumeConversationRunStateInput extends DeferredResumeConversationRunInput {
  status: DurableRunStatus;
  updatedAt: string;
  step: string;
  eventType: string;
  lastError?: string;
  completedAt?: string;
  result?: Record<string, unknown>;
}

function createSpec(input: DeferredResumeConversationRunInput): Record<string, unknown> {
  return {
    mode: 'deferred-resume',
    deferredResumeId: input.deferredResumeId,
    sessionFile: input.sessionFile,
    prompt: input.prompt,
    dueAt: normalizeTimestamp(input.dueAt),
    ...(input.createdAt ? { createdAt: normalizeTimestamp(input.createdAt) } : {}),
    ...(input.readyAt ? { readyAt: normalizeTimestamp(input.readyAt) } : {}),
    ...(input.profile ? { profile: input.profile } : {}),
    ...(input.cwd ? { cwd: input.cwd } : {}),
    ...(resolveConversationId(input) ? { conversationId: resolveConversationId(input) } : {}),
  };
}

async function saveDeferredResumeConversationRunState(
  input: DeferredResumeConversationRunStateInput,
): Promise<DeferredResumeConversationRunResult> {
  const runId = createDeferredResumeConversationRunId(input.deferredResumeId);
  const runsRoot = resolveDurableRunsRoot(input.daemonRoot);
  const paths = resolveDurableRunPaths(runsRoot, runId);
  const existingManifest = loadDurableRunManifest(paths.manifestPath);
  const existingStatus = loadDurableRunStatus(paths.statusPath);
  const conversationId = resolveConversationId(input);
  const createdAt = normalizeTimestamp(existingManifest?.createdAt ?? existingStatus?.createdAt ?? input.createdAt ?? input.updatedAt);
  const updatedAt = normalizeTimestamp(input.updatedAt);
  const completedAt = input.status === 'completed' || input.status === 'failed' || input.status === 'cancelled'
    ? normalizeTimestamp(input.completedAt ?? input.updatedAt)
    : undefined;

  if (!existingManifest) {
    saveDurableRunManifest(paths.manifestPath, createDurableRunManifest({
      id: runId,
      kind: 'conversation',
      resumePolicy: 'continue',
      createdAt,
      spec: createSpec(input),
      source: {
        type: 'deferred-resume',
        id: input.deferredResumeId,
        filePath: input.sessionFile,
      },
    }));

    await appendDurableRunEvent(paths.eventsPath, {
      version: 1,
      runId,
      timestamp: createdAt,
      type: 'run.created',
      payload: {
        kind: 'conversation',
        source: 'deferred-resume',
        deferredResumeId: input.deferredResumeId,
      },
    });
  }

  saveDurableRunStatus(paths.statusPath, createInitialDurableRunStatus({
    runId,
    status: input.status,
    createdAt,
    updatedAt,
    activeAttempt: existingStatus?.activeAttempt ?? (input.status === 'completed' ? 1 : 0),
    startedAt: existingStatus?.startedAt,
    completedAt,
    checkpointKey: input.step,
    lastError: input.lastError,
  }));

  saveDurableRunCheckpoint(paths.checkpointPath, {
    version: 1,
    runId,
    updatedAt,
    step: input.step,
    payload: {
      deferredResumeId: input.deferredResumeId,
      sessionFile: input.sessionFile,
      ...(conversationId ? { conversationId } : {}),
      prompt: input.prompt,
      dueAt: normalizeTimestamp(input.dueAt),
      ...(input.createdAt ? { createdAt: normalizeTimestamp(input.createdAt) } : {}),
      ...(input.readyAt ? { readyAt: normalizeTimestamp(input.readyAt) } : {}),
      ...(input.profile ? { profile: input.profile } : {}),
      ...(input.cwd ? { cwd: input.cwd } : {}),
      ...(input.lastError ? { lastError: input.lastError } : {}),
      ...(completedAt ? { completedAt } : {}),
    },
  });

  await appendDurableRunEvent(paths.eventsPath, {
    version: 1,
    runId,
    timestamp: updatedAt,
    type: input.eventType,
    payload: {
      deferredResumeId: input.deferredResumeId,
      ...(conversationId ? { conversationId } : {}),
      sessionFile: input.sessionFile,
      ...(input.lastError ? { error: input.lastError } : {}),
    },
  });

  if (input.status === 'completed') {
    await appendDurableRunEvent(paths.eventsPath, {
      version: 1,
      runId,
      timestamp: completedAt ?? updatedAt,
      type: 'run.completed',
      payload: {
        deferredResumeId: input.deferredResumeId,
        ...(conversationId ? { conversationId } : {}),
      },
    });
  }

  if (input.status === 'cancelled') {
    await appendDurableRunEvent(paths.eventsPath, {
      version: 1,
      runId,
      timestamp: updatedAt,
      type: 'run.cancelled',
      payload: {
        deferredResumeId: input.deferredResumeId,
        ...(conversationId ? { conversationId } : {}),
      },
    });
  }

  if (input.result) {
    writeJsonFile(paths.resultPath, input.result);
  }

  return {
    runId,
    paths,
  };
}

export function createDeferredResumeConversationRunId(deferredResumeId: string): string {
  return `conversation-deferred-resume-${sanitizeIdSegment(deferredResumeId)}`;
}

export async function scheduleDeferredResumeConversationRun(
  input: DeferredResumeConversationRunInput,
): Promise<DeferredResumeConversationRunResult> {
  return saveDeferredResumeConversationRunState({
    ...input,
    status: 'queued',
    updatedAt: input.createdAt ?? input.dueAt,
    step: 'deferred-resume.scheduled',
    eventType: 'conversation.deferred_resume.scheduled',
  });
}

export async function markDeferredResumeConversationRunReady(
  input: DeferredResumeConversationRunInput & { readyAt: string },
): Promise<DeferredResumeConversationRunResult> {
  return saveDeferredResumeConversationRunState({
    ...input,
    status: 'waiting',
    updatedAt: input.readyAt,
    step: 'deferred-resume.ready',
    eventType: 'conversation.deferred_resume.ready',
  });
}

export async function markDeferredResumeConversationRunRetryScheduled(
  input: DeferredResumeConversationRunInput & { retryAt: string; lastError: string },
): Promise<DeferredResumeConversationRunResult> {
  return saveDeferredResumeConversationRunState({
    ...input,
    status: 'queued',
    updatedAt: input.retryAt,
    step: 'deferred-resume.retry-scheduled',
    eventType: 'conversation.deferred_resume.retry_scheduled',
    lastError: input.lastError,
  });
}

export async function markDeferredResumeConversationRunSnoozed(
  input: DeferredResumeConversationRunInput & { snoozedUntil: string },
): Promise<DeferredResumeConversationRunResult> {
  return saveDeferredResumeConversationRunState({
    ...input,
    status: 'queued',
    updatedAt: input.snoozedUntil,
    step: 'deferred-resume.snoozed',
    eventType: 'conversation.deferred_resume.snoozed',
  });
}

export async function completeDeferredResumeConversationRun(
  input: DeferredResumeConversationRunInput & { completedAt: string },
): Promise<DeferredResumeConversationRunResult> {
  return saveDeferredResumeConversationRunState({
    ...input,
    status: 'completed',
    updatedAt: input.completedAt,
    completedAt: input.completedAt,
    step: 'deferred-resume.completed',
    eventType: 'conversation.deferred_resume.completed',
    result: {
      kind: 'conversation',
      mode: 'deferred-resume',
      deferredResumeId: input.deferredResumeId,
      sessionFile: input.sessionFile,
      ...(resolveConversationId(input) ? { conversationId: resolveConversationId(input) } : {}),
      prompt: input.prompt,
      dueAt: normalizeTimestamp(input.dueAt),
      completedAt: normalizeTimestamp(input.completedAt),
      status: 'completed',
    },
  });
}

export async function cancelDeferredResumeConversationRun(
  input: DeferredResumeConversationRunInput & { cancelledAt: string; reason?: string },
): Promise<DeferredResumeConversationRunResult> {
  return saveDeferredResumeConversationRunState({
    ...input,
    status: 'cancelled',
    updatedAt: input.cancelledAt,
    step: 'deferred-resume.cancelled',
    eventType: 'conversation.deferred_resume.cancelled',
    lastError: input.reason,
    result: {
      kind: 'conversation',
      mode: 'deferred-resume',
      deferredResumeId: input.deferredResumeId,
      sessionFile: input.sessionFile,
      ...(resolveConversationId(input) ? { conversationId: resolveConversationId(input) } : {}),
      prompt: input.prompt,
      dueAt: normalizeTimestamp(input.dueAt),
      cancelledAt: normalizeTimestamp(input.cancelledAt),
      reason: input.reason,
      status: 'cancelled',
    },
  });
}
