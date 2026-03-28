import { describe, expect, it } from 'vitest';
import {
  clearWarmLiveSessionState,
  listWarmLiveSessionStateIds,
  readWarmLiveSessionState,
  writeWarmLiveSessionState,
} from './liveSessionWarmth';
import { INITIAL_STREAM_STATE, shouldPersistWarmLiveSessionState } from './hooks/useSessionStream';

describe('liveSessionWarmth', () => {
  it('stores and clears warm live session state by conversation id', () => {
    const sessionId = 'conv-live-cache';
    const state = {
      ...INITIAL_STREAM_STATE,
      hasSnapshot: true,
      blocks: [{ type: 'text' as const, id: 'assistant-1', ts: '2026-03-28T12:00:00.000Z', text: 'Fresh live snapshot' }],
      totalBlocks: 1,
    };

    clearWarmLiveSessionState(sessionId);
    writeWarmLiveSessionState(sessionId, state);

    expect(readWarmLiveSessionState(sessionId)).toBe(state);
    expect(listWarmLiveSessionStateIds()).toContain(sessionId);

    clearWarmLiveSessionState(sessionId);
    expect(readWarmLiveSessionState(sessionId)).toBeNull();
  });
});

describe('shouldPersistWarmLiveSessionState', () => {
  it('skips completely empty stream state', () => {
    expect(shouldPersistWarmLiveSessionState(INITIAL_STREAM_STATE)).toBe(false);
  });

  it('keeps meaningful live state warm for hidden tabs', () => {
    expect(shouldPersistWarmLiveSessionState({
      ...INITIAL_STREAM_STATE,
      isStreaming: true,
    })).toBe(true);

    expect(shouldPersistWarmLiveSessionState({
      ...INITIAL_STREAM_STATE,
      hasSnapshot: true,
      blocks: [{ type: 'text', ts: '2026-03-28T12:05:00.000Z', text: 'ready' }],
      totalBlocks: 1,
    })).toBe(true);
  });
});
