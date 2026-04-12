import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import { Buffer } from 'node:buffer';
import WebSocket, { WebSocketServer } from 'ws';
import { dispatchDesktopLocalApiRequest, subscribeDesktopLocalApiStream } from './app/localApi.js';
import { readRemoteAccessSession } from './ui/remoteAccessAuth.js';

interface JsonRpcRequest {
  id?: number;
  method?: unknown;
  params?: unknown;
}

interface JsonRpcError {
  code: number;
  message: string;
}

interface AppServerConnectionState {
  initialized: boolean;
  nextSubscriptionId: number;
  subscriptions: Map<string, () => void>;
}

function readCookieValue(cookieHeader: string | undefined, cookieName: string): string {
  if (!cookieHeader?.trim()) {
    return '';
  }

  const pairs = cookieHeader.split(';');
  for (const pair of pairs) {
    const [rawName, ...valueParts] = pair.split('=');
    if (rawName?.trim() !== cookieName) {
      continue;
    }

    return decodeURIComponent(valueParts.join('=').trim());
  }

  return '';
}

function normalizeAuthHost(value: string | undefined): string {
  if (!value?.trim()) {
    return '';
  }

  const token = value.split(',')[0]?.trim().toLowerCase() ?? '';
  return token.replace(/^\[/, '').replace(/\]$/, '').replace(/:\d+$/, '');
}

function isTailnetRemoteAccessRequest(request: IncomingMessage): boolean {
  const host = normalizeAuthHost(typeof request.headers['x-forwarded-host'] === 'string'
    ? request.headers['x-forwarded-host']
    : typeof request.headers.host === 'string'
      ? request.headers.host
      : undefined);

  if (host.endsWith('.ts.net')) {
    return true;
  }

  return ['tailscale-user-login', 'tailscale-user-name', 'tailscale-user-profile-pic', 'tailscale-app-capabilities']
    .some((headerName) => {
      const value = request.headers[headerName];
      return typeof value === 'string' && value.trim().length > 0;
    });
}

function readBearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string') {
    return '';
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function resolveRemoteAccessToken(request: IncomingMessage): string {
  const bearerToken = readBearerToken(request);
  if (bearerToken) {
    return bearerToken;
  }

  return readCookieValue(typeof request.headers.cookie === 'string' ? request.headers.cookie : undefined, 'pa_web');
}

function sendUpgradeError(socket: Socket, statusCode: number, message: string): void {
  const statusText = statusCode === 401 ? 'Unauthorized' : statusCode === 404 ? 'Not Found' : 'Error';
  socket.write(
    `HTTP/1.1 ${String(statusCode)} ${statusText}\r\n`
      + 'Connection: close\r\n'
      + 'Content-Type: text/plain; charset=utf-8\r\n'
      + `Content-Length: ${String(Buffer.byteLength(message, 'utf-8'))}\r\n`
      + '\r\n'
      + message,
  );
  socket.destroy();
}

function sendResponse(socket: WebSocket, id: number, result: unknown): void {
  socket.send(JSON.stringify({ id, result }));
}

function sendError(socket: WebSocket, id: number | null, error: JsonRpcError): void {
  if (typeof id !== 'number') {
    socket.send(JSON.stringify({ method: 'error', params: { error } }));
    return;
  }

  socket.send(JSON.stringify({ id, error }));
}

function sendNotification(socket: WebSocket, method: string, params?: unknown): void {
  socket.send(JSON.stringify({ method, ...(params !== undefined ? { params } : {}) }));
}

async function handleRequest(
  socket: WebSocket,
  state: AppServerConnectionState,
  request: JsonRpcRequest,
): Promise<void> {
  const id = typeof request.id === 'number' ? request.id : null;
  const method = typeof request.method === 'string' ? request.method : '';

  if (!method) {
    sendError(socket, id, { code: -32600, message: 'Method required.' });
    return;
  }

  if (!state.initialized && method !== 'initialize') {
    sendError(socket, id, { code: -32002, message: 'Not initialized.' });
    return;
  }

  if (method === 'initialize') {
    if (state.initialized) {
      sendError(socket, id, { code: -32003, message: 'Already initialized.' });
      return;
    }

    state.initialized = true;
    sendResponse(socket, id ?? 0, {
      serverInfo: {
        name: 'personal-agent',
        protocol: 'pa-app-server-v1',
      },
      capabilities: {
        experimentalApi: true,
        paHttpTransport: true,
      },
    });
    return;
  }

  if (method === 'initialized') {
    return;
  }

  if (method === 'pa/http/request') {
    if (id === null) {
      return;
    }

    const params = request.params as {
      method?: unknown;
      path?: unknown;
      body?: unknown;
      headers?: unknown;
    } | undefined;
    const httpMethod = params?.method;
    const path = typeof params?.path === 'string' ? params.path : '';
    if (httpMethod !== 'GET' && httpMethod !== 'POST' && httpMethod !== 'PATCH' && httpMethod !== 'DELETE') {
      sendError(socket, id, { code: -32602, message: 'HTTP method must be GET, POST, PATCH, or DELETE.' });
      return;
    }
    if (!path.startsWith('/api/')) {
      sendError(socket, id, { code: -32602, message: 'Only /api paths can be requested over pa/http/request.' });
      return;
    }

    try {
      const response = await dispatchDesktopLocalApiRequest({
        method: httpMethod,
        path,
        body: params?.body,
        headers: params?.headers && typeof params.headers === 'object'
          ? Object.fromEntries(Object.entries(params.headers as Record<string, unknown>).flatMap(([key, value]) =>
            typeof value === 'string' ? [[key, value]] : [],
          ))
          : undefined,
      });

      sendResponse(socket, id, {
        statusCode: response.statusCode,
        headers: response.headers,
        bodyBase64: Buffer.from(response.body).toString('base64'),
      });
    } catch (error) {
      sendError(socket, id, {
        code: -32010,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (method === 'pa/http/subscribe') {
    if (id === null) {
      return;
    }

    const params = request.params as { path?: unknown } | undefined;
    const path = typeof params?.path === 'string' ? params.path : '';
    if (!path.startsWith('/api/')) {
      sendError(socket, id, { code: -32602, message: 'Only /api paths can be subscribed over pa/http/subscribe.' });
      return;
    }

    const subscriptionId = `sub-${Date.now().toString(36)}-${String(state.nextSubscriptionId++)}`;
    try {
      const unsubscribe = await subscribeDesktopLocalApiStream(path, (event) => {
        sendNotification(socket, 'pa/http/subscription/event', {
          subscriptionId,
          event,
        });
      });
      state.subscriptions.set(subscriptionId, unsubscribe);
      sendResponse(socket, id, { subscriptionId });
    } catch (error) {
      sendError(socket, id, {
        code: -32011,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (method === 'pa/http/unsubscribe') {
    if (id === null) {
      return;
    }

    const params = request.params as { subscriptionId?: unknown } | undefined;
    const subscriptionId = typeof params?.subscriptionId === 'string' ? params.subscriptionId.trim() : '';
    const unsubscribe = subscriptionId ? state.subscriptions.get(subscriptionId) : undefined;
    if (subscriptionId) {
      state.subscriptions.delete(subscriptionId);
      unsubscribe?.();
    }
    sendResponse(socket, id, {});
    return;
  }

  sendError(socket, id, { code: -32601, message: `Method not found: ${method}` });
}

function handleSocketConnection(socket: WebSocket): void {
  const state: AppServerConnectionState = {
    initialized: false,
    nextSubscriptionId: 1,
    subscriptions: new Map(),
  };

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      return;
    }

    const rawMessage = typeof data === 'string' ? data : data.toString('utf-8');
    let parsed: JsonRpcRequest;
    try {
      parsed = JSON.parse(rawMessage) as JsonRpcRequest;
    } catch {
      sendError(socket, null, { code: -32700, message: 'Invalid JSON.' });
      return;
    }

    void handleRequest(socket, state, parsed).catch((error) => {
      const id = typeof parsed.id === 'number' ? parsed.id : null;
      sendError(socket, id, {
        code: -32099,
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  socket.once('close', () => {
    for (const [subscriptionId, unsubscribe] of state.subscriptions.entries()) {
      state.subscriptions.delete(subscriptionId);
      unsubscribe();
    }
  });
}

export function createAppServerUpgradeHandler(): {
  handleUpgrade: (request: IncomingMessage, socket: Socket, head: Buffer) => boolean;
} {
  const webSocketServer = new WebSocketServer({ noServer: true });
  webSocketServer.on('connection', (socket) => {
    handleSocketConnection(socket);
  });

  return {
    handleUpgrade: (request, socket, head) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/api/app-server') {
        return false;
      }

      const remoteAccessToken = resolveRemoteAccessToken(request);
      if (remoteAccessToken) {
        const session = readRemoteAccessSession(remoteAccessToken);
        if (!session) {
          sendUpgradeError(socket, 401, 'Remote access sign-in required.');
          return true;
        }
      } else if (isTailnetRemoteAccessRequest(request)) {
        sendUpgradeError(socket, 401, 'Remote access sign-in required.');
        return true;
      }

      webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        webSocketServer.emit('connection', webSocket, request);
      });
      return true;
    },
  };
}
