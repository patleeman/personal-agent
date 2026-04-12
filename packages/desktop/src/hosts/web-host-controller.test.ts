import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  ensureConnected: vi.fn().mockResolvedValue(undefined),
  dispatchApiRequest: vi.fn(),
  subscribeApiStream: vi.fn(),
  dispose: vi.fn(),
  registerSchemesAsPrivileged: vi.fn(),
  protocolHandle: vi.fn(),
  partitionProtocolHandle: vi.fn(),
  fromPartition: vi.fn(() => ({
    protocol: {
      handle: mocks.partitionProtocolHandle,
    },
  })),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: mocks.registerSchemesAsPrivileged,
    handle: mocks.protocolHandle,
  },
  session: {
    fromPartition: mocks.fromPartition,
  },
}));

vi.mock('./remote-app-server-client.js', () => ({
  RemoteAppServerClient: class RemoteAppServerClient {
    ensureConnected = mocks.ensureConnected;
    dispatchApiRequest = mocks.dispatchApiRequest;
    subscribeApiStream = mocks.subscribeApiStream;
    dispose = mocks.dispose;
  },
}));

import { WebHostController } from './web-host-controller.js';

describe('WebHostController', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('reports reachable when the remote status endpoint is healthy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const controller = new WebHostController({
      id: 'tailnet',
      label: 'Tailnet desktop',
      kind: 'web',
      baseUrl: 'https://desktop.example.ts.net',
    });

    await expect(controller.getBaseUrl()).resolves.toBe('personal-agent://app/');
    await expect(controller.openNewConversation()).resolves.toBe('personal-agent://app/conversations/new');

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
    await expect(controller.getBaseUrl()).resolves.toBe('personal-agent://app/');
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
