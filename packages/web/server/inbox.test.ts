import { describe, expect, it } from 'vitest';
import {
  INBOX_RETENTION_MS,
  listArchivedAttentionSessions,
  listExpiredActivityRecords,
  listExpiredAttentionSessions,
  listStandaloneActivityRecords,
  type InboxActivityRecordLike,
  type InboxSessionLike,
} from './inbox.js';

function createActivityRecord(overrides: Partial<InboxActivityRecordLike> = {}): InboxActivityRecordLike {
  return {
    entry: {
      id: 'activity-1',
      createdAt: '2026-03-20T10:00:00.000Z',
      relatedConversationIds: [],
      ...overrides.entry,
    },
    read: false,
    ...overrides,
  };
}

function createSession(overrides: Partial<InboxSessionLike> = {}): InboxSessionLike {
  return {
    id: 'conv-1',
    messageCount: 4,
    needsAttention: true,
    attentionUpdatedAt: '2026-03-20T10:00:00.000Z',
    ...overrides,
  };
}

describe('inbox helpers', () => {
  it('treats conversation-linked activity as non-standalone', () => {
    const records = [
      createActivityRecord({ entry: { id: 'standalone', createdAt: '2026-03-20T10:00:00.000Z' } }),
      createActivityRecord({ entry: { id: 'linked', createdAt: '2026-03-20T10:00:00.000Z', relatedConversationIds: ['conv-1'] } }),
    ];

    expect(listStandaloneActivityRecords(records, ['conv-1']).map((record) => record.entry.id)).toEqual(['standalone']);
  });

  it('returns only archived conversations that still need attention', () => {
    const sessions = [
      createSession({ id: 'open-conversation' }),
      createSession({ id: 'archived-conversation' }),
      createSession({ id: 'already-read', needsAttention: false }),
    ];

    expect(listArchivedAttentionSessions(sessions, ['open-conversation']).map((session) => session.id))
      .toEqual(['archived-conversation']);
  });

  it('finds expired activity and attention using the retention cutoff', () => {
    const now = Date.parse('2026-03-21T12:00:00.000Z');
    const cutoffMs = now - INBOX_RETENTION_MS;

    const records = [
      createActivityRecord({ entry: { id: 'expired-activity', createdAt: '2026-03-20T12:00:00.000Z' } }),
      createActivityRecord({ entry: { id: 'fresh-activity', createdAt: '2026-03-20T12:00:00.001Z' } }),
    ];
    const sessions = [
      createSession({ id: 'expired-conversation', attentionUpdatedAt: '2026-03-20T12:00:00.000Z' }),
      createSession({ id: 'fresh-conversation', attentionUpdatedAt: '2026-03-20T12:00:00.001Z' }),
      createSession({ id: 'invalid-timestamp', attentionUpdatedAt: 'not-a-date' }),
    ];

    expect(listExpiredActivityRecords(records, cutoffMs).map((record) => record.entry.id))
      .toEqual(['expired-activity']);
    expect(listExpiredAttentionSessions(sessions, cutoffMs).map((session) => session.id))
      .toEqual(['expired-conversation']);
  });
});
