import { describe, expect, it, vi } from 'vitest';
import { applyDesktopShellAppMode, syncDesktopShellAppModeForWindows } from './app-mode.js';

describe('applyDesktopShellAppMode', () => {
  it('starts the macOS app in accessory mode with the dock hidden', () => {
    const setActivationPolicy = vi.fn(() => true);
    const hide = vi.fn();
    const show = vi.fn();

    applyDesktopShellAppMode('darwin', {
      setActivationPolicy,
      dock: { hide, show },
    });

    expect(setActivationPolicy).toHaveBeenCalledWith('accessory');
    expect(hide).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
  });

  it('does nothing outside macOS', () => {
    const setActivationPolicy = vi.fn(() => true);
    const hide = vi.fn();
    const show = vi.fn();

    applyDesktopShellAppMode('linux', {
      setActivationPolicy,
      dock: { hide, show },
    });

    expect(setActivationPolicy).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
    expect(show).not.toHaveBeenCalled();
  });
});

describe('syncDesktopShellAppModeForWindows', () => {
  it('promotes the app to a normal mac app while a window is visible', () => {
    const setActivationPolicy = vi.fn(() => true);
    const hide = vi.fn();
    const show = vi.fn();

    syncDesktopShellAppModeForWindows('darwin', {
      setActivationPolicy,
      dock: { hide, show },
    }, true);

    expect(setActivationPolicy).toHaveBeenCalledWith('regular');
    expect(show).toHaveBeenCalledTimes(1);
    expect(hide).not.toHaveBeenCalled();
  });

  it('drops back to menubar-only mode when every window is hidden', () => {
    const setActivationPolicy = vi.fn(() => true);
    const hide = vi.fn();
    const show = vi.fn();

    syncDesktopShellAppModeForWindows('darwin', {
      setActivationPolicy,
      dock: { hide, show },
    }, false);

    expect(setActivationPolicy).toHaveBeenCalledWith('accessory');
    expect(hide).toHaveBeenCalledTimes(1);
    expect(show).not.toHaveBeenCalled();
  });
});
