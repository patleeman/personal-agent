import { describe, expect, it } from 'vitest';
import type { ConversationBootstrapState, SessionDetail, SessionMeta } from '../types';
import {
  buildConversationBootstrapVersionKey,
  mergeConversationBootstrapWithCachedSessionDetail,
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

function createSessionDetail(signature = 'sig-1', text = 'Cached reply'): SessionDetail {
  return {
    meta: createSessionMeta(),
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

  it('copies the transcript signature onto the bootstrap envelope when a full detail payload arrives', () => {
    const merged = mergeConversationBootstrapWithCachedSessionDetail(null, createBootstrapState({
      sessionDetailSignature: undefined,
    }));

    expect(merged.sessionDetailSignature).toBe('sig-1');
    expect(merged.sessionDetail?.signature).toBe('sig-1');
  });
});
