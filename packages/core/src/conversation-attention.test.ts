import { mkdtempSync, readFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ensureConversationAttentionBaselines,
  loadConversationAttentionState,
  markConversationAttentionRead,
  markConversationAttentionUnread,
  mergeConversationAttentionStateDocuments,
  resolveConversationAttentionStatePath,
  summarizeConversationAttention,
} from './conversation-attention.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-conversation-attention-'));
  tempDirs.push(dir);
  return dir;
}

describe('conversation attention storage', () => {
  it('resolves the profile-scoped attention state path', () => {
    const stateRoot = createTempStateRoot();
    expect(resolveConversationAttentionStatePath({ stateRoot, profile: 'assistant' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'conversation-attention', 'assistant.json'));
  });

  it('creates baseline records from current message counts', () => {
    const stateRoot = createTempStateRoot();

    const document = ensureConversationAttentionBaselines({
      stateRoot,
      profile: 'assistant',
      updatedAt: '2026-03-12T12:00:00.000Z',
      conversations: [
        { conversationId: 'conv-123', messageCount: 5 },
      ],
    });

    expect(document.conversations['conv-123']).toEqual({
      conversationId: 'conv-123',
      acknowledgedMessageCount: 5,
      readAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '2026-03-12T12:00:00.000Z',
    });

    expect(readFileSync(resolveConversationAttentionStatePath({ stateRoot, profile: 'assistant' }), 'utf-8'))
      .toContain('"conv-123"');
  });

  it('marks conversations read and unread', () => {
    const stateRoot = createTempStateRoot();

    ensureConversationAttentionBaselines({
      stateRoot,
      profile: 'assistant',
      updatedAt: '2026-03-12T12:00:00.000Z',
      conversations: [
        { conversationId: 'conv-123', messageCount: 5 },
      ],
    });

    markConversationAttentionUnread({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      updatedAt: '2026-03-12T12:05:00.000Z',
    });

    expect(loadConversationAttentionState({ stateRoot, profile: 'assistant' }).conversations['conv-123'])
      .toEqual({
        conversationId: 'conv-123',
        acknowledgedMessageCount: 5,
        readAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '2026-03-12T12:05:00.000Z',
        forcedUnread: true,
      });

    markConversationAttentionRead({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      messageCount: 9,
      updatedAt: '2026-03-12T12:10:00.000Z',
    });

    expect(loadConversationAttentionState({ stateRoot, profile: 'assistant' }).conversations['conv-123'])
      .toEqual({
        conversationId: 'conv-123',
        acknowledgedMessageCount: 9,
        readAt: '2026-03-12T12:10:00.000Z',
        updatedAt: '2026-03-12T12:10:00.000Z',
      });
  });
});

describe('conversation attention merges', () => {
  it('merges conversation records by conversation id and preserves newer attention state', () => {
    const merged = mergeConversationAttentionStateDocuments({
      documents: [
        {
          version: 1,
          profile: 'assistant',
          conversations: {
            'conv-123': {
              conversationId: 'conv-123',
              acknowledgedMessageCount: 5,
              readAt: '2026-03-12T12:05:00.000Z',
              updatedAt: '2026-03-12T12:05:00.000Z',
            },
            'conv-456': {
              conversationId: 'conv-456',
              acknowledgedMessageCount: 1,
              readAt: '1970-01-01T00:00:00.000Z',
              updatedAt: '2026-03-12T12:00:00.000Z',
            },
          },
        },
        {
          version: 1,
          profile: 'assistant',
          conversations: {
            'conv-123': {
              conversationId: 'conv-123',
              acknowledgedMessageCount: 9,
              readAt: '1970-01-01T00:00:00.000Z',
              updatedAt: '2026-03-12T12:09:00.000Z',
            },
            'conv-789': {
              conversationId: 'conv-789',
              acknowledgedMessageCount: 2,
              readAt: '1970-01-01T00:00:00.000Z',
              updatedAt: '2026-03-12T12:06:00.000Z',
              forcedUnread: true,
            },
          },
        },
      ],
    });

    expect(merged).toEqual({
      version: 1,
      profile: 'assistant',
      conversations: {
        'conv-123': {
          conversationId: 'conv-123',
          acknowledgedMessageCount: 9,
          readAt: '2026-03-12T12:05:00.000Z',
          updatedAt: '2026-03-12T12:09:00.000Z',
        },
        'conv-456': {
          conversationId: 'conv-456',
          acknowledgedMessageCount: 1,
          readAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '2026-03-12T12:00:00.000Z',
        },
        'conv-789': {
          conversationId: 'conv-789',
          acknowledgedMessageCount: 2,
          readAt: '1970-01-01T00:00:00.000Z',
          updatedAt: '2026-03-12T12:06:00.000Z',
          forcedUnread: true,
        },
      },
    });
  });

  it('rejects merges across different profiles', () => {
    expect(() => mergeConversationAttentionStateDocuments({
      documents: [
        {
          version: 1,
          profile: 'assistant',
          conversations: {},
        },
        {
          version: 1,
          profile: 'datadog',
          conversations: {},
        },
      ],
    })).toThrow('different profiles');
  });
});

describe('conversation attention summaries', () => {
  it('reports unread messages and linked unread activity newer than the last read time', () => {
    const stateRoot = createTempStateRoot();

    ensureConversationAttentionBaselines({
      stateRoot,
      profile: 'assistant',
      updatedAt: '2026-03-12T12:00:00.000Z',
      conversations: [
        { conversationId: 'conv-123', messageCount: 5 },
        { conversationId: 'conv-456', messageCount: 2 },
      ],
    });

    markConversationAttentionRead({
      stateRoot,
      profile: 'assistant',
      conversationId: 'conv-123',
      messageCount: 5,
      updatedAt: '2026-03-12T12:05:00.000Z',
    });

    const summaries = summarizeConversationAttention({
      stateRoot,
      profile: 'assistant',
      conversations: [
        { conversationId: 'conv-123', messageCount: 8, lastActivityAt: '2026-03-12T12:09:00.000Z' },
        { conversationId: 'conv-456', messageCount: 2, lastActivityAt: '2026-03-12T12:04:00.000Z' },
      ],
      unreadActivityEntries: [
        { id: 'older', createdAt: '2026-03-12T12:01:00.000Z', relatedConversationIds: ['conv-123'] },
        { id: 'newer', createdAt: '2026-03-12T12:08:00.000Z', relatedConversationIds: ['conv-123'] },
      ],
    });

    expect(summaries).toEqual([
      {
        conversationId: 'conv-123',
        acknowledgedMessageCount: 5,
        readAt: '2026-03-12T12:05:00.000Z',
        updatedAt: '2026-03-12T12:05:00.000Z',
        forcedUnread: false,
        unreadMessageCount: 3,
        unreadActivityCount: 1,
        unreadActivityIds: ['newer'],
        needsAttention: true,
        attentionUpdatedAt: '2026-03-12T12:08:00.000Z',
      },
      {
        conversationId: 'conv-456',
        acknowledgedMessageCount: 2,
        readAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '2026-03-12T12:00:00.000Z',
        forcedUnread: false,
        unreadMessageCount: 0,
        unreadActivityCount: 0,
        unreadActivityIds: [],
        needsAttention: false,
        attentionUpdatedAt: '2026-03-12T12:00:00.000Z',
      },
    ]);
  });
});
