import { describe, expect, it } from 'vitest';
import type { StreamState } from './useSessionStream';
import { INITIAL_STREAM_STATE, selectVisibleStreamState } from './useSessionStream';

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
