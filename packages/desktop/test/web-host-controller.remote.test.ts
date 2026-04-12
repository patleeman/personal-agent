import { Buffer } from 'node:buffer';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  let streamListener: ((event: { type: 'open' | 'message' | 'error' | 'close'; data?: string; message?: string }) => void) | null = null;
  const unsubscribeMock = vi.fn();

  return {
    dispatchDesktopLocalApiRequest: vi.fn(),
    subscribeDesktopLocalApiStream: vi.fn(async (_path: string, onEvent: NonNullable<typeof streamListener>) => {
      streamListener = onEvent;
      return unsubscribeMock;
    }),
    readRemoteAccessSession: vi.fn(),
    readDesktopRemoteHostBearerToken: vi.fn(() => ''),
    registerSchemesAsPrivileged: vi.fn(),
    protocolHandle: vi.fn(),
    partitionProtocolHandle: vi.fn(),
    fromPartition: vi.fn(() => ({
      protocol: {
        handle: mocks.partitionProtocolHandle,
      },
    })),
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
    registerSchemesAsPrivileged: mocks.registerSchemesAsPrivileged,
    handle: mocks.protocolHandle,
  },
  session: {
    fromPartition: mocks.fromPartition,
  },
}));

vi.mock('../src/state/remote-host-auth.js', () => ({
  readDesktopRemoteHostBearerToken: mocks.readDesktopRemoteHostBearerToken,
}));

vi.mock('../../web/server/app/localApi.js', () => ({
  dispatchDesktopLocalApiRequest: mocks.dispatchDesktopLocalApiRequest,
  subscribeDesktopLocalApiStream: mocks.subscribeDesktopLocalApiStream,
}));

vi.mock('../../web/server/ui/remoteAccessAuth.js', () => ({
  readRemoteAccessSession: mocks.readRemoteAccessSession,
}));

import { createAppServerUpgradeHandler } from '../../web/server/app-server.js';
import { WebHostController } from '../src/hosts/web-host-controller.js';

async function startAppServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const upgradeHandler = createAppServerUpgradeHandler();
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    if (req.url === '/api/status') {
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: true }));
      return;
    }

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

describe('WebHostController remote integration', () => {
  let appServer: { baseUrl: string; close: () => Promise<void> } | null = null;

  beforeEach(async () => {
    mocks.dispatchDesktopLocalApiRequest.mockReset();
    mocks.subscribeDesktopLocalApiStream.mockClear();
    mocks.readRemoteAccessSession.mockReset();
    mocks.readDesktopRemoteHostBearerToken.mockReset();
    mocks.readDesktopRemoteHostBearerToken.mockReturnValue('');
    mocks.unsubscribeMock.mockReset();
    mocks.resetStreamListener();
    appServer = await startAppServer();
  });

  afterEach(async () => {
    await appServer?.close();
    appServer = null;
  });

  it('dispatches remote API requests over app-server using the stored bearer token', async () => {
    mocks.readDesktopRemoteHostBearerToken.mockReturnValue('desktop-token');
    mocks.readRemoteAccessSession.mockReturnValue({ id: 'session-1' });
    mocks.dispatchDesktopLocalApiRequest.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify({ ok: true, remote: true }), 'utf-8'),
    });

    const controller = new WebHostController({
      id: 'remote-1',
      label: 'Remote',
      kind: 'web',
      baseUrl: appServer!.baseUrl,
    });

    try {
      await expect(controller.getBaseUrl()).resolves.toBe('personal-agent://app/');
      const response = await controller.dispatchApiRequest({
        method: 'GET',
        path: '/api/status',
      });

      expect(JSON.parse(Buffer.from(response.body).toString('utf-8'))).toEqual({ ok: true, remote: true });
      expect(mocks.readRemoteAccessSession).toHaveBeenCalledWith('desktop-token');
      expect(mocks.dispatchDesktopLocalApiRequest).toHaveBeenCalledWith({
        method: 'GET',
        path: '/api/status',
        body: undefined,
        headers: undefined,
      });
    } finally {
      await controller.dispose();
    }
  });

  it('streams remote API events over app-server and unsubscribes cleanly', async () => {
    const controller = new WebHostController({
      id: 'remote-1',
      label: 'Remote',
      kind: 'web',
      baseUrl: appServer!.baseUrl,
    });

    try {
      let resolveMessage: ((event: { type: 'message'; data: string }) => void) | null = null;
      const messagePromise = new Promise<{ type: 'message'; data: string }>((resolve) => {
        resolveMessage = resolve;
      });

      const unsubscribe = await controller.subscribeApiStream('/api/events', (event) => {
        if (event.type === 'message' && typeof event.data === 'string') {
          resolveMessage?.({ type: 'message', data: event.data });
        }
      });

      const streamListener = mocks.getStreamListener();
      if (!streamListener) {
        throw new Error('Expected remote stream subscription to be registered.');
      }

      streamListener({ type: 'message', data: '{"type":"connected"}' });
      await expect(messagePromise).resolves.toEqual({
        type: 'message',
        data: '{"type":"connected"}',
      });

      await unsubscribe();
      expect(mocks.subscribeDesktopLocalApiStream).toHaveBeenCalledWith('/api/events', expect.any(Function));
      expect(mocks.unsubscribeMock).toHaveBeenCalledTimes(1);
    } finally {
      await controller.dispose();
    }
  });
});
