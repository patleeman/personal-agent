import { createServer, type IncomingMessage } from 'node:http';
import { createServer as createNetServer, type Socket } from 'node:net';
import { createInterface } from 'node:readline';

import type { ExtensionBackendContext } from '@personal-agent/extensions';
import { type WebSocket, WebSocketServer } from 'ws';

import type { CodexAuth } from './codexAuth.js';
import { cleanupTurnSubscriptions } from './protocol/turn.js';

// ── JSON-RPC 2.0 types ──────────────────────────────────────────────────────

interface JsonRpcRequest {
  jsonrpc?: '2.0';
  id?: number | string;
  method: string;
  params?: unknown;
}

interface JsonRpcSuccess {
  jsonrpc: '2.0';
  id: number | string;
  result: unknown;
}

interface JsonRpcError {
  jsonrpc: '2.0';
  id: number | string | null;
  error: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params: unknown;
}

// ── Connection state ─────────────────────────────────────────────────────────

export interface ConnectionState {
  initialized: boolean;
  clientInfo?: { name?: string; title?: string; version?: string };
  /** Set of thread ids this connection is subscribed to. */
  subscribedThreads: Set<string>;
  /** Track which threads this connection has initiated turn/start for cleanup on disconnect. */
  activeTurnThreads: Set<string>;
}

export type NotifyFn = (method: string, params: unknown) => void;

export type MethodHandler = (params: unknown, ctx: ExtensionBackendContext, conn: ConnectionState, notify: NotifyFn) => Promise<unknown>;

// ── Thread event dispatch ────────────────────────────────────────────────────
// Maps threadId → set of notification functions for subscribed connections.
// The server.close/connection-close handlers call unsubscribeConnectionFromAll.

interface ThreadSubscriberGroup {
  notifiers: Set<NotifyFn>;
  unsubscribe?: () => void;
  /** Track which connections are subscribed for cleanup on disconnect. */
  connectionIds?: Set<string>;
}

const threadSubscribers = new Map<string, ThreadSubscriberGroup>();

function broadcastToThread(threadId: string, method: string, params: unknown): void {
  const group = threadSubscribers.get(threadId);
  if (!group) return;
  for (const notify of group.notifiers) {
    notify(method, params);
  }
}

/**
 * Subscribe a connection to a thread.
 * If this is the first subscriber, also subscribe to the PA conversation events.
 */
function subscribeConnectionToThread(threadId: string, notify: NotifyFn, ctx: ExtensionBackendContext, conn?: ConnectionState): void {
  let group = threadSubscribers.get(threadId);
  if (!group) {
    group = { notifiers: new Set(), connectionIds: new Set() };
    const unsub = ctx.conversations.subscribe(threadId, (event: unknown) => {
      const ev = event as Record<string, unknown>;
      if (!ev || typeof ev.type !== 'string') return;
      forwardConversationEvent(threadId, ev);
    });
    if (unsub) group.unsubscribe = unsub;
    threadSubscribers.set(threadId, group);
  }
  group.notifiers.add(notify);
  if (conn) {
    group.connectionIds!.add(getConnId(conn));
    conn.subscribedThreads.add(threadId);
  }
}

function getConnId(conn: ConnectionState): string {
  return conn.clientInfo?.name ?? `conn-${(conn as Record<string, unknown>).initialized}`;
}

/**
 * Remove a connection (identified by its notify function) from all
 * thread subscriptions. Called on WebSocket close/error.
 */
function unsubscribeConnectionFromAll(notify: NotifyFn, conn?: ConnectionState): void {
  for (const [threadId, group] of threadSubscribers) {
    group.notifiers.delete(notify);
    if (group.notifiers.size === 0) {
      group.unsubscribe?.();
      threadSubscribers.delete(threadId);
    }
  }
  // Clean up active turn threads for this connection
  if (conn) {
    for (const threadId of conn.activeTurnThreads) {
      cleanupTurnSubscriptions(threadId);
    }
    conn.activeTurnThreads.clear();
  }
}

/**
 * Forward a PA conversation event to all subscribers as Codex notifications.
 * Maps PA SSE event types to Codex notification methods.
 */
function forwardConversationEvent(threadId: string, ev: Record<string, unknown>): void {
  switch (ev.type) {
    case 'agent_start':
      broadcastToThread(threadId, 'thread/status/changed', {
        threadId,
        status: { type: 'active', activeFlags: ['agent'] },
      });
      break;
    case 'agent_end':
      broadcastToThread(threadId, 'thread/status/changed', {
        threadId,
        status: { type: 'active', activeFlags: ['processing'] },
      });
      break;
    case 'turn_end':
      broadcastToThread(threadId, 'thread/status/changed', {
        threadId,
        status: { type: 'idle' },
      });
      break;
    case 'compaction_start':
      broadcastToThread(threadId, 'thread/status/changed', {
        threadId,
        status: { type: 'active', activeFlags: ['compacting'] },
      });
      break;
    case 'compaction_end':
      broadcastToThread(threadId, 'thread/status/changed', {
        threadId,
        status: { type: 'idle' },
      });
      break;
    case 'title_update':
      broadcastToThread(threadId, 'thread/name/updated', {
        threadId,
        name: ev.title as string,
      });
      break;
    case 'cwd_changed':
      broadcastToThread(threadId, 'thread/metadata/updated', {
        threadId,
        cwd: ev.cwd as string,
      });
      break;
    case 'error':
      broadcastToThread(threadId, 'thread/error', {
        threadId,
        message: ev.message as string,
      });
      break;
    case 'user_message':
      broadcastToThread(threadId, 'thread/userMessage', {
        threadId,
        content: (ev.block as Record<string, unknown> | undefined)?.content as string | undefined,
      });
      break;
    case 'stats_update': {
      const tokens = ev.tokens as Record<string, unknown> | undefined;
      broadcastToThread(threadId, 'thread/tokens/updated', {
        threadId,
        inputTokens: tokens?.input as number | undefined,
        outputTokens: tokens?.output as number | undefined,
        totalTokens: tokens?.total as number | undefined,
      });
      break;
    }
  }
}

// ── Server ───────────────────────────────────────────────────────────────────

export interface CodexServerOptions {
  port: number;
  auth: CodexAuth;
  ctx: ExtensionBackendContext;
  /** Bind address. Default: '0.0.0.0' */
  bindAddress?: string;
  fallbackToEphemeralPortOnConflict?: boolean;
}

export interface CodexServerHandle {
  port: number;
  jsonlPort: number;
  stop: () => void;
}

async function handleJsonRpcMessage(input: {
  raw: string;
  conn: ConnectionState;
  ctx: ExtensionBackendContext;
  notify: NotifyFn;
  sendJson: (data: unknown) => void;
  getHandlers: () => Promise<Record<string, MethodHandler>>;
}): Promise<void> {
  let request: JsonRpcRequest;
  try {
    request = JSON.parse(input.raw) as JsonRpcRequest;
  } catch {
    input.sendJson({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' },
    } satisfies JsonRpcError);
    return;
  }

  const { method, id, params } = request;

  if (id === undefined || id === null) return;

  if (method !== 'initialize' && !input.conn.initialized) {
    input.sendJson({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: 'Not initialized' },
    } satisfies JsonRpcError);
    return;
  }

  try {
    const allHandlers = await input.getHandlers();
    const handler = allHandlers[method];
    if (!handler) {
      input.sendJson({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      } satisfies JsonRpcError);
      return;
    }

    const result = await handler(params, input.ctx, input.conn, input.notify);
    input.sendJson({ jsonrpc: '2.0', id, result } satisfies JsonRpcSuccess);
  } catch (error) {
    input.sendJson({
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : String(error),
      },
    } satisfies JsonRpcError);
  }
}

async function canBindPort(port: number, bindAddress: string): Promise<boolean> {
  const server = createNetServer();
  return await new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(port, bindAddress, () => {
      server.close(() => resolve(true));
    });
  });
}

export async function createCodexServer(options: CodexServerOptions): Promise<CodexServerHandle> {
  let { port } = options;
  const { auth, ctx } = options;

  let handlers: Record<string, MethodHandler> | null = null;

  const getHandlers = async (): Promise<Record<string, MethodHandler>> => {
    if (handlers) return handlers;
    const m = await import('./protocol/index.js');
    handlers = m.REGISTERED_HANDLERS;
    return handlers;
  };

  const bindAddress = options.bindAddress ?? '0.0.0.0';
  if (options.fallbackToEphemeralPortOnConflict && port !== 0 && !(await canBindPort(port, bindAddress))) {
    ctx.log.warn(`codex protocol port ${port} is already in use; falling back to an ephemeral port`);
    port = 0;
  }

  const httpServer = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });

  const wss = new WebSocketServer({ server: httpServer });

  const jsonlServer = createNetServer((socket: Socket) => {
    socket.setEncoding('utf8');
    const conn: ConnectionState = {
      initialized: false,
      subscribedThreads: new Set(),
      activeTurnThreads: new Set(),
    };
    const sendJson = (data: unknown) => {
      if (!socket.destroyed) socket.write(`${JSON.stringify(data)}\n`);
    };
    const notify: NotifyFn = (method: string, params: unknown) => {
      sendJson({ jsonrpc: '2.0', method, params } satisfies JsonRpcNotification);
    };
    const lines = createInterface({ input: socket, crlfDelay: Infinity });
    lines.on('line', (line) => {
      if (!line.trim()) return;
      void handleJsonRpcMessage({ raw: line, conn, ctx, notify, sendJson, getHandlers });
    });
    const cleanupConnection = () => unsubscribeConnectionFromAll(notify, conn);
    socket.on('close', cleanupConnection);
    socket.on('error', cleanupConnection);
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const heartbeat = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.ping();
      }
    }, 25_000);
    heartbeat.unref?.();

    const conn: ConnectionState = {
      initialized: false,
      subscribedThreads: new Set(),
      activeTurnThreads: new Set(),
    };

    // Optional bearer auth
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (token && !auth.validate(token)) {
      ws.close(4001, 'Unauthorized: invalid token');
      return;
    }

    const sendJson = (data: unknown) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(data));
      }
    };

    const notify: NotifyFn = (method: string, params: unknown) => {
      sendJson({ jsonrpc: '2.0', method, params } satisfies JsonRpcNotification);
    };

    ws.on('message', (raw) => {
      void handleJsonRpcMessage({ raw: raw.toString(), conn, ctx, notify, sendJson, getHandlers });
    });

    const cleanupConnection = () => {
      clearInterval(heartbeat);
      unsubscribeConnectionFromAll(notify, conn);
    };

    ws.on('close', cleanupConnection);

    ws.on('error', cleanupConnection);
  });

  return new Promise((resolve, reject) => {
    let attemptedFallback = false;

    const onListening = () => {
      httpServer.off('error', onError);
      const addr = httpServer.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const startJsonlServer = () => {
        jsonlServer.listen(0, bindAddress, () => {
          const jsonlAddr = jsonlServer.address();
          const jsonlPort = typeof jsonlAddr === 'object' && jsonlAddr ? jsonlAddr.port : 0;
          resolve({
            port: actualPort,
            jsonlPort,
            stop: () => {
              for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
              wss.close();
              httpServer.close();
              jsonlServer.close();
              // Clean up all thread subscriptions
              for (const [, group] of threadSubscribers) {
                group.unsubscribe?.();
              }
              threadSubscribers.clear();
            },
          });
        });
      };
      jsonlServer.once('error', (error) => reject(error));
      startJsonlServer();
    };

    const onError = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && options.fallbackToEphemeralPortOnConflict && port !== 0 && !attemptedFallback) {
        attemptedFallback = true;
        ctx.log.warn(`codex protocol port ${port} is already in use; falling back to an ephemeral port`);
        httpServer.close(() => {
          httpServer.listen(0, bindAddress, onListening);
        });
        return;
      }
      reject(error);
    };

    httpServer.on('error', onError);
    httpServer.listen(port, bindAddress, onListening);
  });
}

export { broadcastToThread, subscribeConnectionToThread, unsubscribeConnectionFromThread };

function unsubscribeConnectionFromThread(threadId: string, notify: NotifyFn): void {
  const group = threadSubscribers.get(threadId);
  if (!group) return;
  group.notifiers.delete(notify);
  if (group.notifiers.size === 0) {
    group.unsubscribe?.();
    threadSubscribers.delete(threadId);
  }
}
