import { describe, expect, it } from 'vitest';

import { resolveComposerModifierKeyState } from './useConversationKeyboardState.js';

describe('resolveComposerModifierKeyState', () => {
  it('treats bare Alt keydown as held even when the modifier flag is missing', () => {
    expect(resolveComposerModifierKeyState({ type: 'keydown', key: 'Alt', altKey: false, ctrlKey: false, metaKey: false })).toEqual({
      altHeld: true,
      parallelHeld: false,
    });
  });

  it('treats bare Control and Meta keydown as parallel even when modifier flags are missing', () => {
    expect(resolveComposerModifierKeyState({ type: 'keydown', key: 'Control', altKey: false, ctrlKey: false, metaKey: false })).toEqual({
      altHeld: false,
      parallelHeld: true,
    });
    expect(resolveComposerModifierKeyState({ type: 'keydown', key: 'Meta', altKey: false, ctrlKey: false, metaKey: false })).toEqual({
      altHeld: false,
      parallelHeld: true,
    });
  });

  it('clears bare modifier keyup state', () => {
    expect(resolveComposerModifierKeyState({ type: 'keyup', key: 'Alt', altKey: true, ctrlKey: false, metaKey: false })).toEqual({
      altHeld: false,
      parallelHeld: false,
    });
    expect(resolveComposerModifierKeyState({ type: 'keyup', key: 'Control', altKey: false, ctrlKey: true, metaKey: false })).toEqual({
      altHeld: false,
      parallelHeld: false,
    });
  });
});
