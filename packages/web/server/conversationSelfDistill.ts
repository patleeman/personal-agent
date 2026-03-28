import { existsSync } from 'node:fs';
import {
  getConversationProjectLink,
  loadDeferredResumeState,
  readSessionConversationId,
  resolveDeferredResumeStateFile,
  type DeferredResumeRecord,
} from '@personal-agent/core';
import { isConversationMemoryDistillRecoveryTitle } from './conversationMemoryMaintenance.js';
import {
  scheduleDeferredResumeForSessionFile,
  toDeferredResumeSummary,
  type DeferredResumeSummary,
} from './deferredResumes.js';

export const CONVERSATION_SELF_DISTILL_SOURCE_KIND = 'conversation-self-distill';
export const DEFAULT_CONVERSATION_SELF_DISTILL_DELAY = '2h';
export const CONVERSATION_SELF_DISTILL_TITLE = 'Self-distill durable follow-up';
const AUTOMATIC_SELF_DISTILL_PROJECT_LINK_COUNT = 1;

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

export interface MaybeScheduleAutomaticConversationSelfDistillWakeupInput {
  profile: string;
  conversationId: string;
  sessionFile?: string;
  title?: string;
  stateRoot?: string;
  now?: Date;
}

export interface MaybeScheduleAutomaticConversationSelfDistillWakeupResult {
  scheduled: boolean;
  deduped: boolean;
  reason: 'scheduled' | 'deduped' | 'missing-session-file' | 'recovery-conversation' | 'not-eligible';
  resume?: DeferredResumeSummary;
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
    'Review the recent progress in this conversation with a high bar for durable updates.',
    'Keep raw conversations raw unless this thread clearly produced durable value that should outlive the conversation.',
    'Default to no durable change.',
    '',
    'Do exactly one of these:',
    '- no durable update',
    '- update an existing note node or create a new note node for clearly reusable knowledge',
    '- update linked project state or project notes when the conversation materially changed status, blockers, decisions, or next steps',
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

export async function maybeScheduleAutomaticConversationSelfDistillWakeup(
  input: MaybeScheduleAutomaticConversationSelfDistillWakeupInput,
): Promise<MaybeScheduleAutomaticConversationSelfDistillWakeupResult> {
  const sessionFile = input.sessionFile?.trim();
  if (!sessionFile || !existsSync(sessionFile)) {
    return {
      scheduled: false,
      deduped: false,
      reason: 'missing-session-file',
    };
  }

  if (isConversationMemoryDistillRecoveryTitle(input.title)) {
    return {
      scheduled: false,
      deduped: false,
      reason: 'recovery-conversation',
    };
  }

  const relatedProjectIds = getConversationProjectLink({
    stateRoot: input.stateRoot,
    profile: input.profile,
    conversationId: input.conversationId,
  })?.relatedProjectIds ?? [];

  if (relatedProjectIds.length !== AUTOMATIC_SELF_DISTILL_PROJECT_LINK_COUNT) {
    return {
      scheduled: false,
      deduped: false,
      reason: 'not-eligible',
    };
  }

  const scheduled = await scheduleConversationSelfDistillWakeup({
    stateRoot: input.stateRoot,
    profile: input.profile,
    sessionFile,
    conversationId: input.conversationId,
    now: input.now,
  });

  return {
    scheduled: true,
    deduped: scheduled.deduped,
    reason: scheduled.deduped ? 'deduped' : 'scheduled',
    resume: scheduled.resume,
  };
}
