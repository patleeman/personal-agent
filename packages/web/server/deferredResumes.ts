import {
  activateDeferredResume,
  activateDueDeferredResumes,
  createReadyDeferredResume,
  getSessionDeferredResumeEntries,
  loadDeferredResumeState,
  parseDeferredResumeDelayMs,
  readSessionConversationId,
  removeDeferredResume,
  retryDeferredResume,
  saveDeferredResumeState,
  scheduleDeferredResume,
  type DeferredResumeAlertLevel,
  type DeferredResumeKind,
  type DeferredResumeRecord,
} from '@personal-agent/core';
import {
  cancelDeferredResumeConversationRun,
  loadDaemonConfig,
  markDeferredResumeConversationRunReady,
  resolveDaemonPaths,
  scheduleDeferredResumeConversationRun,
} from '@personal-agent/daemon';

export const DEFAULT_DEFERRED_RESUME_PROMPT = 'Continue from where you left off and keep going.';

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

function normalizeReminderAt(at: string, now: Date): string {
  const timestamp = Date.parse(at);
  if (!Number.isFinite(timestamp)) {
    throw new Error('Invalid at timestamp. Use an ISO-8601 timestamp or another Date.parse-compatible string.');
  }

  const dueAt = new Date(timestamp);
  if (dueAt.getTime() <= now.getTime()) {
    throw new Error('Reminder time must be in the future.');
  }

  return dueAt.toISOString();
}

function resolveDueAt(input: { delay?: string; at?: string; now: Date }): string {
  if (input.delay && input.at) {
    throw new Error('Specify only one of delay or at.');
  }

  if (!input.delay && !input.at) {
    throw new Error('One of delay or at is required.');
  }

  if (input.delay) {
    const delayMs = parseDeferredResumeDelayMs(input.delay);
    if (!delayMs) {
      throw new Error('Invalid delay. Use forms like 30s, 10m, 2h, or 1d.');
    }

    return new Date(input.now.getTime() + delayMs).toISOString();
  }

  return normalizeReminderAt(input.at as string, input.now);
}

export interface DeferredResumeSummary {
  id: string;
  sessionFile: string;
  prompt: string;
  dueAt: string;
  createdAt: string;
  attempts: number;
  status: 'scheduled' | 'ready';
  readyAt?: string;
  kind: DeferredResumeKind;
  title?: string;
  delivery: {
    alertLevel: DeferredResumeAlertLevel;
    autoResumeIfOpen: boolean;
    requireAck: boolean;
  };
}

function createDeferredResumeId(now: Date): string {
  return `resume_${now.getTime()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function toDeferredResumeSummary(record: DeferredResumeRecord): DeferredResumeSummary {
  return {
    id: record.id,
    sessionFile: record.sessionFile,
    prompt: record.prompt,
    dueAt: record.dueAt,
    createdAt: record.createdAt,
    attempts: record.attempts,
    status: record.status,
    readyAt: record.readyAt,
    kind: record.kind,
    title: record.title,
    delivery: record.delivery,
  };
}

export function listDeferredResumesForSessionFile(sessionFile: string): DeferredResumeSummary[] {
  const state = loadDeferredResumeState();
  return getSessionDeferredResumeEntries(state, sessionFile).map(toDeferredResumeSummary);
}

export function activateDueDeferredResumesForSessionFile(input: {
  sessionFile: string;
  at?: Date;
}): DeferredResumeSummary[] {
  const state = loadDeferredResumeState();
  const activated = activateDueDeferredResumes(state, {
    at: input.at,
    sessionFile: input.sessionFile,
  });

  if (activated.length > 0) {
    saveDeferredResumeState(state);
  }

  return activated.map(toDeferredResumeSummary);
}

export function completeDeferredResumeForSessionFile(input: {
  sessionFile: string;
  id: string;
}): DeferredResumeSummary | undefined {
  const state = loadDeferredResumeState();
  const record = state.resumes[input.id];
  if (!record || record.sessionFile !== input.sessionFile) {
    return undefined;
  }

  removeDeferredResume(state, input.id);
  saveDeferredResumeState(state);
  return toDeferredResumeSummary(record);
}

export function retryDeferredResumeForSessionFile(input: {
  sessionFile: string;
  id: string;
  dueAt: string;
}): DeferredResumeSummary | undefined {
  const state = loadDeferredResumeState();
  const record = state.resumes[input.id];
  if (!record || record.sessionFile !== input.sessionFile) {
    return undefined;
  }

  const retried = retryDeferredResume(state, {
    id: input.id,
    dueAt: input.dueAt,
  });
  if (!retried) {
    return undefined;
  }

  saveDeferredResumeState(state);
  return toDeferredResumeSummary(retried);
}

export async function fireDeferredResumeNowForSessionFile(input: {
  sessionFile: string;
  id: string;
  at?: Date;
}): Promise<DeferredResumeSummary> {
  const state = loadDeferredResumeState();
  const record = state.resumes[input.id];
  if (!record || record.sessionFile !== input.sessionFile) {
    throw new Error(`No deferred resume found for this conversation: ${input.id}`);
  }

  const wasReady = record.status === 'ready';
  const activated = activateDeferredResume(state, {
    id: input.id,
    at: input.at,
  });
  if (!activated) {
    throw new Error(`No deferred resume found for this conversation: ${input.id}`);
  }

  saveDeferredResumeState(state);
  if (!wasReady) {
    await markDeferredResumeConversationRunReady({
      daemonRoot: resolveDaemonRoot(),
      deferredResumeId: activated.id,
      sessionFile: activated.sessionFile,
      prompt: activated.prompt,
      dueAt: activated.dueAt,
      createdAt: activated.createdAt,
      readyAt: activated.readyAt ?? (input.at ?? new Date()).toISOString(),
      conversationId: readSessionConversationId(activated.sessionFile),
    });
  }

  return toDeferredResumeSummary(activated);
}

export async function scheduleDeferredResumeForSessionFile(input: {
  sessionFile: string;
  conversationId?: string;
  delay?: string;
  at?: string;
  prompt?: string;
  title?: string;
  kind?: DeferredResumeKind;
  notify?: DeferredResumeAlertLevel;
  requireAck?: boolean;
  autoResumeIfOpen?: boolean;
  source?: { kind: string; id?: string };
  now?: Date;
}): Promise<DeferredResumeSummary> {
  const now = input.now ?? new Date();
  const dueAt = resolveDueAt({ delay: input.delay, at: input.at, now });
  const state = loadDeferredResumeState();
  const kind = input.kind ?? 'continue';
  const record = scheduleDeferredResume(state, {
    id: createDeferredResumeId(now),
    sessionFile: input.sessionFile,
    prompt: input.prompt?.trim() || DEFAULT_DEFERRED_RESUME_PROMPT,
    dueAt,
    createdAt: now.toISOString(),
    attempts: 0,
    kind,
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.source ? { source: input.source } : {}),
    delivery: {
      alertLevel: input.notify,
      autoResumeIfOpen: input.autoResumeIfOpen,
      requireAck: input.requireAck,
    },
  });

  saveDeferredResumeState(state);
  await scheduleDeferredResumeConversationRun({
    daemonRoot: resolveDaemonRoot(),
    deferredResumeId: record.id,
    sessionFile: record.sessionFile,
    prompt: record.prompt,
    dueAt: record.dueAt,
    createdAt: record.createdAt,
    conversationId: input.conversationId?.trim() || readSessionConversationId(record.sessionFile),
  });
  return toDeferredResumeSummary(record);
}

export function createReadyDeferredResumeForSessionFile(input: {
  sessionFile: string;
  prompt: string;
  title?: string;
  kind?: DeferredResumeKind;
  notify?: DeferredResumeAlertLevel;
  requireAck?: boolean;
  autoResumeIfOpen?: boolean;
  source?: { kind: string; id?: string };
  dueAt?: string;
  readyAt?: string;
  createdAt?: string;
}): DeferredResumeSummary {
  const now = new Date();
  const dueAt = input.dueAt ? new Date(input.dueAt).toISOString() : now.toISOString();
  const createdAt = input.createdAt ? new Date(input.createdAt).toISOString() : dueAt;
  const readyAt = input.readyAt ? new Date(input.readyAt).toISOString() : now.toISOString();
  const state = loadDeferredResumeState();
  const record = createReadyDeferredResume(state, {
    id: createDeferredResumeId(now),
    sessionFile: input.sessionFile,
    prompt: input.prompt.trim(),
    dueAt,
    createdAt,
    readyAt,
    attempts: 0,
    kind: input.kind,
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
    ...(input.source ? { source: input.source } : {}),
    delivery: {
      alertLevel: input.notify,
      autoResumeIfOpen: input.autoResumeIfOpen,
      requireAck: input.requireAck,
    },
  });
  saveDeferredResumeState(state);
  return toDeferredResumeSummary(record);
}

export async function cancelDeferredResumeForSessionFile(input: {
  sessionFile: string;
  id: string;
}): Promise<DeferredResumeSummary> {
  const state = loadDeferredResumeState();
  const record = state.resumes[input.id];
  if (!record || record.sessionFile !== input.sessionFile) {
    throw new Error(`No deferred resume found for this conversation: ${input.id}`);
  }

  removeDeferredResume(state, input.id);
  saveDeferredResumeState(state);
  await cancelDeferredResumeConversationRun({
    daemonRoot: resolveDaemonRoot(),
    deferredResumeId: record.id,
    sessionFile: record.sessionFile,
    prompt: record.prompt,
    dueAt: record.dueAt,
    createdAt: record.createdAt,
    readyAt: record.readyAt,
    cancelledAt: new Date().toISOString(),
    conversationId: readSessionConversationId(record.sessionFile),
    reason: 'Deferred resume cancelled by user.',
  });
  return toDeferredResumeSummary(record);
}
