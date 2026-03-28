import {
  getConversationProjectLink,
  loadDeferredResumeState,
  readSessionConversationId,
  resolveDeferredResumeStateFile,
  type DeferredResumeRecord,
} from '@personal-agent/core';
import {
  scheduleDeferredResumeForSessionFile,
  toDeferredResumeSummary,
  type DeferredResumeSummary,
} from './deferredResumes.js';

export const CONVERSATION_SELF_DISTILL_SOURCE_KIND = 'conversation-self-distill';
export const DEFAULT_CONVERSATION_SELF_DISTILL_DELAY = '2h';
export const CONVERSATION_SELF_DISTILL_TITLE = 'Self-distill durable follow-up';

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

function findExistingConversationSelfDistillWakeup(input: {
  conversationId: string;
  stateRoot?: string;
}): DeferredResumeRecord | undefined {
  const state = loadDeferredResumeState(resolveDeferredResumeStateFile(input.stateRoot));
  return Object.values(state.resumes)
    .find((entry) => entry.source?.kind === CONVERSATION_SELF_DISTILL_SOURCE_KIND && entry.source?.id === input.conversationId);
}

function buildConversationSelfDistillPrompt(relatedProjectIds: string[]): string {
  const lines = [
    'Self-distill this conversation with a high bar.',
    'Keep raw conversations raw unless this thread clearly produced durable value that should outlive the conversation.',
    'Default to no durable change.',
    '',
    'Allowed first-pass outcomes:',
    '- no-op if nothing clearly deserves a durable update or the durable value is already captured elsewhere.',
    '- note update when the conversation produced reusable knowledge that belongs in a shared note node.',
    '- project update when the conversation materially changed the state, blockers, decisions, or next steps of an already-linked project.',
    relatedProjectIds.length > 0
      ? `Currently linked projects: ${relatedProjectIds.map((projectId) => `@${projectId}`).join(', ')}`
      : 'No projects are currently linked to this conversation.',
    '',
    'Do not edit AGENTS.md or create/update skills unless the user explicitly asked for that in this conversation.',
    'If you create or update a note, check for an existing matching note node first so you do not duplicate durable knowledge.',
    'Prefer the smallest durable change that preserves the value.',
    'Reply briefly with either "No durable update needed." or the durable change you made.',
  ];

  return lines.join('\n');
}

export async function scheduleConversationSelfDistillWakeup(
  input: ScheduleConversationSelfDistillWakeupInput,
): Promise<ScheduleConversationSelfDistillWakeupResult> {
  const conversationId = resolveConversationId(input);
  const existing = findExistingConversationSelfDistillWakeup({
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
    autoResumeIfOpen: true,
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
