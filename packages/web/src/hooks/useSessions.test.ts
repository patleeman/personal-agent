import { describe, expect, it } from 'vitest';
import type { SessionDetail, SessionMeta } from '../shared/types';
import {
  mergeSessionDetailResultWithCachedDetail,
  primeSessionDetailCache,
  resolveSessionDetailSeed,
} from './useSessions';

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

function createSessionDetail(signature = 'sig-1', id = 'conv-1'): SessionDetail {
  return {
    meta: createSessionMeta(id),
    blocks: [{ type: 'text', id: 'assistant-1', ts: '2026-04-06T12:00:01.000Z', text: 'Cached reply' }],
    blockOffset: 0,
    totalBlocks: 1,
    contextUsage: null,
    signature,
  };
}

function createWindowedSessionDetail(signature = 'sig-1'): SessionDetail {
  return {
    meta: createSessionMeta(),
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

describe('resolveSessionDetailSeed', () => {
  it('returns an idle empty state when there is no session id', () => {
    expect(resolveSessionDetailSeed(undefined)).toEqual({
      detail: null,
      loading: false,
    });
  });

  it('reports a loading state when the session detail is not cached yet', () => {
    expect(resolveSessionDetailSeed('conv-detail-seed-miss', { tailBlocks: 120 })).toEqual({
      detail: null,
      loading: true,
    });
  });

  it('reuses the in-memory session detail cache synchronously', () => {
    const sessionId = 'conv-detail-seed-hit';
    const detail = createSessionDetail('sig-seed', sessionId);
    primeSessionDetailCache(sessionId, detail, { tailBlocks: 120 }, 9);

    expect(resolveSessionDetailSeed(sessionId, { tailBlocks: 120 })).toEqual({
      detail,
      loading: false,
    });
  });
});

describe('mergeSessionDetailResultWithCachedDetail', () => {
  it('reuses the cached transcript when the session detail response is unchanged', () => {
    const cached = createSessionDetail();

    const merged = mergeSessionDetailResultWithCachedDetail(cached, {
      unchanged: true,
      sessionId: cached.meta.id,
      signature: 'sig-1',
    });

    expect(merged).toBe(cached);
  });

  it('drops the reuse path when the server reports a different signature', () => {
    const merged = mergeSessionDetailResultWithCachedDetail(createSessionDetail('sig-1'), {
      unchanged: true,
      sessionId: 'conv-1',
      signature: 'sig-2',
    });

    expect(merged).toBeNull();
  });

  it('merges append-only transcript updates onto the cached window', () => {
    const cached = createWindowedSessionDetail('sig-1');
    const merged = mergeSessionDetailResultWithCachedDetail(cached, {
      appendOnly: true,
      meta: cached.meta,
      blocks: [{ type: 'text', id: 'assistant-4', ts: '2026-04-06T12:00:04.000Z', text: 'Reply 4' }],
      blockOffset: 3,
      totalBlocks: 6,
      contextUsage: null,
      signature: 'sig-2',
    });

    expect(merged).toEqual({
      meta: cached.meta,
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

  it('passes through full detail payloads unchanged', () => {
    const detail = createSessionDetail('sig-3');
    expect(mergeSessionDetailResultWithCachedDetail(null, detail)).toEqual(detail);
  });
});
