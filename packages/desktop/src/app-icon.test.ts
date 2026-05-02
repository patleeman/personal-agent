import { describe, expect, it, vi } from 'vitest';

import { applyDesktopApplicationIcon } from './app-icon.js';

describe('applyDesktopApplicationIcon', () => {
  it('sets the app icon through the dock API on macOS', () => {
    const setIcon = vi.fn();

    applyDesktopApplicationIcon('darwin', { dock: { setIcon } }, '/tmp/personal-agent-icon.png');

    expect(setIcon).toHaveBeenCalledWith('/tmp/personal-agent-icon.png');
  });

  it('does nothing on non-mac platforms', () => {
    const setIcon = vi.fn();

    applyDesktopApplicationIcon('linux', { dock: { setIcon } }, '/tmp/personal-agent-icon.png');

    expect(setIcon).not.toHaveBeenCalled();
  });
});
