import {
  createProjectActivityEntry,
  setActivityConversationLinks,
  writeProfileActivityEntry,
} from '@personal-agent/core';
import { invalidateAppTopics } from '../shared/appEvents.js';

export type ConversationMemoryDistillActivityKind = 'conversation-node-distilled' | 'conversation-node-distill-failed';

interface WriteConversationMemoryDistillActivityOptions {
  stateRoot?: string;
  profile: string;
  conversationId: string;
  kind: ConversationMemoryDistillActivityKind;
  summary: string;
  details: string;
  relatedProjectIds: string[];
}

function createConversationMemoryActivityId(kind: ConversationMemoryDistillActivityKind): string {
  const prefix = kind === 'conversation-node-distilled' ? 'node-distill' : 'node-distill-fail';
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${timestamp}-${suffix}`;
}

function buildConversationMemoryDistillFailureDetails(error: string): string {
  const message = error.trim() || 'Unknown conversation memory maintenance error.';
  return `Distillation failed for this conversation.\nError: ${message}`;
}

export function writeConversationMemoryDistillActivity(options: WriteConversationMemoryDistillActivityOptions): string {
  const activityId = createConversationMemoryActivityId(options.kind);
  const createdAt = new Date().toISOString();
  const entry = createProjectActivityEntry({
    id: activityId,
    createdAt,
    profile: options.profile,
    kind: options.kind,
    summary: options.summary,
    details: options.details,
    relatedProjectIds: options.relatedProjectIds,
  });

  writeProfileActivityEntry({
    stateRoot: options.stateRoot,
    profile: options.profile,
    entry,
  });

  setActivityConversationLinks({
    stateRoot: options.stateRoot,
    profile: options.profile,
    activityId,
    relatedConversationIds: [options.conversationId],
  });

  invalidateAppTopics('activity', 'sessions');
  return activityId;
}

export function writeConversationMemoryDistillFailureActivity(options: {
  stateRoot?: string;
  profile: string;
  conversationId: string;
  error: string;
  relatedProjectIds: string[];
}): string {
  return writeConversationMemoryDistillActivity({
    stateRoot: options.stateRoot,
    profile: options.profile,
    conversationId: options.conversationId,
    kind: 'conversation-node-distill-failed',
    summary: 'Conversation page distillation failed',
    details: buildConversationMemoryDistillFailureDetails(options.error),
    relatedProjectIds: options.relatedProjectIds,
  });
}
