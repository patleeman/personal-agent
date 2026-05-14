import { describe, expect, it } from 'vitest';

import {
  activateNextHiddenTurn,
  clearActiveHiddenTurnAfterTerminalEvent,
  createLiveSessionHiddenTurnState,
  hasQueuedOrActiveHiddenTurn,
  shouldSuppressLiveEventForHiddenTurn,
} from './liveSessionHiddenTurns.js';

describe('live session hidden turns', () => {
  it('does not support hidden turns or suppress events', () => {
    const state = createLiveSessionHiddenTurnState();
    state.pendingHiddenTurnCustomTypes = ['legacy-hidden'];
    state.activeHiddenTurnCustomType = 'legacy-active';

    expect(hasQueuedOrActiveHiddenTurn(state)).toBe(false);
    expect(activateNextHiddenTurn(state, { type: 'agent_start' } as any)).toBeNull();
    expect(state.pendingHiddenTurnCustomTypes).toEqual([]);
    expect(state.activeHiddenTurnCustomType).toBeNull();
    expect(shouldSuppressLiveEventForHiddenTurn(state, { type: 'message_update' } as any)).toBe(false);
  });

  it('clears stale hidden-turn state without preserving hidden behavior', () => {
    const state = createLiveSessionHiddenTurnState();
    state.pendingHiddenTurnCustomTypes = ['queued'];
    state.activeHiddenTurnCustomType = 'active';

    expect(clearActiveHiddenTurnAfterTerminalEvent(state, { type: 'turn_end' } as any)).toBe(true);
    expect(state.pendingHiddenTurnCustomTypes).toEqual([]);
    expect(state.activeHiddenTurnCustomType).toBeNull();
    expect(hasQueuedOrActiveHiddenTurn(state)).toBe(false);
  });
});
