import { describe, expect, it } from 'vitest';
import type { AlertSnapshot, SessionMeta } from '../types';
import {
  collectCompanionAlertNotifications,
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

function createAlertSnapshot(entries: AlertSnapshot['entries']): AlertSnapshot {
  return {
    entries,
    activeCount: entries.filter((entry) => entry.status === 'active').length,
  };
}

describe('collectCompanionAlertNotifications', () => {
  it('notifies for new active reminders linked to a conversation', () => {
    const notifications = collectCompanionAlertNotifications(
      createAlertSnapshot([]),
      createAlertSnapshot([{
        id: 'alert-1',
        profile: 'assistant',
        kind: 'reminder',
        severity: 'disruptive',
        status: 'active',
        title: 'Watch the prod gates',
        body: 'Approve the kube changes when the prompt appears.',
        createdAt: '2026-03-25T00:00:00.000Z',
        updatedAt: '2026-03-25T00:00:00.000Z',
        conversationId: 'conv-123',
        sourceKind: 'reminder-tool',
        sourceId: 'resume-123',
        requiresAck: true,
      }]),
      {
        conversationTitleById: new Map([['conv-123', 'Build companion app']]),
      },
    );

    expect(notifications).toEqual([
      expect.objectContaining({
        conversationId: 'conv-123',
        kind: 'reminder',
        title: 'Watch the prod gates',
        body: 'Approve the kube changes when the prompt appears.',
        path: '/app/conversations/conv-123',
      }),
    ]);
  });

  it('ignores existing active alerts and alerts without a conversation', () => {
    const previous = createAlertSnapshot([{
      id: 'alert-1',
      profile: 'assistant',
      kind: 'reminder',
      severity: 'disruptive',
      status: 'active',
      title: 'Already active',
      body: 'Existing alert',
      createdAt: '2026-03-25T00:00:00.000Z',
      updatedAt: '2026-03-25T00:00:00.000Z',
      conversationId: 'conv-123',
      sourceKind: 'reminder-tool',
      sourceId: 'resume-123',
      requiresAck: true,
    }]);

    const notifications = collectCompanionAlertNotifications(previous, createAlertSnapshot([
      previous.entries[0]!,
      {
        id: 'alert-2',
        profile: 'assistant',
        kind: 'task-completed',
        severity: 'disruptive',
        status: 'active',
        title: 'Done',
        body: 'But not linked to a conversation',
        createdAt: '2026-03-25T00:01:00.000Z',
        updatedAt: '2026-03-25T00:01:00.000Z',
        sourceKind: 'scheduled-task',
        sourceId: 'task-1',
        requiresAck: false,
      },
    ]));

    expect(notifications).toEqual([]);
  });
});

describe('collectCompanionSessionNotifications', () => {
  it('suppresses session-level companion notifications to avoid generic update spam', () => {
    const notifications = collectCompanionSessionNotifications(
      [createSession({ id: 'conv-123', title: 'Build companion app', isRunning: true, needsAttention: false })],
      [createSession({
        id: 'conv-123',
        title: 'Build companion app',
        isRunning: false,
        needsAttention: true,
        attentionUpdatedAt: '2026-03-25T00:05:00.000Z',
        attentionUnreadMessageCount: 2,
        attentionUnreadActivityCount: 1,
      })],
      { suppressConversationIds: new Set(['conv-123']) },
    );

    expect(notifications).toEqual([]);
  });
});
