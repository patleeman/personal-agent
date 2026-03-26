import { getConversationDisplayTitle } from '../conversationTitle';
import type { ActivityEntry, ActivitySnapshot, SessionMeta } from '../types';
import { buildCompanionConversationPath } from './routes';

export type CompanionNotificationKind = 'approval-needed' | 'blocked' | 'completed' | 'needs-review';

function isActionableCompanionNotificationKind(kind: CompanionNotificationKind): boolean {
  return kind === 'approval-needed' || kind === 'blocked' || kind === 'completed';
}

export interface CompanionNotificationCandidate {
  id: string;
  conversationId: string;
  title: string;
  body: string;
  tag: string;
  path: string;
  kind: CompanionNotificationKind;
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

const APPROVAL_NEEDED_PATTERN = /\b(approval needed|needs approval|approve|approval|confirm|confirmation)\b/i;
const BLOCKED_PATTERN = /\b(blocked|waiting for user|waiting on you|offline|merge conflicts?|conflicts?|failed|failure|error|stuck)\b/i;
const COMPLETED_PATTERN = /\b(completed|complete|finished|done|recovered|succeeded|successful|distilled)\b/i;

function classifyActivityNotificationKind(entry: Pick<ActivityEntry, 'summary' | 'details'>): CompanionNotificationKind {
  const haystack = [entry.summary, entry.details ?? '']
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .join('\n');

  if (APPROVAL_NEEDED_PATTERN.test(haystack)) {
    return 'approval-needed';
  }

  if (BLOCKED_PATTERN.test(haystack)) {
    return 'blocked';
  }

  if (COMPLETED_PATTERN.test(haystack)) {
    return 'completed';
  }

  return 'needs-review';
}

function buildActivityNotificationTitle(kind: CompanionNotificationKind, conversationTitle: string): string {
  switch (kind) {
    case 'approval-needed':
      return `Approval needed: ${conversationTitle}`;
    case 'blocked':
      return `Blocked: ${conversationTitle}`;
    case 'completed':
      return `Completed: ${conversationTitle}`;
    default:
      return `Needs review: ${conversationTitle}`;
  }
}

function buildActivityNotificationBody(entry: Pick<ActivityEntry, 'summary' | 'details'>, kind: CompanionNotificationKind): string {
  const detail = firstDetailLine(entry.details);
  if (detail) {
    return detail;
  }

  const summary = entry.summary.trim();
  if (summary.length > 0 && !/^needs review$/i.test(summary)) {
    return summary;
  }

  switch (kind) {
    case 'approval-needed':
      return 'A reply or approval is needed in this conversation.';
    case 'blocked':
      return 'This conversation is blocked until something changes.';
    case 'completed':
      return 'Conversation work completed and is ready for review.';
    default:
      return 'Open the conversation in Personal Agent.';
  }
}

export function collectCompanionActivityNotifications(
  previous: ActivitySnapshot | null,
  next: ActivitySnapshot | null,
  options?: { conversationTitleById?: ReadonlyMap<string, string> },
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

    const conversationTitle = getConversationDisplayTitle(options?.conversationTitleById?.get(conversationId));
    const kind = classifyActivityNotificationKind(entry);
    if (!isActionableCompanionNotificationKind(kind)) {
      return [];
    }

    return [{
      id: `activity:${entry.id}`,
      conversationId,
      title: buildActivityNotificationTitle(kind, conversationTitle),
      body: buildActivityNotificationBody(entry, kind),
      tag: `activity:${entry.id}`,
      path: buildCompanionConversationPath(conversationId),
      kind,
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

  // Session-level state changes are too noisy for companion push alerts.
  // Only explicit linked activity items should trigger notifications.
  return [];
}
