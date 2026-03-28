import {
  getConversationProjectLink,
  getSessionDeferredResumeEntries,
  listDeferredResumeRecords,
  loadDeferredResumeState,
  readSessionConversationId,
  removeDeferredResume,
  resolveDeferredResumeStateFile,
  saveDeferredResumeState,
  type DeferredResumeRecord,
} from '@personal-agent/core';
import {
  cancelDeferredResumeConversationRun,
  loadDaemonConfig,
  resolveDaemonPaths,
} from '@personal-agent/daemon';
import {
  scheduleDeferredResumeForSessionFile,
  toDeferredResumeSummary,
  type DeferredResumeSummary,
} from './deferredResumes.js';

export const CONVERSATION_SELF_DISTILL_SOURCE_KIND = 'conversation-self-distill';
export const DEFAULT_CONVERSATION_SELF_DISTILL_DELAY = '60s';
export const CONVERSATION_SELF_DISTILL_TITLE = 'Background durable review after close';

export interface ScheduleConversationSelfDistillWakeupInput {
  profile: string;
  sessionFile: string;
  conversationId?: string;
  delay?: string;
  stateRoot?: string;
  now?: Date;
}

export interface ScheduleConversationSelfDistillWakeupResult {
  resume: DeferredResumeSummary;
  deduped: boolean;
}

function resolveConversationId(input: Pick<ScheduleConversationSelfDistillWakeupInput, 'conversationId' | 'sessionFile'>): string {
  const directConversationId = input.conversationId?.trim();
  if (directConversationId) {
    return directConversationId;
  }

  const sessionConversationId = readSessionConversationId(input.sessionFile)?.trim();
  if (sessionConversationId) {
    return sessionConversationId;
  }

  throw new Error('Self-distill wakeup requires a persisted conversation id.');
}

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

export function isConversationSelfDistillSource(source: { kind?: string } | undefined | null): boolean {
  return source?.kind === CONVERSATION_SELF_DISTILL_SOURCE_KIND;
}

export function resolveConversationSelfDistillConversationId(record: Pick<DeferredResumeRecord, 'sessionFile' | 'source'>): string | undefined {
  const sourceConversationId = record.source?.id?.trim();
  if (sourceConversationId) {
    return sourceConversationId;
  }

  return readSessionConversationId(record.sessionFile)?.trim() || undefined;
}

export function listConversationSelfDistillWakeupRecords(options: {
  stateRoot?: string;
  sessionFile?: string;
  conversationId?: string;
} = {}): DeferredResumeRecord[] {
  const state = loadDeferredResumeState(resolveDeferredResumeStateFile(options.stateRoot));
  const sessionFile = options.sessionFile?.trim();
  const conversationId = options.conversationId?.trim();

  return listDeferredResumeRecords(state).filter((record) => {
    if (!isConversationSelfDistillSource(record.source)) {
      return false;
    }

    if (sessionFile && record.sessionFile !== sessionFile) {
      return false;
    }

    if (!conversationId) {
      return true;
    }

    return resolveConversationSelfDistillConversationId(record) === conversationId;
  });
}

function findExistingConversationSelfDistillWakeup(input: {
  sessionFile: string;
  conversationId: string;
  stateRoot?: string;
}): DeferredResumeRecord | undefined {
  return listConversationSelfDistillWakeupRecords({
    stateRoot: input.stateRoot,
    sessionFile: input.sessionFile,
    conversationId: input.conversationId,
  })[0];
}

function buildConversationSelfDistillPrompt(relatedProjectIds: string[]): string {
  const lines = [
    'This conversation was just closed in the web UI.',
    'Take one beat now and decide whether anything from this thread is worth writing down durably.',
    'Keep raw conversations raw by default.',
    '',
    'If nothing clearly deserves a durable update, reply exactly: No durable update needed.',
    '',
    'Allowed durable outcomes:',
    '- create or update a shared note node for reusable knowledge that should outlive this conversation',
    '- update an already-linked project when this conversation materially changed its status, blockers, decisions, or next steps',
    relatedProjectIds.length > 0
      ? `Currently linked projects: ${relatedProjectIds.map((projectId) => `@${projectId}`).join(', ')}`
      : 'No projects are currently linked to this conversation.',
    '',
    'Do not create a new project from this pass.',
    'Do not edit AGENTS.md or create/update skills unless the user explicitly asked for that in this conversation.',
    'If the durable value is already captured elsewhere, do nothing.',
    'Prefer the smallest durable change that preserves the value.',
  ];

  return lines.join('\n');
}

export async function scheduleConversationSelfDistillWakeup(
  input: ScheduleConversationSelfDistillWakeupInput,
): Promise<ScheduleConversationSelfDistillWakeupResult> {
  const conversationId = resolveConversationId(input);
  const existing = findExistingConversationSelfDistillWakeup({
    sessionFile: input.sessionFile,
    conversationId,
    stateRoot: input.stateRoot,
  });

  if (existing) {
    return {
      resume: toDeferredResumeSummary(existing),
      deduped: true,
    };
  }

  const relatedProjectIds = getConversationProjectLink({
    stateRoot: input.stateRoot,
    profile: input.profile,
    conversationId,
  })?.relatedProjectIds ?? [];

  const resume = await scheduleDeferredResumeForSessionFile({
    sessionFile: input.sessionFile,
    conversationId,
    delay: input.delay?.trim() || DEFAULT_CONVERSATION_SELF_DISTILL_DELAY,
    prompt: buildConversationSelfDistillPrompt(relatedProjectIds),
    title: CONVERSATION_SELF_DISTILL_TITLE,
    notify: 'none',
    requireAck: false,
    autoResumeIfOpen: false,
    source: {
      kind: CONVERSATION_SELF_DISTILL_SOURCE_KIND,
      id: conversationId,
    },
    now: input.now,
  });

  return {
    resume,
    deduped: false,
  };
}

export async function cancelConversationSelfDistillWakeups(input: {
  sessionFile: string;
  conversationId?: string;
  stateRoot?: string;
}): Promise<string[]> {
  const conversationId = input.conversationId?.trim() || readSessionConversationId(input.sessionFile)?.trim() || undefined;
  const stateFile = resolveDeferredResumeStateFile(input.stateRoot);
  const state = loadDeferredResumeState(stateFile);
  const matching = getSessionDeferredResumeEntries(state, input.sessionFile)
    .filter((record) => isConversationSelfDistillSource(record.source))
    .filter((record) => !conversationId || resolveConversationSelfDistillConversationId(record) === conversationId);

  if (matching.length === 0) {
    return [];
  }

  for (const record of matching) {
    removeDeferredResume(state, record.id);
  }
  saveDeferredResumeState(state, stateFile);

  const daemonRoot = resolveDaemonRoot();
  await Promise.allSettled(matching.map((record) => cancelDeferredResumeConversationRun({
    daemonRoot,
    deferredResumeId: record.id,
    sessionFile: record.sessionFile,
    prompt: record.prompt,
    dueAt: record.dueAt,
    createdAt: record.createdAt,
    readyAt: record.readyAt,
    cancelledAt: new Date().toISOString(),
    conversationId: resolveConversationSelfDistillConversationId(record),
    reason: 'Conversation self-distill wakeup cancelled because the conversation became visible again.',
  })));

  return matching.map((record) => record.id);
}
