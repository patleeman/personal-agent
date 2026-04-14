import WebSocket from 'ws';

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
}

interface JsonRpcNotification {
  method?: string;
  params?: unknown;
}

function renderRpcError(response: JsonRpcResponse): Error {
  return new Error(response.error?.message?.trim() || `Codex RPC request ${String(response.id)} failed.`);
}

export class CodexAppServerClient {
  private socket: WebSocket | null = null;
  private connectPromise: Promise<void> | null = null;
  private initialized = false;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }>();
  private notificationListeners = new Set<(notification: JsonRpcNotification) => void>();

  constructor(
    private readonly input: {
      websocketUrl: string;
      headers?: Record<string, string>;
    },
  ) {}

  async ensureConnected(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN && this.initialized) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.input.websocketUrl, {
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
              version: '0.1.18',
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
        this.handleSocketMessage(data.toString());
      });

      socket.once('error', (error: Error) => {
        if (!this.initialized) {
          finishReject(error instanceof Error ? error : new Error(String(error)));
        }
      });

      socket.once('close', () => {
        if (!this.initialized) {
          finishReject(new Error('Codex app-server connection closed before initialization completed.'));
          return;
        }

        this.handleSocketClosed(new Error('Codex app-server connection closed.'));
      });
    }).finally(() => {
      this.connectPromise = null;
    });

    return this.connectPromise;
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.ensureConnected();
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Codex app-server connection is not open.');
    }

    return this.requestInternal<T>(socket, method, params);
  }

  subscribeNotifications(listener: (notification: JsonRpcNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.handleSocketClosed(new Error('Codex app-server connection closed.'));
  }

  private requestInternal<T = unknown>(socket: WebSocket, method: string, params?: unknown): Promise<T> {
    const id = this.nextRequestId++;
    const payload = {
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      socket.send(JSON.stringify(payload), (error?: Error) => {
        if (!error) {
          return;
        }

        const pending = this.pendingRequests.get(id);
        this.pendingRequests.delete(id);
        pending?.reject(error instanceof Error ? error : new Error(String(error)));
      });
    });
  }

  private handleSocketMessage(rawMessage: string): void {
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

    const notification = parsed as JsonRpcNotification;
    if (typeof notification.method !== 'string') {
      return;
    }

    for (const listener of this.notificationListeners) {
      listener(notification);
    }
  }

  private handleSocketClosed(error: Error): void {
    const socket = this.socket;
    this.socket = null;
    this.initialized = false;

    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.close();
    }
  }
}
