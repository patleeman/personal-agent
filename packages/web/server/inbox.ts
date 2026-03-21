export const INBOX_RETENTION_MS = 24 * 60 * 60 * 1000;

export interface InboxActivityRecordLike {
  entry: {
    id: string;
    createdAt: string;
    relatedConversationIds?: string[];
  };
  read: boolean;
}

export interface InboxSessionLike {
  id: string;
  messageCount: number;
  needsAttention?: boolean;
  attentionUpdatedAt?: string;
}

function toIdSet(ids: Iterable<string>): Set<string> {
  return new Set(Array.from(ids)
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0));
}

function parseTimestampMs(value?: string): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function listStandaloneActivityRecords<T extends InboxActivityRecordLike>(
  records: T[],
  knownConversationIds: Iterable<string>,
): T[] {
  const knownConversationIdSet = toIdSet(knownConversationIds);

  return records.filter((record) => {
    const relatedConversationIds = record.entry.relatedConversationIds ?? [];
    return !relatedConversationIds.some((conversationId) => knownConversationIdSet.has(conversationId));
  });
}

export function listArchivedAttentionSessions<T extends InboxSessionLike>(
  sessions: T[],
  openConversationIds: Iterable<string>,
): T[] {
  const openConversationIdSet = toIdSet(openConversationIds);

  return sessions.filter((session) => !openConversationIdSet.has(session.id) && Boolean(session.needsAttention));
}

export function listExpiredActivityRecords<T extends InboxActivityRecordLike>(
  records: T[],
  cutoffMs: number,
): T[] {
  return records.filter((record) => {
    const createdAtMs = parseTimestampMs(record.entry.createdAt);
    return createdAtMs !== null && createdAtMs <= cutoffMs;
  });
}

export function listExpiredAttentionSessions<T extends InboxSessionLike>(
  sessions: T[],
  cutoffMs: number,
): T[] {
  return sessions.filter((session) => {
    if (!session.needsAttention) {
      return false;
    }

    const attentionUpdatedAtMs = parseTimestampMs(session.attentionUpdatedAt);
    return attentionUpdatedAtMs !== null && attentionUpdatedAtMs <= cutoffMs;
  });
}
