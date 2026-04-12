import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostController } from '../src/hosts/types.js';
import type { HostManager } from '../src/hosts/host-manager.js';

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

const appServerMocks = vi.hoisted(() => {
  let streamListener: ((event: { type: 'open' | 'message' | 'error' | 'close'; data?: string; message?: string }) => void) | null = null;
  const unsubscribeMock = vi.fn();

  return {
    dispatchDesktopLocalApiRequest: vi.fn(),
    subscribeDesktopLocalApiStream: vi.fn(async (_path: string, onEvent: NonNullable<typeof streamListener>) => {
      streamListener = onEvent;
      return unsubscribeMock;
    }),
    readRemoteAccessSession: vi.fn(),
    unsubscribeMock,
    getStreamListener: () => streamListener,
    resetStreamListener: () => {
      streamListener = null;
    },
  };
});

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

vi.mock('../../web/server/app/localApi.js', () => ({
  dispatchDesktopLocalApiRequest: appServerMocks.dispatchDesktopLocalApiRequest,
  subscribeDesktopLocalApiStream: appServerMocks.subscribeDesktopLocalApiStream,
}));

vi.mock('../../web/server/ui/remoteAccessAuth.js', () => ({
  readRemoteAccessSession: appServerMocks.readRemoteAccessSession,
}));

import { createAppServerUpgradeHandler } from '../../web/server/app-server.js';
import { createDesktopProtocolHandler } from '../src/app-protocol.js';
import { RemoteAppServerClient } from '../src/hosts/remote-app-server-client.js';

async function startAppServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const upgradeHandler = createAppServerUpgradeHandler();
  const sockets = new Set<Socket>();
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end('not found');
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => {
      sockets.delete(socket);
    });
  });

  server.on('upgrade', (request, socket, head) => {
    if (!upgradeHandler.handleUpgrade(request, socket, head)) {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', (error?: Error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  const address = server.address() as AddressInfo | null;
  if (!address) {
    throw new Error('Could not determine app-server address.');
  }

  return {
    baseUrl: `http://127.0.0.1:${String(address.port)}`,
    close: () => new Promise<void>((resolve, reject) => {
      for (const socket of sockets) {
        socket.destroy();
      }
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    }),
  };
}

function createRemoteHostController(client: RemoteAppServerClient): HostController {
  return {
    id: 'remote-1',
    label: 'Remote',
    kind: 'web',
    ensureRunning: async () => {
      await client.ensureConnected();
    },
    getBaseUrl: async () => 'personal-agent://app/',
    getStatus: async () => ({
      reachable: true,
      mode: 'web-remote',
      summary: 'Remote ready',
      webHealthy: true,
    }),
    openNewConversation: async () => 'personal-agent://app/conversations/new',
    dispatchApiRequest: async (input) => client.dispatchApiRequest(input),
    invokeLocalApi: async () => ({ ok: true }),
    subscribeApiStream: async (path, onEvent) => client.subscribeApiStream(path, onEvent),
    restart: async () => {
      client.dispose();
    },
    stop: async () => {
      client.dispose();
    },
    dispose: async () => {
      client.dispose();
    },
  };
}

describe('createDesktopProtocolHandler remote host integration', () => {
  let appServer: { baseUrl: string; close: () => Promise<void> } | null = null;
  let client: RemoteAppServerClient | null = null;

  beforeEach(async () => {
    appServerMocks.dispatchDesktopLocalApiRequest.mockReset();
    appServerMocks.subscribeDesktopLocalApiStream.mockClear();
    appServerMocks.readRemoteAccessSession.mockReset();
    appServerMocks.unsubscribeMock.mockReset();
    appServerMocks.resetStreamListener();
    appServer = await startAppServer();
  });

  afterEach(async () => {
    client?.dispose();
    client = null;
    await appServer?.close();
    appServer = null;
  });

  it('routes remote API requests through the host manager over app-server', async () => {
    appServerMocks.dispatchDesktopLocalApiRequest.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify({ ok: true, source: 'remote-app-server' }), 'utf-8'),
    });

    client = new RemoteAppServerClient({ baseUrl: appServer!.baseUrl });
    const hostManager = {
      getHostController: vi.fn(() => createRemoteHostController(client!)),
    } as unknown as HostManager;

    const handler = createDesktopProtocolHandler({
      hostManager,
      hostId: 'remote-1',
    });

    const response = await handler(new Request('personal-agent://app/api/status'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, source: 'remote-app-server' });
    expect(appServerMocks.dispatchDesktopLocalApiRequest).toHaveBeenCalledWith({
      method: 'GET',
      path: '/api/status',
      body: undefined,
      headers: {},
    });
    expect(hostManager.getHostController).toHaveBeenCalledWith('remote-1');
  });

  it('routes remote SSE subscriptions through the host manager over app-server', async () => {
    client = new RemoteAppServerClient({ baseUrl: appServer!.baseUrl });
    const hostManager = {
      getHostController: vi.fn(() => createRemoteHostController(client!)),
    } as unknown as HostManager;

    const handler = createDesktopProtocolHandler({
      hostManager,
      hostId: 'remote-1',
    });

    const response = await handler(new Request('personal-agent://app/api/events', {
      headers: {
        accept: 'text/event-stream',
      },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('Expected event-stream response body.');
    }

    const firstChunkPromise = reader.read();
    let streamListener = appServerMocks.getStreamListener();
    for (let attempt = 0; !streamListener && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      streamListener = appServerMocks.getStreamListener();
    }
    if (!streamListener) {
      throw new Error('Expected remote stream subscription to be registered.');
    }

    streamListener({ type: 'message', data: '{"type":"connected"}' });
    const firstChunk = await firstChunkPromise;
    expect(firstChunk.done).toBe(false);
    expect(new TextDecoder().decode(firstChunk.value)).toBe('data: {"type":"connected"}\n\n');

    await reader.cancel();
    for (let attempt = 0; appServerMocks.unsubscribeMock.mock.calls.length === 0 && attempt < 20; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(appServerMocks.unsubscribeMock).toHaveBeenCalledTimes(1);
    expect(appServerMocks.subscribeDesktopLocalApiStream).toHaveBeenCalledWith('/api/events', expect.any(Function));
  });
});
