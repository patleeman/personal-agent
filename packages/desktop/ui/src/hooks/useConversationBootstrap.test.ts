import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationBootstrapState, SessionDetail, SessionMeta } from '../shared/types';

const apiMocks = vi.hoisted(() => ({
  conversationBootstrap: vi.fn(),
}));

const persistenceMocks = vi.hoisted(() => ({
  readPersistedConversationBootstrapEntry: vi.fn(),
  writePersistedConversationBootstrapEntry: vi.fn(),
}));

vi.mock('../client/api', () => ({
  api: apiMocks,
}));

vi.mock('../conversation/conversationBootstrapPersistence', () => persistenceMocks);

import {
  buildConversationBootstrapVersionKey,
  fetchConversationBootstrapCached,
  primeConversationBootstrapCache,
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

function createBootstrapState(conversationId = 'conv-1', overrides?: Partial<ConversationBootstrapState>): ConversationBootstrapState {
  return {
    conversationId,
    sessionDetail: createSessionDetail('sig-1', 'Cached reply', conversationId),
    liveSession: { live: false },
    ...overrides,
  };
}

function createWindowedBootstrapState(conversationId = 'conv-1'): ConversationBootstrapState {
  return {
    conversationId,
    sessionDetail: {
      meta: createSessionMeta(conversationId),
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

describe('useConversationBootstrap cache helpers', () => {
  beforeEach(() => {
    apiMocks.conversationBootstrap.mockReset();
    persistenceMocks.readPersistedConversationBootstrapEntry.mockReset();
    persistenceMocks.writePersistedConversationBootstrapEntry.mockReset();
    persistenceMocks.readPersistedConversationBootstrapEntry.mockResolvedValue(null);
    persistenceMocks.writePersistedConversationBootstrapEntry.mockResolvedValue(undefined);
  });

  it('reuses the in-memory bootstrap cache synchronously', async () => {
    const conversationId = 'conv-seed-hit';
    const bootstrap = createBootstrapState(conversationId, {
      sessionDetail: createSessionDetail('sig-seed', 'Warm reply', conversationId),
    });
    primeConversationBootstrapCache(conversationId, bootstrap, { tailBlocks: 120 }, '7:3');

    await expect(fetchConversationBootstrapCached(conversationId, { tailBlocks: 120 }, '7:3')).resolves.toEqual({
      ...bootstrap,
      sessionDetailSignature: 'sig-seed',
    });
    expect(apiMocks.conversationBootstrap).not.toHaveBeenCalled();
  });

  it('fetches an uncached bootstrap from the api', async () => {
    const conversationId = 'conv-cache-miss';
    const bootstrap = createBootstrapState(conversationId, {
      sessionDetail: createSessionDetail('sig-fresh', 'Fresh reply', conversationId),
    });
    apiMocks.conversationBootstrap.mockResolvedValueOnce(bootstrap);

    await expect(fetchConversationBootstrapCached(conversationId, { tailBlocks: 120 }, '1:0')).resolves.toEqual({
      ...bootstrap,
      sessionDetailSignature: 'sig-fresh',
    });
    expect(apiMocks.conversationBootstrap).toHaveBeenCalledWith(conversationId, { tailBlocks: 120 });
  });

  it('reuses the cached transcript window when the server says the session detail is unchanged', async () => {
    const conversationId = 'conv-unchanged';
    const cached = createBootstrapState(conversationId);
    primeConversationBootstrapCache(conversationId, cached, { tailBlocks: 120 }, '0:0');
    apiMocks.conversationBootstrap.mockResolvedValueOnce({
      conversationId,
      sessionDetail: null,
      sessionDetailUnchanged: true,
      sessionDetailSignature: 'sig-1',
      liveSession: { live: false },
    });

    await expect(fetchConversationBootstrapCached(conversationId, { tailBlocks: 120 }, '1:0')).resolves.toEqual({
      ...cached,
      sessionDetailSignature: 'sig-1',
    });
    expect(apiMocks.conversationBootstrap).toHaveBeenCalledWith(conversationId, {
      tailBlocks: 120,
      knownSessionSignature: 'sig-1',
      knownBlockOffset: 0,
      knownTotalBlocks: 1,
      knownLastBlockId: 'assistant-1',
    });
  });

  it('falls back to a fresh bootstrap payload when cached reuse is no longer valid', async () => {
    const conversationId = 'conv-fallback';
    primeConversationBootstrapCache(conversationId, createBootstrapState(conversationId), { tailBlocks: 120 }, '0:0');
    const fresh = createBootstrapState(conversationId, {
      sessionDetail: createSessionDetail('sig-2', 'Fresh fallback', conversationId),
      sessionDetailSignature: 'sig-2',
    });
    apiMocks.conversationBootstrap
      .mockResolvedValueOnce({
        conversationId,
        sessionDetail: null,
        sessionDetailUnchanged: true,
        sessionDetailSignature: 'sig-2',
        liveSession: { live: false },
      })
      .mockResolvedValueOnce(fresh);

    await expect(fetchConversationBootstrapCached(conversationId, { tailBlocks: 120 }, '1:0')).resolves.toEqual(fresh);
    expect(apiMocks.conversationBootstrap).toHaveBeenNthCalledWith(1, conversationId, {
      tailBlocks: 120,
      knownSessionSignature: 'sig-1',
      knownBlockOffset: 0,
      knownTotalBlocks: 1,
      knownLastBlockId: 'assistant-1',
    });
    expect(apiMocks.conversationBootstrap).toHaveBeenNthCalledWith(2, conversationId, { tailBlocks: 120 });
  });

  it('merges append-only bootstrap transcript updates onto the cached window', async () => {
    const conversationId = 'conv-append-only';
    primeConversationBootstrapCache(conversationId, createWindowedBootstrapState(conversationId), { tailBlocks: 120 }, '0:0');
    apiMocks.conversationBootstrap.mockResolvedValueOnce({
      conversationId,
      sessionDetail: null,
      sessionDetailAppendOnly: {
        appendOnly: true,
        meta: createSessionMeta(conversationId),
        blocks: [{ type: 'text', id: 'assistant-4', ts: '2026-04-06T12:00:04.000Z', text: 'Reply 4' }],
        blockOffset: 3,
        totalBlocks: 6,
        contextUsage: null,
        signature: 'sig-2',
      },
      sessionDetailSignature: 'sig-2',
      liveSession: { live: false },
    });

    await expect(fetchConversationBootstrapCached(conversationId, { tailBlocks: 120 }, '1:0')).resolves.toEqual({
      conversationId,
      sessionDetail: {
        meta: createSessionMeta(conversationId),
        blocks: [
          { type: 'text', id: 'assistant-2', ts: '2026-04-06T12:00:02.000Z', text: 'Reply 2' },
          { type: 'text', id: 'assistant-3', ts: '2026-04-06T12:00:03.000Z', text: 'Reply 3' },
          { type: 'text', id: 'assistant-4', ts: '2026-04-06T12:00:04.000Z', text: 'Reply 4' },
        ],
        blockOffset: 3,
        totalBlocks: 6,
        contextUsage: null,
        signature: 'sig-2',
      },
      sessionDetailSignature: 'sig-2',
      liveSession: { live: false },
    });
  });

  it('tracks both session list and session file invalidations in the version key', () => {
    expect(buildConversationBootstrapVersionKey({ sessionsVersion: 0, sessionFilesVersion: 0 })).toBe('0:0');
    expect(buildConversationBootstrapVersionKey({ sessionsVersion: 7, sessionFilesVersion: 3 })).toBe('7:3');
  });
});
