import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { createWorkerBackedLocalApiModule, importLocalApiModuleWithFallback, resolveLocalApiModuleUrl } from './local-api-module.js';

describe('resolveLocalApiModuleUrl', () => {
  it('resolves the dev local API module from the desktop server build output', () => {
    expect(
      resolveLocalApiModuleUrl({
        currentDir: '/repo/packages/desktop/dist',
        isPackaged: false,
      }),
    ).toBe(pathToFileURL(resolve('/repo/packages/desktop/dist', '..', 'server', 'dist', 'app', 'localApi.js')).href);
  });

  it('resolves the packaged local API module from the bundled server directory', () => {
    expect(
      resolveLocalApiModuleUrl({
        currentDir: '/Applications/Personal Agent.app/Contents/Resources/app.asar/dist',
        isPackaged: true,
        appPath: '/Applications/Personal Agent.app/Contents/Resources/app.asar',
      }),
    ).toBe(
      pathToFileURL(resolve('/Applications/Personal Agent.app/Contents/Resources/app.asar', 'server', 'dist', 'app', 'localApi.js')).href,
    );
  });

  it('can auto-resolve the packaged bundle path without importing electron', () => {
    expect(
      resolveLocalApiModuleUrl({
        currentDir: '/Applications/Personal Agent.app/Contents/Resources/app.asar/dist',
        appPath: '/Applications/Personal Agent.app/Contents/Resources/app.asar',
      }),
    ).toBe(
      pathToFileURL(resolve('/Applications/Personal Agent.app/Contents/Resources/app.asar', 'server', 'dist', 'app', 'localApi.js')).href,
    );
  });
});

describe('importLocalApiModuleWithFallback', () => {
  it('falls back to the repo-built module when the primary import fails', async () => {
    const loadModule = vi.fn().mockRejectedValueOnce(new Error('missing primary module')).mockResolvedValueOnce({ marker: 'fallback' });

    await expect(
      importLocalApiModuleWithFallback({
        primaryUrl: 'file:///primary/localApi.js',
        fallbackUrl: 'file:///fallback/localApi.js',
        loadModule,
      }),
    ).resolves.toEqual({ marker: 'fallback' });

    expect(loadModule).toHaveBeenNthCalledWith(1, 'file:///primary/localApi.js');
    expect(loadModule).toHaveBeenNthCalledWith(2, 'file:///fallback/localApi.js');
  });

  it('rethrows the primary error when no distinct fallback is available', async () => {
    const loadModule = vi.fn().mockRejectedValueOnce(new Error('missing primary module'));

    await expect(
      importLocalApiModuleWithFallback({
        primaryUrl: 'file:///primary/localApi.js',
        fallbackUrl: 'file:///primary/localApi.js',
        loadModule,
      }),
    ).rejects.toThrow('missing primary module');

    expect(loadModule).toHaveBeenCalledTimes(1);
    expect(loadModule).toHaveBeenCalledWith('file:///primary/localApi.js');
  });
});

describe('createWorkerBackedLocalApiModule', () => {
  it('dispatches normal local API methods through the worker client', async () => {
    const workerClient = {
      call: vi.fn().mockResolvedValue({ ok: true }),
    };
    const loadRawModule = vi.fn();
    const module = createWorkerBackedLocalApiModule({ workerClient, loadRawModule });

    await expect(module.readDesktopSessionDetail({ sessionId: 'conversation-1', tailBlocks: 20 })).resolves.toEqual({ ok: true });

    expect(workerClient.call).toHaveBeenCalledWith('readDesktopSessionDetail', [{ sessionId: 'conversation-1', tailBlocks: 20 }]);
    expect(loadRawModule).not.toHaveBeenCalled();
  });

  it('keeps subscription methods in the main process because callbacks cannot cross worker boundaries', async () => {
    const unsubscribe = vi.fn();
    const subscribeDesktopLocalApiStream = vi.fn().mockResolvedValue(unsubscribe);
    const workerClient = {
      call: vi.fn(),
    };
    const loadRawModule = vi.fn().mockResolvedValue({ subscribeDesktopLocalApiStream });
    const module = createWorkerBackedLocalApiModule({ workerClient, loadRawModule });
    const onEvent = vi.fn();

    await expect(module.subscribeDesktopLocalApiStream('/api/events', onEvent)).resolves.toBe(unsubscribe);

    expect(subscribeDesktopLocalApiStream).toHaveBeenCalledWith('/api/events', onEvent);
    expect(workerClient.call).not.toHaveBeenCalled();
  });

  it('keeps generic API dispatch in the main process so mutable live-session routes share state with subscriptions', async () => {
    const dispatchDesktopLocalApiRequest = vi.fn().mockResolvedValue({ statusCode: 200, headers: {}, body: new Uint8Array() });
    const workerClient = {
      call: vi.fn(),
    };
    const loadRawModule = vi.fn().mockResolvedValue({ dispatchDesktopLocalApiRequest });
    const module = createWorkerBackedLocalApiModule({ workerClient, loadRawModule });
    const request = { method: 'POST' as const, path: '/api/live-sessions/live-1/prompt', body: { text: 'hello' } };

    await expect(module.dispatchDesktopLocalApiRequest(request)).resolves.toEqual({ statusCode: 200, headers: {}, body: new Uint8Array() });

    expect(dispatchDesktopLocalApiRequest).toHaveBeenCalledWith(request);
    expect(workerClient.call).not.toHaveBeenCalled();
  });
});
