import { describe, expect, it, vi } from 'vitest';

import { claimDesktopSingleInstance, type DesktopSingleInstanceApp } from './single-instance.js';

function createAppMock(lockGranted: boolean) {
  const listeners = new Map<string, () => void>();
  const app = {
    requestSingleInstanceLock: vi.fn(() => lockGranted),
    on: vi.fn((event: 'second-instance', listener: () => void) => {
      listeners.set(event, listener);
      return app as unknown as DesktopSingleInstanceApp;
    }),
    exit: vi.fn(),
  };

  return { app: app as unknown as DesktopSingleInstanceApp, listeners };
}

describe('claimDesktopSingleInstance', () => {
  it('registers a second-instance handler when the lock is acquired', () => {
    const { app, listeners } = createAppMock(true);
    const onSecondInstance = vi.fn();

    expect(claimDesktopSingleInstance(app, onSecondInstance)).toBe(true);

    expect(app.requestSingleInstanceLock).toHaveBeenCalledTimes(1);
    expect(app.on).toHaveBeenCalledWith('second-instance', onSecondInstance);
    expect(app.exit).not.toHaveBeenCalled();

    listeners.get('second-instance')?.();
    expect(onSecondInstance).toHaveBeenCalledTimes(1);
  });

  it('exits immediately when another desktop instance already owns the lock', () => {
    const { app } = createAppMock(false);

    expect(claimDesktopSingleInstance(app, vi.fn())).toBe(false);

    expect(app.exit).toHaveBeenCalledWith(0);
    expect(app.on).not.toHaveBeenCalled();
  });
});
