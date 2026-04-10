import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  session: {
    fromPartition: vi.fn(() => ({
      protocol: {
        handle: vi.fn(),
      },
    })),
  },
}));

import type { LocalBackendProcesses } from '../backend/local-backend-processes.js';
import type { LocalApiModule } from '../local-api-module.js';
import { LocalHostController } from './local-host-controller.js';

describe('LocalHostController', () => {
  it('routes live-session mutations through the local API module without booting the web child', async () => {
    const invokeDesktopLocalApi = vi.fn().mockResolvedValue({ ok: true, accepted: true });
    const loadLocalApi = vi.fn().mockResolvedValue({
      invokeDesktopLocalApi,
      dispatchDesktopLocalApiRequest: vi.fn(),
      subscribeDesktopLocalApiStream: vi.fn(),
    } satisfies LocalApiModule);
    const backend = {
      ensureStarted: vi.fn(),
      getStatus: vi.fn(),
      restart: vi.fn(),
      stop: vi.fn(),
    } as unknown as LocalBackendProcesses;

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.invokeLocalApi('POST', '/api/live-sessions/live-1/prompt', {
      text: 'hello',
      surfaceId: 'surface-1',
    })).resolves.toEqual({ ok: true, accepted: true });

    expect(loadLocalApi).toHaveBeenCalledTimes(1);
    expect(invokeDesktopLocalApi).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/live-sessions/live-1/prompt',
      body: {
        text: 'hello',
        surfaceId: 'surface-1',
      },
    });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes live-session event streams through the local API module without loopback proxying', async () => {
    const unsubscribe = vi.fn();
    const subscribeDesktopLocalApiStream = vi.fn().mockResolvedValue(unsubscribe);
    const loadLocalApi = vi.fn().mockResolvedValue({
      invokeDesktopLocalApi: vi.fn(),
      dispatchDesktopLocalApiRequest: vi.fn(),
      subscribeDesktopLocalApiStream,
    } satisfies LocalApiModule);
    const backend = {
      ensureStarted: vi.fn(),
      getStatus: vi.fn(),
      restart: vi.fn(),
      stop: vi.fn(),
    } as unknown as LocalBackendProcesses;

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );
    const onEvent = vi.fn();

    await expect(controller.subscribeApiStream('/api/live-sessions/live-1/events?tailBlocks=20', onEvent)).resolves.toBe(unsubscribe);

    expect(loadLocalApi).toHaveBeenCalledTimes(1);
    expect(subscribeDesktopLocalApiStream).toHaveBeenCalledWith('/api/live-sessions/live-1/events?tailBlocks=20', onEvent);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });
});
