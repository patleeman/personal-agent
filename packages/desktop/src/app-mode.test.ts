import { describe, expect, it, vi } from 'vitest';
import { applyDesktopShellAppMode } from './app-mode.js';

describe('applyDesktopShellAppMode', () => {
  it('switches the macOS app into accessory mode and hides the dock icon', () => {
    const setActivationPolicy = vi.fn(() => true);
    const hide = vi.fn();

    applyDesktopShellAppMode('darwin', {
      setActivationPolicy,
      dock: { hide },
    });

    expect(setActivationPolicy).toHaveBeenCalledWith('accessory');
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('does nothing outside macOS', () => {
    const setActivationPolicy = vi.fn(() => true);
    const hide = vi.fn();

    applyDesktopShellAppMode('linux', {
      setActivationPolicy,
      dock: { hide },
    });

    expect(setActivationPolicy).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });
});
