import { describe, expect, it } from 'vitest';

import {
  clearQueuedStaleTurn,
  clearStaleTurnStateAfterTerminalEvent,
  createLiveSessionStaleTurnState,
  hasQueuedOrActiveStaleTurn,
  shouldSuppressLiveEventForStaleTurn,
} from './liveSessionStaleTurns.js';

describe('live session stale turn state', () => {
  it('does not support stale turn state or suppress events', () => {
    const state = createLiveSessionStaleTurnState();
    state.queuedStaleTurnCustomTypes = ['legacy-hidden'];
    state.activeStaleTurnCustomType = 'legacy-active';

    expect(hasQueuedOrActiveStaleTurn(state)).toBe(false);
    expect(clearQueuedStaleTurn(state, { type: 'agent_start' } as any)).toBeNull();
    expect(state.queuedStaleTurnCustomTypes).toEqual([]);
    expect(state.activeStaleTurnCustomType).toBeNull();
    expect(shouldSuppressLiveEventForStaleTurn(state, { type: 'message_update' } as any)).toBe(false);
  });

  it('clears stale turn state without preserving suppression behavior', () => {
    const state = createLiveSessionStaleTurnState();
    state.queuedStaleTurnCustomTypes = ['queued'];
    state.activeStaleTurnCustomType = 'active';

    expect(clearStaleTurnStateAfterTerminalEvent(state, { type: 'turn_end' } as any)).toBe(true);
    expect(state.queuedStaleTurnCustomTypes).toEqual([]);
    expect(state.activeStaleTurnCustomType).toBeNull();
    expect(hasQueuedOrActiveStaleTurn(state)).toBe(false);
  });
});
