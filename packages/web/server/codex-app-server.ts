import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { getStateRoot, buildCodexThreadFromSessionDetail, type CodexThread, type CodexThreadStatus, type CompatSessionDetail } from '@personal-agent/core';
import {
  createDesktopLiveSession,
  readDesktopConversationBootstrap,
  readDesktopModels,
  readDesktopSessions,
  renameDesktopConversation,
  resumeDesktopLiveSession,
  submitDesktopLiveSessionPrompt,
  subscribeDesktopLocalApiStream,
} from './app/localApi.js';

interface JsonRpcRequest {
  id?: number | string;
  method?: unknown;
  params?: unknown;
}

interface ConnectionThreadRuntime {
  model: string;
  modelProvider: string;
  cwd: string;
  reasoningEffort: 'low' | 'medium' | 'high' | null;
  approvalPolicy: 'never';
  approvalsReviewer: 'user';
  sandbox: { type: 'dangerFullAccess' };
  unsubscribe?: () => void;
  activeTurn?: {
    id: string;
    startedAt: number;
    agentMessageItemId?: string;
    agentMessageText: string;
    reasoningItemId?: string;
    reasoningText: string;
    sentTurnStarted: boolean;
  };
}

interface ConnectionState {
  initialized: boolean;
  threads: Map<string, ConnectionThreadRuntime>;
  nextTurnCounter: number;
}

export interface CodexAppServerHandle {
  websocketUrl: string;
  close(): Promise<void>;
}

function normalizePathname(value: string): string {
  return value.endsWith('/') && value.length > 1 ? value.slice(0, -1) : value;
}

function createInitializeResult() {
  return {
    userAgent: 'personal-agent-codex-app-server',
    codexHome: join(getStateRoot(), 'codex-home'),
    platformFamily: process.platform === 'win32' ? 'windows' : 'unix',
    platformOs: process.platform === 'darwin' ? 'macos' : process.platform,
  };
}

function sendJson(socket: WebSocket, payload: unknown): void {
  socket.send(JSON.stringify(payload));
}

function sendResult(socket: WebSocket, id: string | number, result: unknown): void {
  sendJson(socket, { id, result });
}

function sendError(socket: WebSocket, id: string | number | null, code: number, message: string): void {
  sendJson(socket, id === null ? { method: 'error', params: { error: { code, message } } } : { id, error: { code, message } });
}

function sendNotification(socket: WebSocket, method: string, params: unknown): void {
  sendJson(socket, { method, params });
}

function toRequestId(request: JsonRpcRequest): string | number | null {
  return typeof request.id === 'number' || typeof request.id === 'string' ? request.id : null;
}

function parseJsonRpc(raw: string): JsonRpcRequest | null {
  try {
    return JSON.parse(raw) as JsonRpcRequest;
  } catch {
    return null;
  }
}

function parseTextInput(input: unknown): string {
  if (!Array.isArray(input)) {
    return '';
  }

  return input
    .flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const typedEntry = entry as { type?: unknown; text?: unknown };
      if (typedEntry.type !== 'text' || typeof typedEntry.text !== 'string') {
        return [];
      }

      return [typedEntry.text];
    })
    .join('\n\n')
    .trim();
}

function normalizeReasoningEffort(value: unknown): 'low' | 'medium' | 'high' | null {
  return value === 'low' || value === 'medium' || value === 'high' ? value : null;
}

function buildModelCatalog(state: Awaited<ReturnType<typeof readDesktopModels>>) {
  const models = Array.isArray(state.models) ? state.models : [];
  const descriptors = models.map((model, index) => ({
    id: model.id,
    model: model.id,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    displayName: model.name || model.id,
    description: model.name || model.id,
    hidden: false,
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Low reasoning' },
      { reasoningEffort: 'medium', description: 'Medium reasoning' },
      { reasoningEffort: 'high', description: 'High reasoning' },
    ],
    defaultReasoningEffort: normalizeReasoningEffort(state.currentThinkingLevel) ?? 'medium',
    inputModalities: ['text'],
    supportsPersonality: false,
    additionalSpeedTiers: [],
    isDefault: model.id === state.currentModel || (!state.currentModel && index === 0),
    provider: model.provider,
  }));

  return {
    currentModel: state.currentModel || descriptors[0]?.model || '',
    currentThinkingLevel: normalizeReasoningEffort(state.currentThinkingLevel) ?? 'medium',
    descriptors,
  };
}

function resolveThreadStatus(detail: CompatSessionDetail): CodexThreadStatus {
  if (detail.meta.isRunning) {
    return { type: 'active', activeFlags: [] };
  }

  return { type: 'idle' };
}

function buildThreadSummary(input: {
  detail: CompatSessionDetail;
  modelProvider: string;
  cliVersion: string;
}): CodexThread {
  const thread = buildCodexThreadFromSessionDetail(input);
  return {
    ...thread,
    turns: [],
    status: resolveThreadStatus(input.detail),
  };
}

function detailFromBootstrap(input: {
  conversationId: string;
  bootstrap: Awaited<ReturnType<typeof readDesktopConversationBootstrap>>;
}): CompatSessionDetail {
  if (input.bootstrap.sessionDetail) {
    return input.bootstrap.sessionDetail as CompatSessionDetail;
  }

  const liveSession = input.bootstrap.liveSession;
  if (!liveSession.live) {
    throw new Error('Thread not found');
  }

  return {
    meta: {
      id: input.conversationId,
      file: liveSession.sessionFile,
      timestamp: new Date().toISOString(),
      cwd: liveSession.cwd,
      cwdSlug: liveSession.cwd.split('/').filter(Boolean).at(-1) ?? 'workspace',
      model: '',
      title: liveSession.title ?? input.conversationId,
      messageCount: 0,
      isRunning: liveSession.isStreaming,
      isLive: true,
      lastActivityAt: new Date().toISOString(),
    },
    blocks: [],
    blockOffset: 0,
    totalBlocks: 0,
    contextUsage: null,
    signature: undefined,
  };
}

async function readThreadDetail(input: {
  conversationId: string;
  modelProvider: string;
  cliVersion: string;
}): Promise<{ detail: CompatSessionDetail; thread: CodexThread }> {
  const bootstrap = await readDesktopConversationBootstrap({ conversationId: input.conversationId });
  const detail = detailFromBootstrap({ conversationId: input.conversationId, bootstrap });
  return {
    detail,
    thread: buildCodexThreadFromSessionDetail({
      detail,
      modelProvider: input.modelProvider,
      cliVersion: input.cliVersion,
    }),
  };
}

function buildThreadRuntime(input: {
  detail: CompatSessionDetail;
  model: string;
  modelProvider: string;
  reasoningEffort: 'low' | 'medium' | 'high' | null;
}): ConnectionThreadRuntime {
  return {
    model: input.model,
    modelProvider: input.modelProvider,
    cwd: input.detail.meta.cwd,
    reasoningEffort: input.reasoningEffort,
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandbox: { type: 'dangerFullAccess' },
  };
}

function buildThreadStartLikeResponse(input: {
  thread: CodexThread;
  runtime: ConnectionThreadRuntime;
}) {
  return {
    thread: input.thread,
    model: input.runtime.model,
    modelProvider: input.runtime.modelProvider,
    serviceTier: null,
    cwd: input.runtime.cwd,
    instructionSources: [],
    approvalPolicy: input.runtime.approvalPolicy,
    approvalsReviewer: input.runtime.approvalsReviewer,
    sandbox: input.runtime.sandbox,
    reasoningEffort: input.runtime.reasoningEffort,
  };
}

async function ensureThreadSubscription(input: {
  socket: WebSocket;
  state: ConnectionState;
  threadId: string;
}): Promise<ConnectionThreadRuntime> {
  const runtime = input.state.threads.get(input.threadId);
  if (!runtime) {
    throw new Error(`Unknown thread: ${input.threadId}`);
  }

  if (runtime.unsubscribe) {
    return runtime;
  }

  runtime.unsubscribe = await subscribeDesktopLocalApiStream(`/api/live-sessions/${encodeURIComponent(input.threadId)}/events`, (event) => {
    if (event.type !== 'message' || typeof event.data !== 'string') {
      return;
    }

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    const eventType = typeof parsed?.type === 'string' ? parsed.type : '';
    if (!eventType) {
      return;
    }
    const payload = parsed ?? {};

    const activeRuntime = input.state.threads.get(input.threadId);
    if (!activeRuntime) {
      return;
    }

    const ensureActiveTurn = (): NonNullable<ConnectionThreadRuntime['activeTurn']> => {
      if (activeRuntime.activeTurn) {
        return activeRuntime.activeTurn;
      }

      const turn = {
        id: `${input.threadId}:active-turn:${String(input.state.nextTurnCounter++)}`,
        startedAt: Math.floor(Date.now() / 1000),
        agentMessageText: '',
        reasoningText: '',
        sentTurnStarted: false,
      };
      activeRuntime.activeTurn = turn;
      if (!turn.sentTurnStarted) {
        sendNotification(input.socket, 'thread/status/changed', {
          threadId: input.threadId,
          status: { type: 'active', activeFlags: [] },
        });
        sendNotification(input.socket, 'turn/started', {
          threadId: input.threadId,
          turn: {
            id: turn.id,
            items: [],
            status: 'inProgress',
            error: null,
            startedAt: turn.startedAt,
            completedAt: null,
            durationMs: null,
          },
        });
        turn.sentTurnStarted = true;
      }
      return turn;
    };

    if (eventType === 'title_update' && typeof payload.title === 'string') {
      sendNotification(input.socket, 'thread/name/updated', {
        threadId: input.threadId,
        name: payload.title,
      });
      return;
    }

    if (eventType === 'turn_end') {
      const activeTurn = activeRuntime.activeTurn;
      if (!activeTurn) {
        return;
      }

      const completedAt = Math.floor(Date.now() / 1000);
      if (activeTurn.reasoningItemId) {
        sendNotification(input.socket, 'item/completed', {
          threadId: input.threadId,
          turnId: activeTurn.id,
          item: {
            type: 'reasoning',
            id: activeTurn.reasoningItemId,
            summary: [],
            content: activeTurn.reasoningText.length > 0 ? [activeTurn.reasoningText] : [],
          },
        });
      }
      if (activeTurn.agentMessageItemId) {
        sendNotification(input.socket, 'item/completed', {
          threadId: input.threadId,
          turnId: activeTurn.id,
          item: {
            type: 'agentMessage',
            id: activeTurn.agentMessageItemId,
            text: activeTurn.agentMessageText,
            phase: null,
            memoryCitation: null,
          },
        });
      }
      sendNotification(input.socket, 'turn/completed', {
        threadId: input.threadId,
        turn: {
          id: activeTurn.id,
          items: [],
          status: 'completed',
          error: null,
          startedAt: activeTurn.startedAt,
          completedAt,
          durationMs: Math.max(0, (completedAt - activeTurn.startedAt) * 1000),
        },
      });
      sendNotification(input.socket, 'thread/status/changed', {
        threadId: input.threadId,
        status: { type: 'idle' },
      });
      activeRuntime.activeTurn = undefined;
      return;
    }

    if (eventType === 'text_delta' && typeof payload.delta === 'string') {
      const activeTurn = ensureActiveTurn();
      if (!activeTurn.agentMessageItemId) {
        activeTurn.agentMessageItemId = `${activeTurn.id}:agent-message`;
        sendNotification(input.socket, 'item/started', {
          threadId: input.threadId,
          turnId: activeTurn.id,
          item: {
            type: 'agentMessage',
            id: activeTurn.agentMessageItemId,
            text: '',
            phase: null,
            memoryCitation: null,
          },
        });
      }
      activeTurn.agentMessageText += payload.delta;
      sendNotification(input.socket, 'item/agentMessage/delta', {
        threadId: input.threadId,
        turnId: activeTurn.id,
        itemId: activeTurn.agentMessageItemId,
        delta: payload.delta,
      });
      return;
    }

    if (eventType === 'thinking_delta' && typeof payload.delta === 'string') {
      const activeTurn = ensureActiveTurn();
      if (!activeTurn.reasoningItemId) {
        activeTurn.reasoningItemId = `${activeTurn.id}:reasoning`;
        sendNotification(input.socket, 'item/started', {
          threadId: input.threadId,
          turnId: activeTurn.id,
          item: {
            type: 'reasoning',
            id: activeTurn.reasoningItemId,
            summary: [],
            content: [],
          },
        });
      }
      activeTurn.reasoningText += payload.delta;
      sendNotification(input.socket, 'item/reasoning/textDelta', {
        threadId: input.threadId,
        turnId: activeTurn.id,
        itemId: activeTurn.reasoningItemId,
        delta: payload.delta,
        contentIndex: 0,
      });
      return;
    }

    if (eventType === 'tool_start' && typeof payload.toolCallId === 'string' && typeof payload.toolName === 'string') {
      const activeTurn = ensureActiveTurn();
      sendNotification(input.socket, 'item/started', {
        threadId: input.threadId,
        turnId: activeTurn.id,
        item: {
          type: 'dynamicToolCall',
          id: payload.toolCallId,
          tool: payload.toolName,
          arguments: (payload.args as Record<string, unknown> | undefined) ?? {},
          status: 'inProgress',
          contentItems: null,
          success: null,
          durationMs: null,
        },
      });
      return;
    }

    if (eventType === 'tool_end' && typeof payload.toolCallId === 'string' && typeof payload.toolName === 'string') {
      const activeTurn = ensureActiveTurn();
      sendNotification(input.socket, 'item/completed', {
        threadId: input.threadId,
        turnId: activeTurn.id,
        item: {
          type: 'dynamicToolCall',
          id: payload.toolCallId,
          tool: payload.toolName,
          arguments: {},
          status: payload.isError === true ? 'failed' : 'completed',
          contentItems: typeof payload.output === 'string' && payload.output.length > 0
            ? [{ type: 'inputText', text: payload.output }]
            : [],
          success: payload.isError === true ? false : true,
          durationMs: typeof payload.durationMs === 'number' ? payload.durationMs : null,
        },
      });
      return;
    }

    if (eventType === 'error') {
      const activeTurn = ensureActiveTurn();
      sendNotification(input.socket, 'error', {
        error: {
          message: typeof payload.title === 'string' && payload.title.length > 0 ? payload.title : 'Live session error',
          codexErrorInfo: null,
          additionalDetails: null,
        },
        willRetry: false,
        threadId: input.threadId,
        turnId: activeTurn.id,
      });
    }
  });

  return runtime;
}

async function disposeConnection(state: ConnectionState): Promise<void> {
  await Promise.all([...state.threads.values()].map(async (thread) => {
    thread.unsubscribe?.();
    thread.unsubscribe = undefined;
  }));
}

async function handleRequest(socket: WebSocket, state: ConnectionState, request: JsonRpcRequest): Promise<void> {
  const id = toRequestId(request);
  const method = typeof request.method === 'string' ? request.method : '';
  if (!method) {
    sendError(socket, id, -32600, 'Method required.');
    return;
  }

  if (!state.initialized && method !== 'initialize') {
    sendError(socket, id, -32002, 'Not initialized.');
    return;
  }

  if (method === 'initialize') {
    if (state.initialized) {
      sendError(socket, id, -32003, 'Already initialized.');
      return;
    }

    state.initialized = true;
    sendResult(socket, id ?? 0, createInitializeResult());
    return;
  }

  if (method === 'initialized') {
    return;
  }

  try {
    if (method === 'account/read') {
      sendResult(socket, id ?? 0, { account: null, requiresOpenaiAuth: false });
      return;
    }

    if (method === 'model/list') {
      const modelState = await readDesktopModels();
      const catalog = buildModelCatalog(modelState);
      sendResult(socket, id ?? 0, {
        data: catalog.descriptors.map(({ provider: _provider, ...descriptor }) => descriptor),
        nextCursor: null,
      });
      return;
    }

    if (method === 'thread/list') {
      const params = request.params as { limit?: number; cursor?: string; cwd?: string; searchTerm?: string } | undefined;
      const sessions = await readDesktopSessions() as CompatSessionDetail['meta'][];
      const modelState = await readDesktopModels();
      const catalog = buildModelCatalog(modelState);
      const providerByModel = new Map(catalog.descriptors.map((descriptor) => [descriptor.model, descriptor.provider]));
      const cliVersion = process.env.npm_package_version || '0.1.0';
      let filtered = sessions.filter((session) => !params?.cwd || session.cwd === params.cwd);
      if (params?.searchTerm) {
        const searchTerm = params.searchTerm.trim().toLowerCase();
        filtered = filtered.filter((session) => session.title.toLowerCase().includes(searchTerm));
      }
      const offset = params?.cursor ? Number.parseInt(params.cursor, 10) || 0 : 0;
      const limit = typeof params?.limit === 'number' && params.limit > 0 ? params.limit : filtered.length;
      const page = filtered.slice(offset, offset + limit);
      sendResult(socket, id ?? 0, {
        data: page.map((session) => buildThreadSummary({
          detail: {
            meta: session,
            blocks: [],
            blockOffset: 0,
            totalBlocks: 0,
            contextUsage: null,
            signature: undefined,
          },
          modelProvider: providerByModel.get(session.model) ?? 'openai-codex',
          cliVersion,
        })),
        nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
      });
      return;
    }

    if (method === 'thread/loaded/list') {
      const sessions = await readDesktopSessions() as CompatSessionDetail['meta'][];
      sendResult(socket, id ?? 0, {
        data: sessions.filter((session) => session.isLive).map((session) => session.id),
        nextCursor: null,
      });
      return;
    }

    if (method === 'thread/read') {
      const params = request.params as { threadId?: string; includeTurns?: boolean } | undefined;
      const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : '';
      if (!threadId) {
        sendError(socket, id, -32602, 'threadId required.');
        return;
      }

      const modelState = await readDesktopModels();
      const catalog = buildModelCatalog(modelState);
      const currentProvider = catalog.descriptors.find((descriptor) => descriptor.model === modelState.currentModel)?.provider ?? 'openai-codex';
      const { thread } = await readThreadDetail({ conversationId: threadId, modelProvider: currentProvider, cliVersion: process.env.npm_package_version || '0.1.0' });
      sendResult(socket, id ?? 0, { thread: params?.includeTurns === true ? thread : { ...thread, turns: [] } });
      return;
    }

    if (method === 'thread/start') {
      const params = request.params as { cwd?: string; model?: string | null; effort?: unknown } | undefined;
      const createResult = await createDesktopLiveSession({
        ...(typeof params?.cwd === 'string' ? { cwd: params.cwd } : {}),
        ...(typeof params?.model === 'string' ? { model: params.model } : {}),
        ...(normalizeReasoningEffort(params?.effort) ? { thinkingLevel: normalizeReasoningEffort(params?.effort) } : {}),
      });
      const bootstrap = createResult.bootstrap as Awaited<ReturnType<typeof readDesktopConversationBootstrap>> | undefined;
      if (!bootstrap) {
        throw new Error('Live session bootstrap missing.');
      }
      const modelState = await readDesktopModels();
      const catalog = buildModelCatalog(modelState);
      const model = typeof params?.model === 'string' && params.model.trim().length > 0 ? params.model : modelState.currentModel || catalog.descriptors[0]?.model || '';
      const modelProvider = catalog.descriptors.find((descriptor) => descriptor.model === model)?.provider ?? 'openai-codex';
      const detail = detailFromBootstrap({ conversationId: createResult.id, bootstrap });
      const thread = buildThreadSummary({ detail, modelProvider, cliVersion: process.env.npm_package_version || '0.1.0' });
      const runtime = buildThreadRuntime({
        detail,
        model,
        modelProvider,
        reasoningEffort: normalizeReasoningEffort(params?.effort) ?? buildModelCatalog(modelState).currentThinkingLevel,
      });
      state.threads.set(thread.id, runtime);
      sendResult(socket, id ?? 0, buildThreadStartLikeResponse({ thread, runtime }));
      sendNotification(socket, 'thread/started', { thread });
      return;
    }

    if (method === 'thread/resume') {
      const params = request.params as { threadId?: string; model?: string | null; cwd?: string | null; effort?: unknown } | undefined;
      const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : '';
      if (!threadId) {
        sendError(socket, id, -32602, 'threadId required.');
        return;
      }
      const sessions = await readDesktopSessions() as CompatSessionDetail['meta'][];
      const session = sessions.find((entry) => entry.id === threadId);
      if (!session) {
        sendError(socket, id, -32004, 'Thread not found.');
        return;
      }
      await resumeDesktopLiveSession(session.file);
      const modelState = await readDesktopModels();
      const catalog = buildModelCatalog(modelState);
      const model = typeof params?.model === 'string' && params.model.trim().length > 0 ? params.model : session.model || modelState.currentModel || catalog.descriptors[0]?.model || '';
      const modelProvider = catalog.descriptors.find((descriptor) => descriptor.model === model)?.provider ?? 'openai-codex';
      const { detail, thread } = await readThreadDetail({ conversationId: threadId, modelProvider, cliVersion: process.env.npm_package_version || '0.1.0' });
      const runtime = buildThreadRuntime({
        detail,
        model,
        modelProvider,
        reasoningEffort: normalizeReasoningEffort(params?.effort) ?? buildModelCatalog(modelState).currentThinkingLevel,
      });
      state.threads.set(thread.id, runtime);
      sendResult(socket, id ?? 0, buildThreadStartLikeResponse({ thread, runtime }));
      return;
    }

    if (method === 'thread/name/set') {
      const params = request.params as { threadId?: string; name?: string } | undefined;
      const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : '';
      const name = typeof params?.name === 'string' ? params.name.trim() : '';
      if (!threadId || !name) {
        sendError(socket, id, -32602, 'threadId and name required.');
        return;
      }
      await renameDesktopConversation({ conversationId: threadId, name });
      sendResult(socket, id ?? 0, {});
      sendNotification(socket, 'thread/name/updated', { threadId, name });
      return;
    }

    if (method === 'thread/unsubscribe') {
      const params = request.params as { threadId?: string } | undefined;
      const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : '';
      const runtime = state.threads.get(threadId);
      runtime?.unsubscribe?.();
      if (runtime) {
        runtime.unsubscribe = undefined;
        runtime.activeTurn = undefined;
      }
      sendResult(socket, id ?? 0, {});
      return;
    }

    if (method === 'turn/start') {
      const params = request.params as { threadId?: string; input?: unknown } | undefined;
      const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : '';
      if (!threadId) {
        sendError(socket, id, -32602, 'threadId required.');
        return;
      }

      const runtime = await ensureThreadSubscription({ socket, state, threadId });
      const text = parseTextInput(params?.input);
      if (!text) {
        sendError(socket, id, -32602, 'text input required.');
        return;
      }

      const turnId = `${threadId}:active-turn:${String(state.nextTurnCounter++)}`;
      runtime.activeTurn = {
        id: turnId,
        startedAt: Math.floor(Date.now() / 1000),
        agentMessageText: '',
        reasoningText: '',
        sentTurnStarted: true,
      };

      const promptResult = await submitDesktopLiveSessionPrompt({
        conversationId: threadId,
        text,
        behavior: 'followUp',
      });
      if (promptResult.delivery !== 'started') {
        runtime.activeTurn = undefined;
        sendError(socket, id, -32011, 'Turn did not start immediately.');
        return;
      }

      sendResult(socket, id ?? 0, {
        turn: {
          id: turnId,
          items: [],
          status: 'inProgress',
          error: null,
          startedAt: runtime.activeTurn.startedAt,
          completedAt: null,
          durationMs: null,
        },
      });
      sendNotification(socket, 'thread/status/changed', { threadId, status: { type: 'active', activeFlags: [] } });
      sendNotification(socket, 'turn/started', {
        threadId,
        turn: {
          id: turnId,
          items: [],
          status: 'inProgress',
          error: null,
          startedAt: runtime.activeTurn.startedAt,
          completedAt: null,
          durationMs: null,
        },
      });
      return;
    }

    if (method === 'turn/steer') {
      const params = request.params as { threadId?: string; expectedTurnId?: string; input?: unknown } | undefined;
      const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : '';
      const expectedTurnId = typeof params?.expectedTurnId === 'string' ? params.expectedTurnId.trim() : '';
      const runtime = state.threads.get(threadId);
      if (!threadId || !runtime?.activeTurn || runtime.activeTurn.id !== expectedTurnId) {
        sendError(socket, id, -32012, 'Expected active turn not found.');
        return;
      }

      const text = parseTextInput(params?.input);
      if (!text) {
        sendError(socket, id, -32602, 'text input required.');
        return;
      }

      const promptResult = await submitDesktopLiveSessionPrompt({
        conversationId: threadId,
        text,
        behavior: 'steer',
      });
      if (promptResult.delivery !== 'started' && promptResult.delivery !== 'queued') {
        sendError(socket, id, -32011, 'Turn steer was not accepted.');
        return;
      }

      sendResult(socket, id ?? 0, { turnId: runtime.activeTurn.id });
      return;
    }

    sendError(socket, id, -32601, `Unsupported method: ${method}`);
  } catch (error) {
    sendError(socket, id, -32010, error instanceof Error ? error.message : String(error));
  }
}

function createHttpServerForWs(options: { pathname: string }) {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method === 'GET' && normalizePathname(requestUrl.pathname) === normalizePathname(options.pathname)) {
      response.statusCode = 426;
      response.end('Upgrade Required');
      return;
    }
    if (request.method === 'GET' && normalizePathname(requestUrl.pathname) === '/readyz') {
      response.statusCode = 200;
      response.end('ok');
      return;
    }
    if (request.method === 'GET' && normalizePathname(requestUrl.pathname) === '/healthz') {
      if (typeof request.headers.origin === 'string' && request.headers.origin.trim().length > 0) {
        response.statusCode = 403;
        response.end('forbidden');
        return;
      }
      response.statusCode = 200;
      response.end('ok');
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });

  return server;
}

export async function startCodexAppServer(input: { listenUrl: string }): Promise<CodexAppServerHandle> {
  const listenUrl = new URL(input.listenUrl);
  if (listenUrl.protocol !== 'ws:') {
    throw new Error(`Unsupported listen URL: ${input.listenUrl}`);
  }

  const httpServer = createHttpServerForWs({ pathname: listenUrl.pathname || '/' });
  const websocketServer = new WebSocketServer({ noServer: true });
  const connectionStates = new WeakMap<WebSocket, ConnectionState>();

  websocketServer.on('connection', (socket) => {
    const state: ConnectionState = {
      initialized: false,
      threads: new Map(),
      nextTurnCounter: 1,
    };
    connectionStates.set(socket, state);

    socket.on('message', (data) => {
      const parsed = parseJsonRpc(data.toString());
      if (!parsed) {
        return;
      }
      void handleRequest(socket, state, parsed);
    });

    socket.on('close', () => {
      void disposeConnection(state);
    });
  });

  httpServer.on('upgrade', (request: IncomingMessage, socket, head) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (normalizePathname(requestUrl.pathname) !== normalizePathname(listenUrl.pathname || '/')) {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    websocketServer.handleUpgrade(request, socket, head, (websocket) => {
      websocketServer.emit('connection', websocket, request);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.listen(Number.parseInt(listenUrl.port || '0', 10), listenUrl.hostname, () => resolve());
    httpServer.once('error', reject);
  });

  const address = httpServer.address() as AddressInfo | null;
  if (!address) {
    throw new Error('Could not determine codex app server address.');
  }

  const websocketUrl = `${listenUrl.protocol}//${listenUrl.hostname}:${String(address.port)}${listenUrl.pathname || '/'}`;
  return {
    websocketUrl,
    close: async () => {
      await Promise.all([...websocketServer.clients].map(async (client) => {
        client.close();
        const state = connectionStates.get(client);
        if (state) {
          await disposeConnection(state);
        }
      }));
      await new Promise<void>((resolve, reject) => {
        websocketServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
