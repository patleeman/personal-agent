import { afterEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  registerSchemesAsPrivileged: vi.fn(),
  protocolHandle: vi.fn(),
  partitionProtocolHandle: vi.fn(),
  fromPartition: vi.fn(() => ({
    protocol: {
      handle: electronMocks.partitionProtocolHandle,
    },
  })),
}));

const mocks = vi.hoisted(() => ({
  ensureConnected: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn(),
  adapterDispatch: vi.fn(),
  adapterSubscribe: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: electronMocks.registerSchemesAsPrivileged,
    handle: electronMocks.protocolHandle,
  },
  session: {
    fromPartition: electronMocks.fromPartition,
  },
}));

vi.mock('./codex-app-server-client.js', () => ({
  CodexAppServerClient: class CodexAppServerClient {
    ensureConnected = mocks.ensureConnected;
    dispose = mocks.dispose;
  },
}));

vi.mock('./codex-workspace-api.js', () => ({
  CodexWorkspaceApiAdapter: class CodexWorkspaceApiAdapter {
    dispatchApiRequest = mocks.adapterDispatch;
    subscribeApiStream = mocks.adapterSubscribe;
  },
}));

import { WebHostController } from './web-host-controller.js';

describe('WebHostController', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('reports reachable when the codex server connects', async () => {
    const controller = new WebHostController({
      id: 'tailnet',
      label: 'Tailnet workspace',
      kind: 'web',
      websocketUrl: 'wss://desktop.example.ts.net/codex',
      workspaceRoot: '/workspace/home',
    });

    await expect(controller.getBaseUrl()).resolves.toBe('personal-agent://app/');
    await expect(controller.openNewConversation()).resolves.toBe('personal-agent://app/conversations/new');

    const status = await controller.getStatus();
    expect(status.reachable).toBe(true);
    expect(status.mode).toBe('ws-remote');
    expect(status.webUrl).toBe('wss://desktop.example.ts.net/codex/codex');
    expect(status.summary).toContain('/workspace/home');
  });

  it('delegates API requests and subscriptions to the codex workspace adapter', async () => {
    mocks.adapterDispatch.mockResolvedValueOnce({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: Uint8Array.from(Buffer.from('{"ok":true}', 'utf-8')),
    });
    mocks.adapterSubscribe.mockResolvedValueOnce(() => {});

    const controller = new WebHostController({
      id: 'remote',
      label: 'Remote workspace',
      kind: 'web',
      websocketUrl: 'ws://127.0.0.1:8390',
    });

    await expect(controller.dispatchApiRequest({ method: 'GET', path: '/api/status' })).resolves.toEqual({
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: Uint8Array.from(Buffer.from('{"ok":true}', 'utf-8')),
    });
    await expect(controller.subscribeApiStream('/api/live-sessions/live-1/events', vi.fn())).resolves.toBeTypeOf('function');
  });

  it('reports the connection failure in host status', async () => {
    mocks.ensureConnected.mockRejectedValueOnce(new Error('network down'));

    const controller = new WebHostController({
      id: 'offline',
      label: 'Offline workspace',
      kind: 'web',
      websocketUrl: 'ws://offline.example.invalid:8390',
    });

    const status = await controller.getStatus();
    expect(status.reachable).toBe(false);
    expect(status.lastError).toContain('network down');
  });
});
