import { describe, expect, it } from 'vitest';
import {
  applyLiveSessionState,
  buildSyntheticLiveSessionMeta,
  collectAttentionConversationIds,
  collectConversationAttentionIds,
  sessionNeedsAttention,
} from './sessionIndicators';

describe('sessionIndicators', () => {
  it('builds synthetic live session metadata with running state', () => {
    expect(buildSyntheticLiveSessionMeta({
      id: 'live-1',
      cwd: '/tmp/workspace',
      sessionFile: '/tmp/workspace/live-1.jsonl',
      isStreaming: true,
    })).toMatchObject({
      id: 'live-1',
      cwd: '/tmp/workspace',
      file: '/tmp/workspace/live-1.jsonl',
      cwdSlug: '-tmp-workspace',
      title: 'New Conversation',
      messageCount: 0,
      isRunning: true,
      isLive: true,
    });
  });

  it('applies live running state to existing sessions and clears stale flags', () => {
    const sessions = [
      {
        id: 'running-now',
        file: '/tmp/running-now.jsonl',
        timestamp: '2026-03-11T17:00:00.000Z',
        cwd: '/tmp/workspace',
        cwdSlug: '-tmp-workspace',
        model: 'gpt-5',
        title: 'Running now',
        messageCount: 3,
      },
      {
        id: 'stale-running-flag',
        file: '/tmp/stale-running-flag.jsonl',
        timestamp: '2026-03-11T16:00:00.000Z',
        cwd: '/tmp/workspace',
        cwdSlug: '-tmp-workspace',
        model: 'gpt-5',
        title: 'Stale running flag',
        messageCount: 5,
        isRunning: true,
      },
    ];

    expect(applyLiveSessionState(sessions, [
      { id: 'running-now', isStreaming: true },
      { id: 'stale-running-flag', isStreaming: false },
    ])).toEqual([
      {
        ...sessions[0],
        isRunning: true,
        isLive: true,
      },
      {
        ...sessions[1],
        isRunning: false,
        isLive: true,
      },
    ]);
  });

  it('collects unread conversation-linked attention ids', () => {
    expect(collectAttentionConversationIds([
      {
        id: 'entry-1',
        createdAt: '2026-03-11T17:00:00.000Z',
        profile: 'assistant',
        kind: 'scheduled-task',
        summary: 'Done',
        read: false,
        relatedConversationIds: ['conv-1', 'conv-2'],
      },
      {
        id: 'entry-2',
        createdAt: '2026-03-11T17:05:00.000Z',
        profile: 'assistant',
        kind: 'note',
        summary: 'Already seen',
        read: true,
        relatedConversationIds: ['conv-2'],
      },
      {
        id: 'entry-3',
        createdAt: '2026-03-11T17:10:00.000Z',
        profile: 'assistant',
        kind: 'follow-up',
        summary: 'No conversation link',
        read: false,
      },
    ])).toEqual(new Set(['conv-1', 'conv-2']));
  });

  it('merges unseen message attention with unread activity attention', () => {
    expect(collectConversationAttentionIds({
      sessions: [
        {
          id: 'conv-1',
          file: '/tmp/conv-1.jsonl',
          timestamp: '2026-03-11T17:00:00.000Z',
          cwd: '/tmp/workspace',
          cwdSlug: '-tmp-workspace',
          model: 'gpt-5',
          title: 'Background reply waiting',
          messageCount: 6,
        },
        {
          id: 'conv-2',
          file: '/tmp/conv-2.jsonl',
          timestamp: '2026-03-11T17:05:00.000Z',
          cwd: '/tmp/workspace',
          cwdSlug: '-tmp-workspace',
          model: 'gpt-5',
          title: 'Still running',
          messageCount: 8,
          isRunning: true,
        },
        {
          id: 'conv-3',
          file: '/tmp/conv-3.jsonl',
          timestamp: '2026-03-11T17:10:00.000Z',
          cwd: '/tmp/workspace',
          cwdSlug: '-tmp-workspace',
          model: 'gpt-5',
          title: 'Already seen',
          messageCount: 4,
        },
      ],
      unreadConversationIds: new Set(['conv-activity']),
      seenMessageCounts: {
        'conv-1': 5,
        'conv-2': 7,
        'conv-3': 4,
      },
      activeConversationId: 'conv-3',
    })).toEqual(new Set(['conv-1', 'conv-activity']));
  });

  it('suppresses attention while a conversation is still running', () => {
    expect(sessionNeedsAttention({ needsAttention: true, isRunning: true })).toBe(false);
    expect(sessionNeedsAttention({ needsAttention: true, isRunning: false })).toBe(true);
    expect(sessionNeedsAttention({ needsAttention: false, isRunning: false })).toBe(false);
  });
});
