import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

const mocks = vi.hoisted(() => {
  let streamListener: ((event: { type: 'open' | 'message' | 'error' | 'close'; data?: string; message?: string }) => void) | null = null;
  const unsubscribeMock = vi.fn();

  return {
    dispatchDesktopLocalApiRequest: vi.fn(),
    subscribeDesktopLocalApiStream: vi.fn(async (_path: string, onEvent: typeof streamListener extends null ? never : NonNullable<typeof streamListener>) => {
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

vi.mock('./app/localApi.js', () => ({
  dispatchDesktopLocalApiRequest: mocks.dispatchDesktopLocalApiRequest,
  subscribeDesktopLocalApiStream: mocks.subscribeDesktopLocalApiStream,
}));

vi.mock('./ui/remoteAccessAuth.js', () => ({
  readRemoteAccessSession: mocks.readRemoteAccessSession,
}));

import { createAppServerUpgradeHandler } from './app-server.js';

async function startAppServer(): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const upgradeHandler = createAppServerUpgradeHandler();
  const server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end('not found');
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
    baseUrl: `ws://127.0.0.1:${String(address.port)}`,
    close: () => new Promise<void>((resolve, reject) => {
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

async function connectWebSocket(baseUrl: string, options?: { headers?: Record<string, string> }): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl}/api/app-server`, {
      headers: options?.headers,
    });

    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
    socket.once('unexpected-response', async (_request, response) => {
      let body = '';
      for await (const chunk of response) {
        body += chunk.toString();
      }
      reject(new Error(`${String(response.statusCode ?? 500)} ${body}`.trim()));
    });
  });
}

async function connectUnexpectedResponse(baseUrl: string, headers: Record<string, string>): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${baseUrl}/api/app-server`, { headers });

    socket.once('open', () => reject(new Error('Expected app-server connection to be rejected.')));
    socket.once('unexpected-response', async (_request, response) => {
      let body = '';
      for await (const chunk of response) {
        body += chunk.toString();
      }
      resolve({
        statusCode: response.statusCode ?? 0,
        body,
      });
    });
    socket.once('error', () => {
      // unexpected-response is the expected signal for upgrade failures.
    });
  });
}

async function readJsonMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
}

describe('app-server', () => {
  let appServer: { baseUrl: string; close: () => Promise<void> } | null = null;

  beforeEach(async () => {
    mocks.dispatchDesktopLocalApiRequest.mockReset();
    mocks.subscribeDesktopLocalApiStream.mockClear();
    mocks.readRemoteAccessSession.mockReset();
    mocks.unsubscribeMock.mockReset();
    mocks.resetStreamListener();
    appServer = await startAppServer();
  });

  afterEach(async () => {
    await appServer?.close();
    appServer = null;
  });

  it('rejects requests before initialize', async () => {
    const socket = await connectWebSocket(appServer!.baseUrl);
    socket.send(JSON.stringify({
      method: 'pa/http/request',
      id: 1,
      params: { method: 'GET', path: '/api/status' },
    }));

    await expect(readJsonMessage(socket)).resolves.toEqual({
      id: 1,
      error: { code: -32002, message: 'Not initialized.' },
    });

    socket.close();
  });

  it('dispatches pa/http/request after initialization', async () => {
    mocks.dispatchDesktopLocalApiRequest.mockResolvedValue({
      statusCode: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: Buffer.from(JSON.stringify({ ok: true }), 'utf-8'),
    });

    const socket = await connectWebSocket(appServer!.baseUrl);
    socket.send(JSON.stringify({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'test-client',
          title: 'Test Client',
          version: '0.0.1',
        },
      },
    }));

    await expect(readJsonMessage(socket)).resolves.toEqual({
      id: 1,
      result: {
        serverInfo: {
          name: 'personal-agent',
          protocol: 'pa-app-server-v1',
        },
        capabilities: {
          experimentalApi: true,
          paHttpTransport: true,
        },
      },
    });

    socket.send(JSON.stringify({ method: 'initialized', params: {} }));
    socket.send(JSON.stringify({
      method: 'pa/http/request',
      id: 2,
      params: {
        method: 'POST',
        path: '/api/conversations/test/prompt',
        body: { text: 'hello' },
        headers: { 'x-test': '1', ignored: 2 },
      },
    }));

    await expect(readJsonMessage(socket)).resolves.toEqual({
      id: 2,
      result: {
        statusCode: 200,
        headers: { 'content-type': 'application/json; charset=utf-8' },
        bodyBase64: Buffer.from(JSON.stringify({ ok: true }), 'utf-8').toString('base64'),
      },
    });
    expect(mocks.dispatchDesktopLocalApiRequest).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/conversations/test/prompt',
      body: { text: 'hello' },
      headers: { 'x-test': '1' },
    });

    socket.close();
  });

  it('streams pa/http/subscribe notifications and unsubscribes', async () => {
    const socket = await connectWebSocket(appServer!.baseUrl);
    socket.send(JSON.stringify({
      method: 'initialize',
      id: 1,
      params: { clientInfo: { name: 'test-client', title: 'Test Client', version: '0.0.1' } },
    }));
    await readJsonMessage(socket);
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));

    socket.send(JSON.stringify({
      method: 'pa/http/subscribe',
      id: 2,
      params: { path: '/api/events' },
    }));
    const subscriptionResponse = await readJsonMessage(socket) as { id: number; result: { subscriptionId: string } };
    expect(subscriptionResponse.id).toBe(2);
    expect(subscriptionResponse.result.subscriptionId).toMatch(/^sub-/);

    const streamListener = mocks.getStreamListener();
    expect(streamListener).toBeTypeOf('function');
    streamListener?.({ type: 'message', data: '{"type":"connected"}' });

    await expect(readJsonMessage(socket)).resolves.toEqual({
      method: 'pa/http/subscription/event',
      params: {
        subscriptionId: subscriptionResponse.result.subscriptionId,
        event: { type: 'message', data: '{"type":"connected"}' },
      },
    });

    socket.send(JSON.stringify({
      method: 'pa/http/unsubscribe',
      id: 3,
      params: { subscriptionId: subscriptionResponse.result.subscriptionId },
    }));
    await expect(readJsonMessage(socket)).resolves.toEqual({ id: 3, result: {} });
    expect(mocks.unsubscribeMock).toHaveBeenCalledTimes(1);

    socket.close();
  });

  it('requires auth for tailnet upgrades without a token', async () => {
    await expect(connectUnexpectedResponse(appServer!.baseUrl, {
      'x-forwarded-host': 'device.ts.net',
    })).resolves.toEqual({
      statusCode: 401,
      body: 'Remote access sign-in required.',
    });
  });

  it('accepts bearer auth for tailnet upgrades', async () => {
    mocks.readRemoteAccessSession.mockReturnValue({ id: 'session-1' });

    const socket = await connectWebSocket(appServer!.baseUrl, {
      headers: {
        authorization: 'Bearer desktop-token',
        'x-forwarded-host': 'device.ts.net',
      },
    });

    socket.send(JSON.stringify({
      method: 'initialize',
      id: 1,
      params: { clientInfo: { name: 'test-client', title: 'Test Client', version: '0.0.1' } },
    }));
    await expect(readJsonMessage(socket)).resolves.toEqual(expect.objectContaining({ id: 1 }));
    expect(mocks.readRemoteAccessSession).toHaveBeenCalledWith('desktop-token');

    socket.close();
  });
});
