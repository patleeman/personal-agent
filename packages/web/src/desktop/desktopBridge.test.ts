import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('readDesktopEnvironment', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('reuses the same bridge request across repeated reads', async () => {
    const getEnvironment = vi.fn().mockResolvedValue({ activeHostKind: 'local', activeHostLabel: 'Local' });
    vi.stubGlobal('window', {
      personalAgentDesktop: {
        getEnvironment,
      },
    } as unknown as Window & typeof globalThis);

    const { readDesktopEnvironment } = await import('./desktopBridge');

    await expect(readDesktopEnvironment()).resolves.toEqual({ activeHostKind: 'local', activeHostLabel: 'Local' });
    await expect(readDesktopEnvironment()).resolves.toEqual({ activeHostKind: 'local', activeHostLabel: 'Local' });
    expect(getEnvironment).toHaveBeenCalledTimes(1);
  });

  it('clears the cached request after a bridge failure', async () => {
    const getEnvironment = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ activeHostKind: 'local', activeHostLabel: 'Local' });
    vi.stubGlobal('window', {
      personalAgentDesktop: {
        getEnvironment,
      },
    } as unknown as Window & typeof globalThis);

    const { readDesktopEnvironment } = await import('./desktopBridge');

    await expect(readDesktopEnvironment()).rejects.toThrow('boom');
    await expect(readDesktopEnvironment()).resolves.toEqual({ activeHostKind: 'local', activeHostLabel: 'Local' });
    expect(getEnvironment).toHaveBeenCalledTimes(2);
  });
});
