import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionDetail, SessionMeta } from '../shared/types';

const apiMocks = vi.hoisted(() => ({
  sessionDetail: vi.fn(),
}));

vi.mock('../client/api', () => ({
  api: apiMocks,
}));

import { fetchSessionDetailCached, primeSessionDetailCache } from './useSessions';

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

function createSessionDetail(signature = 'sig-1', id = 'conv-1', text = 'Cached reply'): SessionDetail {
  return {
    meta: createSessionMeta(id),
    blocks: [{ type: 'text', id: 'assistant-1', ts: '2026-04-06T12:00:01.000Z', text }],
    blockOffset: 0,
    totalBlocks: 1,
    contextUsage: null,
    signature,
  };
}

function createWindowedSessionDetail(id = 'conv-1', signature = 'sig-1'): SessionDetail {
  return {
    meta: createSessionMeta(id),
    blocks: [
      { type: 'text', id: 'assistant-1', ts: '2026-04-06T12:00:01.000Z', text: 'Reply 1' },
      { type: 'text', id: 'assistant-2', ts: '2026-04-06T12:00:02.000Z', text: 'Reply 2' },
      { type: 'text', id: 'assistant-3', ts: '2026-04-06T12:00:03.000Z', text: 'Reply 3' },
    ],
    blockOffset: 2,
    totalBlocks: 5,
    contextUsage: null,
    signature,
  };
}

describe('useSessions cache helpers', () => {
  beforeEach(() => {
    apiMocks.sessionDetail.mockReset();
  });

  it('reuses the in-memory session detail cache synchronously', async () => {
    const sessionId = 'conv-detail-seed-hit';
    const detail = createSessionDetail('sig-seed', sessionId);
    primeSessionDetailCache(sessionId, detail, { tailBlocks: 120 }, 9);

    await expect(fetchSessionDetailCached(sessionId, { tailBlocks: 120 }, 9)).resolves.toEqual(detail);
    expect(apiMocks.sessionDetail).not.toHaveBeenCalled();
  });

  it('fetches uncached session detail from the api', async () => {
    const sessionId = 'conv-detail-cache-miss';
    const detail = createSessionDetail('sig-fresh', sessionId, 'Fresh reply');
    apiMocks.sessionDetail.mockResolvedValueOnce(detail);

    await expect(fetchSessionDetailCached(sessionId, { tailBlocks: 120 }, 1)).resolves.toEqual(detail);
    expect(apiMocks.sessionDetail).toHaveBeenCalledWith(sessionId, { tailBlocks: 120 });
  });

  it('reuses the cached transcript when the session detail response is unchanged', async () => {
    const sessionId = 'conv-detail-unchanged';
    const cached = createSessionDetail('sig-1', sessionId);
    primeSessionDetailCache(sessionId, cached, { tailBlocks: 120 }, 0);
    apiMocks.sessionDetail.mockResolvedValueOnce({
      unchanged: true,
      sessionId,
      signature: 'sig-1',
    });

    await expect(fetchSessionDetailCached(sessionId, { tailBlocks: 120 }, 1)).resolves.toBe(cached);
    expect(apiMocks.sessionDetail).toHaveBeenCalledWith(sessionId, {
      tailBlocks: 120,
      knownSessionSignature: 'sig-1',
      knownBlockOffset: 0,
      knownTotalBlocks: 1,
      knownLastBlockId: 'assistant-1',
    });
  });

  it('falls back to a fresh transcript payload when cached reuse is no longer valid', async () => {
    const sessionId = 'conv-detail-fallback';
    primeSessionDetailCache(sessionId, createSessionDetail('sig-1', sessionId), { tailBlocks: 120 }, 0);
    const fresh = createSessionDetail('sig-2', sessionId, 'Fresh fallback');
    apiMocks.sessionDetail
      .mockResolvedValueOnce({
        unchanged: true,
        sessionId,
        signature: 'sig-2',
      })
      .mockResolvedValueOnce(fresh);

    await expect(fetchSessionDetailCached(sessionId, { tailBlocks: 120 }, 1)).resolves.toEqual(fresh);
    expect(apiMocks.sessionDetail).toHaveBeenNthCalledWith(1, sessionId, {
      tailBlocks: 120,
      knownSessionSignature: 'sig-1',
      knownBlockOffset: 0,
      knownTotalBlocks: 1,
      knownLastBlockId: 'assistant-1',
    });
    expect(apiMocks.sessionDetail).toHaveBeenNthCalledWith(2, sessionId, { tailBlocks: 120 });
  });

  it('merges append-only transcript updates onto the cached window', async () => {
    const sessionId = 'conv-detail-append-only';
    primeSessionDetailCache(sessionId, createWindowedSessionDetail(sessionId, 'sig-1'), { tailBlocks: 120 }, 0);
    apiMocks.sessionDetail.mockResolvedValueOnce({
      appendOnly: true,
      meta: createSessionMeta(sessionId),
      blocks: [{ type: 'text', id: 'assistant-4', ts: '2026-04-06T12:00:04.000Z', text: 'Reply 4' }],
      blockOffset: 3,
      totalBlocks: 6,
      contextUsage: null,
      signature: 'sig-2',
    });

    await expect(fetchSessionDetailCached(sessionId, { tailBlocks: 120 }, 1)).resolves.toEqual({
      meta: createSessionMeta(sessionId),
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
  });
});
