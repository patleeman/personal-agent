import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebHostController } from './web-host-controller.js';

describe('WebHostController', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports reachable when the remote status endpoint is healthy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const controller = new WebHostController({
      id: 'tailnet',
      label: 'Tailnet desktop',
      kind: 'web',
      baseUrl: 'https://desktop.example.ts.net',
    });

    await expect(controller.getBaseUrl()).resolves.toBe('https://desktop.example.ts.net');
    await expect(controller.openNewConversation()).resolves.toBe('https://desktop.example.ts.net/conversations/new');

    const status = await controller.getStatus();
    expect(status.reachable).toBe(true);
    expect(status.mode).toBe('web-remote');
  });

  it('treats auth-protected remotes as reachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    const controller = new WebHostController({
      id: 'protected',
      label: 'Protected remote',
      kind: 'web',
      baseUrl: 'https://protected.example.ts.net/',
    });

    await expect(controller.ensureRunning()).resolves.toBeUndefined();
    await expect(controller.getBaseUrl()).resolves.toBe('https://protected.example.ts.net');
  });

  it('fails cleanly when the remote host is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const controller = new WebHostController({
      id: 'offline',
      label: 'Offline remote',
      kind: 'web',
      baseUrl: 'https://offline.example.ts.net',
    });

    await expect(controller.ensureRunning()).rejects.toThrow('Could not reach remote web host');

    const status = await controller.getStatus();
    expect(status.reachable).toBe(false);
    expect(status.lastError).toContain('not currently reachable');
  });
});
