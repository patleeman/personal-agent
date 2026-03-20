import { describe, expect, it } from 'vitest';
import type { MessageBlock } from '../types';
import type { StreamState } from './useSessionStream';
import { INITIAL_STREAM_STATE, normalizePendingQueueItems, selectVisibleStreamState, shouldReplaceOptimisticUserBlock } from './useSessionStream';

describe('normalizePendingQueueItems', () => {
  it('keeps only string queue entries', () => {
    expect(normalizePendingQueueItems(['first', 2, null, 'second'])).toEqual(['first', 'second']);
  });

  it('falls back to an empty queue for non-array payloads', () => {
    expect(normalizePendingQueueItems(undefined)).toEqual([]);
    expect(normalizePendingQueueItems({ steering: ['bad-shape'] })).toEqual([]);
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
      text: '/skill:workflow-checkpoint commit only my files',
    };
    const next: MessageBlock = {
      type: 'user',
      ts: '2026-03-19T12:00:01.000Z',
      text: [
        '<skill name="workflow-checkpoint" location="/state/profiles/shared/agent/skills/workflow-checkpoint/SKILL.md">',
        'References are relative to /state/profiles/shared/agent/skills/workflow-checkpoint.',
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
        '<skill name="workflow-checkpoint" location="/state/profiles/shared/agent/skills/workflow-checkpoint/SKILL.md">',
        'References are relative to /state/profiles/shared/agent/skills/workflow-checkpoint.',
        '</skill>',
      ].join('\n'),
    };

    expect(shouldReplaceOptimisticUserBlock(previous, next)).toBe(false);
  });
});
