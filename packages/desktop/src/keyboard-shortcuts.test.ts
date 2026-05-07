import { describe, expect, it } from 'vitest';

import { DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS } from './keyboard-shortcuts.js';

// ── keyboard-shortcuts — default shortcut definitions ─────────────────────

describe('DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS', () => {
  it('defines all 19 expected shortcuts', () => {
    const keys = Object.keys(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS);
    expect(keys.length).toBe(19);
  });

  it('includes the essential conversation shortcuts', () => {
    expect(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS.newConversation).toBe('CommandOrControl+N');
    expect(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS.closeTab).toBe('CommandOrControl+W');
    expect(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS.focusComposer).toBe('CommandOrControl+L');
  });

  it('includes layout mode shortcuts', () => {
    expect(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS.conversationMode).toBe('F1');
    expect(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS.workbenchMode).toBe('F2');
    expect(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS.zenMode).toBe('F3');
  });

  it('includes sidebar and rail toggles', () => {
    expect(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS.toggleSidebar).toBe('CommandOrControl+/');
    expect(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS.toggleRightRail).toBe('CommandOrControl+\\');
  });

  it('includes show app and quit', () => {
    expect(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS.showApp).toBe('CommandOrControl+Shift+A');
    expect(DEFAULT_DESKTOP_KEYBOARD_SHORTCUTS.quit).toBe('CommandOrControl+Q');
  });
});
