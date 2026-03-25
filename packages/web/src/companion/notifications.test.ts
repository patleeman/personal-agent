import { describe, expect, it } from 'vitest';
import type { ActivitySnapshot, SessionMeta } from '../types';
import {
  collectCompanionActivityNotifications,
  collectCompanionSessionNotifications,
} from './notifications';

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'conv-123',
    file: '/tmp/conv-123.jsonl',
    timestamp: '2026-03-25T00:00:00.000Z',
    cwd: '/repo',
    cwdSlug: 'repo',
    model: 'openai/gpt-5.4',
    title: 'Conversation',
    messageCount: 12,
    isRunning: false,
    ...overrides,
  };
}

function createActivitySnapshot(entries: ActivitySnapshot['entries']): ActivitySnapshot {
  return {
    entries,
    unreadCount: entries.filter((entry) => !entry.read).length,
  };
}

describe('collectCompanionActivityNotifications', () => {
  it('notifies for new unread approval activity linked to exactly one conversation', () => {
    const notifications = collectCompanionActivityNotifications(
      createActivitySnapshot([]),
      createActivitySnapshot([{
        id: 'activity-1',
        createdAt: '2026-03-25T00:00:00.000Z',
        profile: 'assistant',
        kind: 'note',
        summary: 'Approval needed',
        details: 'Pick a deployment target.',
        read: false,
        relatedConversationIds: ['conv-123'],
      }]),
      {
        conversationTitleById: new Map([['conv-123', 'Build companion app']]),
      },
    );

    expect(notifications).toEqual([
      expect.objectContaining({
        conversationId: 'conv-123',
        kind: 'approval-needed',
        title: 'Approval needed: Build companion app',
        body: 'Pick a deployment target.',
        path: '/app/conversations/conv-123',
      }),
    ]);
  });

  it('classifies blocked activity notifications explicitly', () => {
    const notifications = collectCompanionActivityNotifications(
      createActivitySnapshot([]),
      createActivitySnapshot([{
        id: 'activity-1',
        createdAt: '2026-03-25T00:00:00.000Z',
        profile: 'assistant',
        kind: 'service',
        summary: 'Sync blocked by merge conflicts (2 files).',
        read: false,
        relatedConversationIds: ['conv-123'],
      }]),
      {
        conversationTitleById: new Map([['conv-123', 'Sync repo']]),
      },
    );

    expect(notifications).toEqual([
      expect.objectContaining({
        conversationId: 'conv-123',
        kind: 'blocked',
        title: 'Blocked: Sync repo',
        body: 'Sync blocked by merge conflicts (2 files).',
      }),
    ]);
  });

  it('ignores baseline unread activity and multi-conversation activity', () => {
    const previous = createActivitySnapshot([{
      id: 'activity-1',
      createdAt: '2026-03-25T00:00:00.000Z',
      profile: 'assistant',
      kind: 'note',
      summary: 'Already there',
      read: false,
      relatedConversationIds: ['conv-123'],
    }]);

    const notifications = collectCompanionActivityNotifications(previous, createActivitySnapshot([
      previous.entries[0]!,
      {
        id: 'activity-2',
        createdAt: '2026-03-25T00:01:00.000Z',
        profile: 'assistant',
        kind: 'note',
        summary: 'Too many conversations',
        read: false,
        relatedConversationIds: ['conv-123', 'conv-456'],
      },
    ]));

    expect(notifications).toEqual([]);
  });
});

describe('collectCompanionSessionNotifications', () => {
  it('notifies when a running conversation finishes with new unread output', () => {
    const notifications = collectCompanionSessionNotifications(
      [createSession({ id: 'conv-123', title: 'Build companion app', isRunning: true, needsAttention: false })],
      [createSession({
        id: 'conv-123',
        title: 'Build companion app',
        isRunning: false,
        needsAttention: true,
        attentionUpdatedAt: '2026-03-25T00:05:00.000Z',
        attentionUnreadMessageCount: 2,
      })],
    );

    expect(notifications).toEqual([
      expect.objectContaining({
        conversationId: 'conv-123',
        kind: 'completed',
        title: 'Completed: Build companion app',
      }),
    ]);
  });

  it('falls back to needs-review when attention changes without a completion transition', () => {
    const notifications = collectCompanionSessionNotifications(
      [createSession({ id: 'conv-123', title: 'Build companion app', isRunning: false, needsAttention: false })],
      [createSession({
        id: 'conv-123',
        title: 'Build companion app',
        isRunning: false,
        needsAttention: true,
        attentionUpdatedAt: '2026-03-25T00:06:00.000Z',
        attentionUnreadMessageCount: 1,
      })],
    );

    expect(notifications).toEqual([
      expect.objectContaining({
        conversationId: 'conv-123',
        kind: 'needs-review',
        title: 'Needs review: Build companion app',
      }),
    ]);
  });

  it('suppresses generic session notifications when a conversation already has a new activity notification', () => {
    const notifications = collectCompanionSessionNotifications(
      [createSession({ id: 'conv-123', needsAttention: false })],
      [createSession({
        id: 'conv-123',
        needsAttention: true,
        attentionUpdatedAt: '2026-03-25T00:06:00.000Z',
      })],
      { suppressConversationIds: new Set(['conv-123']) },
    );

    expect(notifications).toEqual([]);
  });
});
