import { describe, expect, it } from 'vitest';
import type { SessionDetail, SessionMeta } from '../types';
import { mergeSessionDetailResultWithCachedDetail } from './useSessions';

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

function createSessionDetail(signature = 'sig-1'): SessionDetail {
  return {
    meta: createSessionMeta(),
    blocks: [{ type: 'text', id: 'assistant-1', ts: '2026-04-06T12:00:01.000Z', text: 'Cached reply' }],
    blockOffset: 0,
    totalBlocks: 1,
    contextUsage: null,
    signature,
  };
}

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

  it('passes through full detail payloads unchanged', () => {
    const detail = createSessionDetail('sig-3');
    expect(mergeSessionDetailResultWithCachedDetail(null, detail)).toEqual(detail);
  });
});
