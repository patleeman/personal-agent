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
    state.pendingHiddenTurnCustomTypes = ['legacy-hidden'];
    state.activeHiddenTurnCustomType = 'legacy-active';

    expect(hasQueuedOrActiveStaleTurn(state)).toBe(false);
    expect(clearQueuedStaleTurn(state, { type: 'agent_start' } as any)).toBeNull();
    expect(state.pendingHiddenTurnCustomTypes).toEqual([]);
    expect(state.activeHiddenTurnCustomType).toBeNull();
    expect(shouldSuppressLiveEventForStaleTurn(state, { type: 'message_update' } as any)).toBe(false);
  });

  it('clears stale stale turn state without preserving hidden behavior', () => {
    const state = createLiveSessionStaleTurnState();
    state.pendingHiddenTurnCustomTypes = ['queued'];
    state.activeHiddenTurnCustomType = 'active';

    expect(clearStaleTurnStateAfterTerminalEvent(state, { type: 'turn_end' } as any)).toBe(true);
    expect(state.pendingHiddenTurnCustomTypes).toEqual([]);
    expect(state.activeHiddenTurnCustomType).toBeNull();
    expect(hasQueuedOrActiveStaleTurn(state)).toBe(false);
  });
});
