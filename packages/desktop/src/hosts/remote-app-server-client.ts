import { Buffer } from 'node:buffer';
import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import type { DesktopApiStreamEvent, HostApiDispatchResult } from './types.js';

interface JsonRpcRequest {
  id?: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
}

interface AppServerSubscriptionEventNotification {
  method: 'pa/http/subscription/event';
  params?: {
    subscriptionId?: string;
    event?: DesktopApiStreamEvent;
  };
}

function renderWebSocketUrl(baseUrl: string): string {
  const url = new URL('/api/app-server', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function renderRpcError(response: JsonRpcResponse): Error {
  const message = response.error?.message?.trim() || `RPC request ${String(response.id)} failed.`;
  return new Error(message);
}

async function readUnexpectedResponseMessage(response: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of response) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const bodyText = Buffer.concat(chunks).toString('utf-8').trim();
  return bodyText || `${String(response.statusCode ?? 500)} ${response.statusMessage ?? 'Remote app-server connection failed.'}`;
}

export class RemoteAppServerClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private initialized = false;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private streamListeners = new Map<string, (event: DesktopApiStreamEvent) => void>();
  private pendingStreamEvents = new Map<string, DesktopApiStreamEvent[]>();

  constructor(
    private readonly input: {
      baseUrl: string;
      headers?: Record<string, string>;
    },
  ) {}

  async dispatchApiRequest(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<HostApiDispatchResult> {
    const result = await this.request<{
      statusCode: number;
      headers?: Record<string, string>;
      bodyBase64?: string;
    }>('pa/http/request', input);

    return {
      statusCode: result.statusCode,
      headers: result.headers ?? {},
      body: result.bodyBase64 ? Uint8Array.from(Buffer.from(result.bodyBase64, 'base64')) : new Uint8Array(),
    };
  }

  async subscribeApiStream(
    path: string,
    onEvent: (event: DesktopApiStreamEvent) => void,
  ): Promise<() => void> {
    const result = await this.request<{ subscriptionId: string }>('pa/http/subscribe', { path });
    const subscriptionId = result.subscriptionId.trim();
    this.streamListeners.set(subscriptionId, onEvent);
    this.flushPendingStreamEvents(subscriptionId);

    return async () => {
      this.streamListeners.delete(subscriptionId);
      this.pendingStreamEvents.delete(subscriptionId);
      try {
        await this.request('pa/http/unsubscribe', { subscriptionId });
      } catch {
        // Ignore best-effort remote stream teardown failures.
      }
    };
  }

  async ensureConnected(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.initialized) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(renderWebSocketUrl(this.input.baseUrl), {
        headers: this.input.headers,
      });

      const finishReject = (error: Error) => {
        if (this.socket === socket) {
          this.socket = null;
        }
        this.initialized = false;
        reject(error);
      };

      socket.once('open', async () => {
        try {
          this.socket = socket;
          await this.requestInternal(socket, 'initialize', {
            clientInfo: {
              name: 'personal_agent_desktop',
              title: 'Personal Agent Desktop',
              version: '0.1.11',
            },
            capabilities: {
              experimentalApi: true,
            },
          });
          socket.send(JSON.stringify({ method: 'initialized', params: {} }));
          this.initialized = true;
          resolve();
        } catch (error) {
          finishReject(error instanceof Error ? error : new Error(String(error)));
          socket.close();
        }
      });

      socket.on('message', (data: WebSocket.RawData) => {
        this.handleSocketMessage(socket, data.toString());
      });

      socket.once('unexpected-response', (_request: unknown, response: IncomingMessage) => {
        void (async () => {
          const message = await readUnexpectedResponseMessage(response);
          finishReject(new Error(message));
        })();
      });

      socket.once('error', (error: Error) => {
        if (!this.initialized) {
          finishReject(error instanceof Error ? error : new Error(String(error)));
        }
      });

      socket.once('close', () => {
        if (!this.initialized) {
          finishReject(new Error('Remote app-server connection closed before initialization completed.'));
          return;
        }

        this.handleSocketClosed(new Error('Remote app-server connection closed.'));
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  dispose(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.handleSocketClosed(new Error('Remote app-server connection closed.'));
  }

  private async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.ensureConnected();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Remote app-server connection is not open.');
    }

    return this.requestInternal<T>(socket, method, params);
  }

  private requestInternal<T = unknown>(socket: WebSocket, method: string, params?: unknown): Promise<T> {
    const id = this.nextRequestId++;
    const request: JsonRpcRequest = {
      method,
      id,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      socket.send(JSON.stringify(request), (error?: Error) => {
        if (!error) {
          return;
        }

        const pending = this.pendingRequests.get(id);
        this.pendingRequests.delete(id);
        pending?.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private handleSocketMessage(socket: WebSocket, rawMessage: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawMessage) as unknown;
    } catch {
      return;
    }

    if (!parsed || typeof parsed !== 'object') {
      return;
    }

    if ('id' in parsed && typeof (parsed as JsonRpcResponse).id === 'number') {
      const response = parsed as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(response.id);
      if (response.error) {
        pending.reject(renderRpcError(response));
        return;
      }

      pending.resolve(response.result);
      return;
    }

    const notification = parsed as Partial<AppServerSubscriptionEventNotification>;
    if (notification.method === 'pa/http/subscription/event') {
      const subscriptionId = notification.params?.subscriptionId?.trim() ?? '';
      const event = notification.params?.event;
      if (!subscriptionId || !event) {
        return;
      }

      const listener = this.streamListeners.get(subscriptionId);
      if (listener) {
        listener(event);
        return;
      }

      const pendingEvents = this.pendingStreamEvents.get(subscriptionId) ?? [];
      pendingEvents.push(event);
      this.pendingStreamEvents.set(subscriptionId, pendingEvents);
      return;
    }

    if (notification.method === 'error' && socket.readyState === WebSocket.OPEN) {
      this.handleSocketClosed(new Error('Remote app-server reported an error.'));
    }
  }

  private flushPendingStreamEvents(subscriptionId: string): void {
    const listener = this.streamListeners.get(subscriptionId);
    const pendingEvents = this.pendingStreamEvents.get(subscriptionId);
    if (!listener || !pendingEvents || pendingEvents.length === 0) {
      this.pendingStreamEvents.delete(subscriptionId);
      return;
    }

    this.pendingStreamEvents.delete(subscriptionId);
    for (const event of pendingEvents) {
      listener(event);
    }
  }

  private handleSocketClosed(error: Error): void {
    const socket = this.socket;
    this.socket = null;
    this.initialized = false;

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }

    for (const [id, pending] of this.pendingRequests.entries()) {
      this.pendingRequests.delete(id);
      pending.reject(error);
    }

    for (const listener of this.streamListeners.values()) {
      listener({ type: 'error', message: error.message });
      listener({ type: 'close' });
    }

    this.streamListeners.clear();
    this.pendingStreamEvents.clear();
  }
}
