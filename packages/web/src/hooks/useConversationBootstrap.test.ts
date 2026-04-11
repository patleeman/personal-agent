import { describe, expect, it } from 'vitest';
import type { ConversationBootstrapState, SessionDetail, SessionMeta } from '../types';
import {
  buildConversationBootstrapVersionKey,
  mergeConversationBootstrapWithCachedSessionDetail,
  primeConversationBootstrapCache,
  resolveConversationBootstrapSeed,
} from './useConversationBootstrap';

function createSessionMeta(id = 'conv-1'): SessionMeta {
  return {
    id,
    file: `/tmp/${id}.jsonl`,
    timestamp: '2026-04-06T12:00:00.000Z',
    cwd: '/tmp/project',
    cwdSlug: '--tmp-project--',
    model: 'gpt-5.4',
    title: 'Cached conversation',
    messageCount: 2,
  };
}

function createSessionDetail(signature = 'sig-1', text = 'Cached reply', id = 'conv-1'): SessionDetail {
  return {
    meta: createSessionMeta(id),
    blocks: [{ type: 'text', id: 'assistant-1', ts: '2026-04-06T12:00:01.000Z', text }],
    blockOffset: 0,
    totalBlocks: 1,
    contextUsage: null,
    signature,
  };
}

function createBootstrapState(overrides?: Partial<ConversationBootstrapState>): ConversationBootstrapState {
  return {
    conversationId: 'conv-1',
    sessionDetail: createSessionDetail(),
    liveSession: { live: false },
    ...overrides,
  };
}

function createWindowedBootstrapState(): ConversationBootstrapState {
  return {
    conversationId: 'conv-1',
    sessionDetail: {
      meta: createSessionMeta(),
      blocks: [
        { type: 'text', id: 'assistant-1', ts: '2026-04-06T12:00:01.000Z', text: 'Reply 1' },
        { type: 'text', id: 'assistant-2', ts: '2026-04-06T12:00:02.000Z', text: 'Reply 2' },
        { type: 'text', id: 'assistant-3', ts: '2026-04-06T12:00:03.000Z', text: 'Reply 3' },
      ],
      blockOffset: 2,
      totalBlocks: 5,
      contextUsage: null,
      signature: 'sig-1',
    },
    liveSession: { live: false },
  };
}

describe('resolveConversationBootstrapSeed', () => {
  it('returns an idle empty state when there is no conversation id', () => {
    expect(resolveConversationBootstrapSeed(undefined)).toEqual({
      data: null,
      loading: false,
    });
  });

  it('reports a loading state when the conversation is not cached yet', () => {
    expect(resolveConversationBootstrapSeed('conv-seed-miss', { tailBlocks: 120 })).toEqual({
      data: null,
      loading: true,
    });
  });

  it('reuses the in-memory bootstrap cache synchronously', () => {
    const conversationId = 'conv-seed-hit';
    const bootstrap = createBootstrapState({ conversationId, sessionDetail: createSessionDetail('sig-seed', 'Warm reply', conversationId) });
    primeConversationBootstrapCache(conversationId, bootstrap, { tailBlocks: 120 }, '7:3');

    expect(resolveConversationBootstrapSeed(conversationId, { tailBlocks: 120 })).toEqual({
      data: {
        ...bootstrap,
        sessionDetailSignature: 'sig-seed',
      },
      loading: false,
    });
  });
});

describe('buildConversationBootstrapVersionKey', () => {
  it('tracks both session list and session file invalidations', () => {
    expect(buildConversationBootstrapVersionKey({ sessionsVersion: 0, sessionFilesVersion: 0 })).toBe('0:0');
    expect(buildConversationBootstrapVersionKey({ sessionsVersion: 7, sessionFilesVersion: 3 })).toBe('7:3');
  });
});

describe('mergeConversationBootstrapWithCachedSessionDetail', () => {
  it('reuses the cached transcript window when the server says the session detail is unchanged', () => {
    const cached = createBootstrapState();

    const next = createBootstrapState({
      sessionDetail: null,
      sessionDetailUnchanged: true,
      sessionDetailSignature: 'sig-1',
      liveSession: { live: false },
    });

    const merged = mergeConversationBootstrapWithCachedSessionDetail(cached, next);
    expect(merged.sessionDetail).toEqual(cached.sessionDetail);
    expect(merged.sessionDetailSignature).toBe('sig-1');
    expect(merged.sessionDetailUnchanged).toBeUndefined();
  });

  it('keeps the response transcript empty when the cached signature no longer matches', () => {
    const cached = createBootstrapState();

    const next = createBootstrapState({
      sessionDetail: null,
      sessionDetailUnchanged: true,
      sessionDetailSignature: 'sig-2',
      liveSession: { live: false },
    });

    const merged = mergeConversationBootstrapWithCachedSessionDetail(cached, next);
    expect(merged.sessionDetail).toBeNull();
    expect(merged.sessionDetailUnchanged).toBe(true);
    expect(merged.sessionDetailSignature).toBe('sig-2');
  });

  it('merges append-only bootstrap transcript updates onto the cached window', () => {
    const cached = createWindowedBootstrapState();
    const merged = mergeConversationBootstrapWithCachedSessionDetail(cached, {
      conversationId: 'conv-1',
      sessionDetail: null,
      sessionDetailAppendOnly: {
        appendOnly: true,
        meta: createSessionMeta(),
        blocks: [{ type: 'text', id: 'assistant-4', ts: '2026-04-06T12:00:04.000Z', text: 'Reply 4' }],
        blockOffset: 3,
        totalBlocks: 6,
        contextUsage: null,
        signature: 'sig-2',
      },
      sessionDetailSignature: 'sig-2',
      liveSession: { live: false },
    });

    expect(merged.sessionDetail).toEqual({
      meta: createSessionMeta(),
      blocks: [
        { type: 'text', id: 'assistant-2', ts: '2026-04-06T12:00:02.000Z', text: 'Reply 2' },
        { type: 'text', id: 'assistant-3', ts: '2026-04-06T12:00:03.000Z', text: 'Reply 3' },
        { type: 'text', id: 'assistant-4', ts: '2026-04-06T12:00:04.000Z', text: 'Reply 4' },
      ],
      blockOffset: 3,
      totalBlocks: 6,
      contextUsage: null,
      signature: 'sig-2',
    });
    expect(merged.sessionDetailAppendOnly).toBeUndefined();
  });

  it('copies the transcript signature onto the bootstrap envelope when a full detail payload arrives', () => {
    const merged = mergeConversationBootstrapWithCachedSessionDetail(null, createBootstrapState({
      sessionDetailSignature: undefined,
    }));

    expect(merged.sessionDetailSignature).toBe('sig-1');
    expect(merged.sessionDetail?.signature).toBe('sig-1');
  });
});
