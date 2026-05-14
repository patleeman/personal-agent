import { describe, expect, it } from 'vitest';

import {
  clearActiveHiddenTurnAfterTerminalEvent,
  createLiveSessionHiddenTurnState,
  hasQueuedOrActiveHiddenTurn,
} from './liveSessionHiddenTurns.js';

describe('live session hidden turns', () => {
  it('clears a non-turn hidden custom message after its message_end event', () => {
    const state = createLiveSessionHiddenTurnState();
    state.activeHiddenTurnCustomType = 'related_conversation_pointers';

    const cleared = clearActiveHiddenTurnAfterTerminalEvent(state, {
      type: 'message_end',
      message: {
        role: 'custom',
        customType: 'related_conversation_pointers',
        display: false,
        content: 'Pointers',
      },
    } as any);

    expect(cleared).toBe(true);
    expect(hasQueuedOrActiveHiddenTurn(state)).toBe(false);
  });

  it('keeps a hidden turn active when another message ends', () => {
    const state = createLiveSessionHiddenTurnState();
    state.activeHiddenTurnCustomType = 'conversation_automation_post_turn_review';

    const cleared = clearActiveHiddenTurnAfterTerminalEvent(state, {
      type: 'message_end',
      message: {
        role: 'custom',
        customType: 'related_conversation_pointers',
        display: false,
        content: 'Pointers',
      },
    } as any);

    expect(cleared).toBe(false);
    expect(state.activeHiddenTurnCustomType).toBe('conversation_automation_post_turn_review');
  });
});
