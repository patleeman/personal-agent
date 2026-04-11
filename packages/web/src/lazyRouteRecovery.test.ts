import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attemptLazyRouteRecovery,
  clearLazyRouteRecovery,
  isRecoverableLazyRouteError,
} from './lazyRouteRecovery.js';

const originalWindow = globalThis.window;

function createWindowDouble() {
  const storage = new Map<string, string>();
  const reload = vi.fn();

  return {
    location: { reload },
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    },
  } as unknown as Window & { location: { reload: ReturnType<typeof vi.fn> } };
}

afterEach(() => {
  vi.restoreAllMocks();

  if (originalWindow === undefined) {
    // @ts-expect-error test cleanup for node environment
    delete globalThis.window;
  } else {
    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      writable: true,
      configurable: true,
    });
  }
});

describe('lazyRouteRecovery', () => {
  it('recognizes common stale dynamic import failures', () => {
    expect(isRecoverableLazyRouteError(new TypeError('Failed to fetch dynamically imported module'))).toBe(true);
    expect(isRecoverableLazyRouteError(new Error('Importing a module script failed.'))).toBe(true);
    expect(isRecoverableLazyRouteError(new Error('Some unrelated render crash'))).toBe(false);
  });

  it('reloads once for a recoverable lazy route failure', () => {
    const windowDouble = createWindowDouble();
    Object.defineProperty(globalThis, 'window', {
      value: windowDouble,
      writable: true,
      configurable: true,
    });

    expect(attemptLazyRouteRecovery('settings')).toBe(true);
    expect(windowDouble.location.reload).toHaveBeenCalledTimes(1);

    expect(attemptLazyRouteRecovery('settings')).toBe(false);
    expect(windowDouble.location.reload).toHaveBeenCalledTimes(1);
  });

  it('clears the one-shot recovery flag after a successful load', () => {
    const windowDouble = createWindowDouble();
    Object.defineProperty(globalThis, 'window', {
      value: windowDouble,
      writable: true,
      configurable: true,
    });

    expect(attemptLazyRouteRecovery('settings')).toBe(true);
    clearLazyRouteRecovery('settings');
    expect(attemptLazyRouteRecovery('settings')).toBe(true);
    expect(windowDouble.location.reload).toHaveBeenCalledTimes(2);
  });
});
