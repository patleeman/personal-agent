import { getConversationDisplayTitle } from '../conversationTitle';
import type { ActivitySnapshot, SessionMeta } from '../types';
import { buildCompanionConversationPath } from './routes';

export interface CompanionNotificationCandidate {
  id: string;
  conversationId: string;
  title: string;
  body: string;
  tag: string;
  path: string;
}

function firstDetailLine(details: string | null | undefined): string | null {
  if (typeof details !== 'string') {
    return null;
  }

  const line = details
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);

  return line ?? null;
}

function buildActivityNotificationBody(details: string | null | undefined): string {
  return firstDetailLine(details) ?? 'Open the conversation in Pi Companion.';
}

function buildSessionNotificationBody(session: SessionMeta): string {
  const unreadMessages = session.attentionUnreadMessageCount ?? 0;
  const unreadActivities = session.attentionUnreadActivityCount ?? 0;

  if (unreadActivities > 0) {
    return 'A new attention-worthy update is waiting in this conversation.';
  }

  if (unreadMessages > 0) {
    return `New output is ready${unreadMessages > 1 ? ` (${unreadMessages} unread messages)` : ''}.`;
  }

  return 'This conversation has a new update waiting for review.';
}

export function collectCompanionActivityNotifications(
  previous: ActivitySnapshot | null,
  next: ActivitySnapshot | null,
): CompanionNotificationCandidate[] {
  if (!previous || !next) {
    return [];
  }

  const previouslyUnreadIds = new Set(
    previous.entries
      .filter((entry) => !entry.read)
      .map((entry) => entry.id),
  );

  return next.entries.flatMap((entry): CompanionNotificationCandidate[] => {
    if (entry.read) {
      return [];
    }

    const conversationId = entry.relatedConversationIds?.length === 1
      ? entry.relatedConversationIds[0] ?? null
      : null;
    if (!conversationId || previouslyUnreadIds.has(entry.id)) {
      return [];
    }

    return [{
      id: `activity:${entry.id}`,
      conversationId,
      title: entry.summary,
      body: buildActivityNotificationBody(entry.details),
      tag: `activity:${entry.id}`,
      path: buildCompanionConversationPath(conversationId),
    }];
  });
}

export function collectCompanionSessionNotifications(
  previous: SessionMeta[] | null,
  next: SessionMeta[] | null,
  options?: { suppressConversationIds?: ReadonlySet<string> },
): CompanionNotificationCandidate[] {
  if (!previous || !next) {
    return [];
  }

  const previousById = new Map(previous.map((session) => [session.id, session] as const));
  const suppressConversationIds = options?.suppressConversationIds ?? new Set<string>();

  return next.flatMap((session): CompanionNotificationCandidate[] => {
    if (suppressConversationIds.has(session.id) || !session.needsAttention) {
      return [];
    }

    const prior = previousById.get(session.id);
    if (!prior) {
      return [];
    }

    const attentionChanged = prior.attentionUpdatedAt !== session.attentionUpdatedAt
      || prior.attentionUnreadMessageCount !== session.attentionUnreadMessageCount
      || prior.attentionUnreadActivityCount !== session.attentionUnreadActivityCount
      || prior.needsAttention !== session.needsAttention;
    if (!attentionChanged) {
      return [];
    }

    const title = prior.isRunning && !session.isRunning
      ? `Finished: ${getConversationDisplayTitle(session.title)}`
      : `Needs review: ${getConversationDisplayTitle(session.title)}`;

    return [{
      id: `session:${session.id}:${session.attentionUpdatedAt ?? session.timestamp}`,
      conversationId: session.id,
      title,
      body: buildSessionNotificationBody(session),
      tag: `session:${session.id}`,
      path: buildCompanionConversationPath(session.id),
    }];
  });
}
