import { describe, expect, it } from 'vitest';
import type { MessageBlock } from '../types';
import type { StreamState } from './useSessionStream';
import {
  appendPendingQueueItem,
  INITIAL_STREAM_STATE,
  normalizePendingQueueItems,
  removeOptimisticUserBlock,
  removePendingQueueItem,
  resolveSessionStreamSubscriptionId,
  selectVisibleStreamState,
  shouldReplaceOptimisticUserBlock,
  shouldRetrySessionStreamAfterError,
} from './useSessionStream';

describe('resolveSessionStreamSubscriptionId', () => {
  it('disables the live stream subscription when explicitly turned off', () => {
    expect(resolveSessionStreamSubscriptionId('session-a', { enabled: false })).toBeNull();
  });

  it('keeps the requested session id when streaming is enabled', () => {
    expect(resolveSessionStreamSubscriptionId('session-a', { enabled: true })).toBe('session-a');
    expect(resolveSessionStreamSubscriptionId('session-a')).toBe('session-a');
  });
});

describe('shouldRetrySessionStreamAfterError', () => {
  it('retries when the probe fails or the server errors', () => {
    expect(shouldRetrySessionStreamAfterError()).toBe(true);
    expect(shouldRetrySessionStreamAfterError(500)).toBe(true);
    expect(shouldRetrySessionStreamAfterError(503)).toBe(true);
  });

  it('does not retry when the session is definitively gone', () => {
    expect(shouldRetrySessionStreamAfterError(404)).toBe(false);
    expect(shouldRetrySessionStreamAfterError(400)).toBe(false);
  });
});

describe('normalizePendingQueueItems', () => {
  it('normalizes string queue entries into structured previews', () => {
    expect(normalizePendingQueueItems(['first', 2, null, 'second'])).toEqual([
      { id: expect.any(String), text: 'first', imageCount: 0 },
      { id: expect.any(String), text: 'second', imageCount: 0 },
    ]);
  });

  it('preserves structured queue previews from the server', () => {
    expect(normalizePendingQueueItems([{ id: 'steer-0', text: 'draft (+1 image)', imageCount: 1 }])).toEqual([
      { id: 'steer-0', text: 'draft (+1 image)', imageCount: 1 },
    ]);
  });

  it('falls back to an empty queue for non-array payloads', () => {
    expect(normalizePendingQueueItems(undefined)).toEqual([]);
    expect(normalizePendingQueueItems({ steering: ['bad-shape'] })).toEqual([]);
  });
});

describe('pending queue optimistic updates', () => {
  it('removes a failed optimistic user block by id', () => {
    const state: StreamState = {
      ...INITIAL_STREAM_STATE,
      blocks: [
        { type: 'user', id: 'user-1', ts: '2026-03-23T00:00:00.000Z', text: 'hello' },
        { type: 'text', id: 'assistant-1', ts: '2026-03-23T00:00:01.000Z', text: 'hi' },
        { type: 'user', id: 'user-2', ts: '2026-03-23T00:00:02.000Z', text: 'failed send' },
      ],
      totalBlocks: 3,
    };

    expect(removeOptimisticUserBlock(state, 'user-2')).toEqual({
      ...state,
      blocks: [
        { type: 'user', id: 'user-1', ts: '2026-03-23T00:00:00.000Z', text: 'hello' },
        { type: 'text', id: 'assistant-1', ts: '2026-03-23T00:00:01.000Z', text: 'hi' },
      ],
      totalBlocks: 2,
    });
  });

  it('tracks queued follow-up text in pending queue state immediately', () => {
    expect(appendPendingQueueItem(INITIAL_STREAM_STATE, 'followUp', 'queued follow-up').pendingQueue).toEqual({
      steering: [],
      followUp: [{ id: expect.any(String), text: 'queued follow-up', imageCount: 0 }],
    });
  });

  it('removes only the most recent matching optimistic queue item', () => {
    const state: StreamState = {
      ...INITIAL_STREAM_STATE,
      pendingQueue: {
        steering: [{ id: 'steer-1', text: 'first steer', imageCount: 0 }],
        followUp: [
          { id: 'dup-1', text: 'duplicate', imageCount: 0 },
          { id: 'stable-1', text: 'stable', imageCount: 0 },
          { id: 'dup-2', text: 'duplicate', imageCount: 0 },
        ],
      },
    };

    expect(removePendingQueueItem(state, 'followUp', 'duplicate').pendingQueue).toEqual({
      steering: [{ id: 'steer-1', text: 'first steer', imageCount: 0 }],
      followUp: [
        { id: 'dup-1', text: 'duplicate', imageCount: 0 },
        { id: 'stable-1', text: 'stable', imageCount: 0 },
      ],
    });
  });
});

describe('selectVisibleStreamState', () => {
  it('hides stale stream data after navigating to a different session', () => {
    const staleState: StreamState = {
      ...INITIAL_STREAM_STATE,
      blocks: [{ type: 'text', ts: '2026-03-11T16:32:19.000Z', text: 'Old response' }],
      isStreaming: true,
      title: 'Existing conversation title',
      error: 'stale error',
      tokens: { input: 10, output: 20, total: 30 },
      cost: 0.12,
      contextUsage: { tokens: 30 },
    };

    expect(selectVisibleStreamState(staleState, 'session-a', 'session-b')).toEqual(INITIAL_STREAM_STATE);
  });

  it('returns the current stream state when the session id still matches', () => {
    const state: StreamState = {
      ...INITIAL_STREAM_STATE,
      title: 'Current conversation title',
    };

    expect(selectVisibleStreamState(state, 'session-a', 'session-a')).toBe(state);
  });
});

describe('shouldReplaceOptimisticUserBlock', () => {
  it('replaces an optimistic /skill bubble with the expanded skill block', () => {
    const previous: MessageBlock = {
      type: 'user',
      ts: '2026-03-19T12:00:00.000Z',
      text: '/skill:checkpoint commit only my files',
    };
    const next: MessageBlock = {
      type: 'user',
      ts: '2026-03-19T12:00:01.000Z',
      text: [
        '<skill name="checkpoint" location="/state/profiles/shared/agent/skills/checkpoint/SKILL.md">',
        'References are relative to /state/profiles/shared/agent/skills/checkpoint.',
        '</skill>',
      ].join('\n'),
    };

    expect(shouldReplaceOptimisticUserBlock(previous, next)).toBe(true);
  });

  it('does not replace normal user messages', () => {
    const previous: MessageBlock = {
      type: 'user',
      ts: '2026-03-19T12:00:00.000Z',
      text: 'hello there',
    };
    const next: MessageBlock = {
      type: 'user',
      ts: '2026-03-19T12:00:01.000Z',
      text: [
        '<skill name="checkpoint" location="/state/profiles/shared/agent/skills/checkpoint/SKILL.md">',
        'References are relative to /state/profiles/shared/agent/skills/checkpoint.',
        '</skill>',
      ].join('\n'),
    };

    expect(shouldReplaceOptimisticUserBlock(previous, next)).toBe(false);
  });
});
