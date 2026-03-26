import { getConversationDisplayTitle } from '../conversationTitle';
import type { AlertEntry, AlertSnapshot, SessionMeta } from '../types';
import { buildCompanionConversationPath } from './routes';

export type CompanionNotificationKind = 'approval-needed' | 'blocked' | 'completed' | 'reminder';

export interface CompanionNotificationCandidate {
  id: string;
  conversationId: string;
  title: string;
  body: string;
  tag: string;
  path: string;
  kind: CompanionNotificationKind;
}

function notificationKindForAlert(entry: AlertEntry): CompanionNotificationKind {
  if (entry.kind === 'approval-needed') {
    return 'approval-needed';
  }

  if (entry.kind === 'task-failed' || entry.kind === 'blocked') {
    return 'blocked';
  }

  if (entry.kind === 'reminder') {
    return 'reminder';
  }

  return 'completed';
}

function notificationTitle(entry: AlertEntry, conversationTitle: string): string {
  if (entry.title.trim().length > 0) {
    return entry.title;
  }

  switch (notificationKindForAlert(entry)) {
    case 'approval-needed':
      return `Approval needed: ${conversationTitle}`;
    case 'blocked':
      return `Blocked: ${conversationTitle}`;
    case 'reminder':
      return `Reminder: ${conversationTitle}`;
    default:
      return `Update: ${conversationTitle}`;
  }
}

export function collectCompanionAlertNotifications(
  previous: AlertSnapshot | null,
  next: AlertSnapshot | null,
  options?: { conversationTitleById?: ReadonlyMap<string, string> },
): CompanionNotificationCandidate[] {
  if (!previous || !next) {
    return [];
  }

  const previousActiveIds = new Set(
    previous.entries
      .filter((entry) => entry.status === 'active')
      .map((entry) => entry.id),
  );

  return next.entries.flatMap((entry): CompanionNotificationCandidate[] => {
    if (entry.status !== 'active' || previousActiveIds.has(entry.id) || !entry.conversationId) {
      return [];
    }

    const conversationTitle = getConversationDisplayTitle(options?.conversationTitleById?.get(entry.conversationId));
    return [{
      id: `alert:${entry.id}`,
      conversationId: entry.conversationId,
      title: notificationTitle(entry, conversationTitle),
      body: entry.body,
      tag: `alert:${entry.id}`,
      path: buildCompanionConversationPath(entry.conversationId),
      kind: notificationKindForAlert(entry),
    }];
  });
}

export function collectCompanionSessionNotifications(
  previous: SessionMeta[] | null,
  next: SessionMeta[] | null,
  options?: { suppressConversationIds?: ReadonlySet<string> },
): CompanionNotificationCandidate[] {
  void previous;
  void next;
  void options;
  return [];
}
