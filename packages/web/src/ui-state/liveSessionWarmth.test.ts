import { describe, expect, it } from 'vitest';
import {
  clearWarmLiveSessionState,
  listWarmLiveSessionStateIds,
  readWarmLiveSessionState,
  writeWarmLiveSessionState,
} from './liveSessionWarmth';
import type { StreamState } from '../hooks/useSessionStream';

function createStreamState(overrides: Partial<StreamState> = {}): StreamState {
  return {
    blocks: [],
    blockOffset: 0,
    totalBlocks: 0,
    hasSnapshot: false,
    isStreaming: false,
    isCompacting: false,
    error: null,
    title: null,
    tokens: null,
    cost: null,
    contextUsage: null,
    pendingQueue: { steering: [], followUp: [] },
    presence: {
      surfaces: [],
      controllerSurfaceId: null,
      controllerSurfaceType: null,
      controllerAcquiredAt: null,
    },
    autoModeState: null,
    cwdChange: null,
    ...overrides,
  };
}

describe('liveSessionWarmth', () => {
  it('stores and clears warm live session state by conversation id', () => {
    const sessionId = 'conv-live-cache';
    const state = createStreamState({
      hasSnapshot: true,
      blocks: [{ type: 'text' as const, id: 'assistant-1', ts: '2026-03-28T12:00:00.000Z', text: 'Fresh live snapshot' }],
      totalBlocks: 1,
    });

    clearWarmLiveSessionState(sessionId);
    writeWarmLiveSessionState(sessionId, state);

    expect(readWarmLiveSessionState(sessionId)).toBe(state);
    expect(listWarmLiveSessionStateIds()).toContain(sessionId);

    clearWarmLiveSessionState(sessionId);
    expect(readWarmLiveSessionState(sessionId)).toBeNull();
  });
});

