import { afterEach, describe, expect, it, vi } from 'vitest';
import { lazyRouteWithRecovery } from './lazyRouteRecovery.js';

const originalWindow = globalThis.window;
const LAZY_ROUTE_RECOVERY_PREFIX = '__pa_lazy_route_recovery__:';

type LazyComponentTestHandle<T> = {
  _payload: unknown;
  _init: (payload: unknown) => T;
};

function initializeLazyComponent<T>(component: unknown): T {
  const lazyComponent = component as LazyComponentTestHandle<T>;
  return lazyComponent._init(lazyComponent._payload);
}

function createWindowDouble() {
  const storage = new Map<string, string>();
  const reload = vi.fn();

  const windowDouble = {
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
  } as unknown as Window;

  return { windowDouble, storage, reload };
}

function getRecoveryStorageKey(routeId: string): string {
  return `${LAZY_ROUTE_RECOVERY_PREFIX}${routeId}`;
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

describe('lazyRouteWithRecovery', () => {
  it('reloads once for a recoverable lazy route failure', async () => {
    const { windowDouble, storage, reload } = createWindowDouble();
    Object.defineProperty(globalThis, 'window', {
      value: windowDouble,
      writable: true,
      configurable: true,
    });

    const LazySettings = lazyRouteWithRecovery('settings', async () => {
      throw new TypeError('Failed to fetch dynamically imported module');
    });

    let thrown: unknown;
    try {
      initializeLazyComponent(LazySettings);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Promise);
    await Promise.resolve();
    await Promise.resolve();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.get(getRecoveryStorageKey('settings'))).toBe('1');
  });

  it('surfaces unrelated lazy loader failures without reloading', async () => {
    const { windowDouble, reload } = createWindowDouble();
    Object.defineProperty(globalThis, 'window', {
      value: windowDouble,
      writable: true,
      configurable: true,
    });

    const LazySettings = lazyRouteWithRecovery('settings', async () => {
      throw new Error('Some unrelated render crash');
    });

    let thrown: unknown;
    try {
      initializeLazyComponent(LazySettings);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Promise);
    await expect(thrown as Promise<unknown>).rejects.toThrow('Some unrelated render crash');
    expect(reload).not.toHaveBeenCalled();
    expect(() => initializeLazyComponent(LazySettings)).toThrow('Some unrelated render crash');
  });

  it('does not retry a recoverable lazy route failure after the one-shot flag is already set', async () => {
    const { windowDouble, storage, reload } = createWindowDouble();
    storage.set(getRecoveryStorageKey('settings'), '1');
    Object.defineProperty(globalThis, 'window', {
      value: windowDouble,
      writable: true,
      configurable: true,
    });

    const LazySettings = lazyRouteWithRecovery('settings', async () => {
      throw new TypeError('Importing a module script failed.');
    });

    let thrown: unknown;
    try {
      initializeLazyComponent(LazySettings);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Promise);
    await expect(thrown as Promise<unknown>).rejects.toThrow('Importing a module script failed.');
    expect(reload).not.toHaveBeenCalled();
    expect(storage.has(getRecoveryStorageKey('settings'))).toBe(false);
  });

  it('clears the one-shot recovery flag after a successful load', async () => {
    const { windowDouble, storage, reload } = createWindowDouble();
    storage.set(getRecoveryStorageKey('settings'), '1');
    Object.defineProperty(globalThis, 'window', {
      value: windowDouble,
      writable: true,
      configurable: true,
    });

    const SettingsPage = () => null;
    const LazySettings = lazyRouteWithRecovery('settings', async () => ({ default: SettingsPage }));

    let thrown: unknown;
    try {
      initializeLazyComponent(LazySettings);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Promise);
    await thrown;
    expect(reload).not.toHaveBeenCalled();
    expect(storage.has(getRecoveryStorageKey('settings'))).toBe(false);
    expect(initializeLazyComponent(LazySettings)).toBe(SettingsPage);
  });
});
