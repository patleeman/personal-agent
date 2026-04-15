import { Buffer } from 'node:buffer';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { getStateRoot, buildCodexThreadFromSessionDetail, type CodexThread, type CodexThreadStatus, type CompatSessionDetail } from '@personal-agent/core';
import {
  abortDesktopLiveSession,
  createDesktopLiveSession,
  forkDesktopConversation,
  readDesktopConversationBootstrap,
  readDesktopModels,
  readDesktopOpenConversationTabs,
  readDesktopSessions,
  renameDesktopConversation,
  resumeDesktopLiveSession,
  rollbackDesktopConversation,
  submitDesktopLiveSessionPrompt,
  subscribeDesktopLocalApiStream,
  updateDesktopOpenConversationTabs,
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
    forcedCompletionStatus?: 'interrupted';
  };
}

interface ConnectionCommandRuntime {
  processId: string;
  child: ChildProcess;
  stdinWritable: boolean;
  supportsResize: boolean;
}

interface ConnectionState {
  initialized: boolean;
  threads: Map<string, ConnectionThreadRuntime>;
  commands: Map<string, ConnectionCommandRuntime>;
  nextTurnCounter: number;
}

export interface CodexAppServerHandle {
  websocketUrl: string;
  close(): Promise<void>;
}

const DEFAULT_COMMAND_OUTPUT_BYTES_CAP = 64 * 1024;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_KILL_GRACE_PERIOD_MS = 5_000;

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

function normalizeCommandProcessId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeCommandOutputCap(params: { outputBytesCap?: unknown; disableOutputCap?: unknown }): number | null {
  const disableOutputCap = params.disableOutputCap === true;
  const requestedCap = typeof params.outputBytesCap === 'number' && Number.isFinite(params.outputBytesCap)
    ? Math.max(0, Math.floor(params.outputBytesCap))
    : null;

  if (disableOutputCap && requestedCap !== null) {
    throw new Error('disableOutputCap cannot be combined with outputBytesCap.');
  }

  if (disableOutputCap) {
    return null;
  }

  return requestedCap ?? DEFAULT_COMMAND_OUTPUT_BYTES_CAP;
}

function normalizeCommandTimeoutMs(params: { timeoutMs?: unknown; disableTimeout?: unknown }): number | null {
  const disableTimeout = params.disableTimeout === true;
  const requestedTimeout = typeof params.timeoutMs === 'number' && Number.isFinite(params.timeoutMs)
    ? Math.max(1, Math.floor(params.timeoutMs))
    : null;

  if (disableTimeout && requestedTimeout !== null) {
    throw new Error('disableTimeout cannot be combined with timeoutMs.');
  }

  if (disableTimeout) {
    return null;
  }

  return requestedTimeout ?? DEFAULT_COMMAND_TIMEOUT_MS;
}

function buildCommandEnvironment(overrides: unknown): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    return env;
  }

  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    if (typeof value === 'string') {
      env[key] = value;
      continue;
    }

    if (value === null) {
      delete env[key];
    }
  }

  return env;
}

function appendCapturedText(current: string, chunk: Buffer, capturedBytes: { value: number }, cap: number | null): { next: string; capReached: boolean; capturedChunk: Buffer } {
  if (cap === null) {
    return {
      next: current + chunk.toString('utf-8'),
      capReached: false,
      capturedChunk: chunk,
    };
  }

  const remaining = Math.max(0, cap - capturedBytes.value);
  const capturedChunk = remaining > 0 ? chunk.subarray(0, Math.min(remaining, chunk.length)) : Buffer.alloc(0);
  capturedBytes.value += capturedChunk.length;

  return {
    next: capturedChunk.length > 0 ? current + capturedChunk.toString('utf-8') : current,
    capReached: capturedChunk.length < chunk.length || (remaining === 0 && chunk.length > 0),
    capturedChunk,
  };
}

function sendCommandOutputDelta(input: {
  socket: WebSocket;
  processId: string;
  stream: 'stdout' | 'stderr';
  chunk: Buffer;
  capReached: boolean;
}): void {
  if (input.chunk.length === 0 && !input.capReached) {
    return;
  }

  sendNotification(input.socket, 'command/exec/outputDelta', {
    processId: input.processId,
    stream: input.stream,
    deltaBase64: input.chunk.toString('base64'),
    capReached: input.capReached,
  });
}

async function writeToCommandStdin(runtime: ConnectionCommandRuntime, chunk: Buffer, closeStdin: boolean): Promise<void> {
  if (!runtime.stdinWritable || !runtime.child.stdin) {
    throw new Error('stdin streaming is not enabled for this command/exec.');
  }

  if (chunk.length > 0) {
    await new Promise<void>((resolve, reject) => {
      runtime.child.stdin?.write(chunk, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  if (closeStdin) {
    runtime.child.stdin.end();
    runtime.stdinWritable = false;
  }
}

function terminateCommand(runtime: ConnectionCommandRuntime): void {
  runtime.child.kill('SIGTERM');
}

function disposeCommand(runtime: ConnectionCommandRuntime): void {
  if (runtime.child.exitCode === null && !runtime.child.killed) {
    runtime.child.kill('SIGTERM');
  }
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

async function readArchivedThreadIdSet(): Promise<Set<string>> {
  const tabs = await readDesktopOpenConversationTabs();
  return new Set(tabs.archivedSessionIds);
}

async function archiveThreadId(threadId: string): Promise<void> {
  const tabs = await readDesktopOpenConversationTabs();
  await updateDesktopOpenConversationTabs({
    sessionIds: tabs.sessionIds.filter((id) => id !== threadId),
    pinnedSessionIds: tabs.pinnedSessionIds.filter((id) => id !== threadId),
    archivedSessionIds: tabs.archivedSessionIds.includes(threadId)
      ? tabs.archivedSessionIds
      : [...tabs.archivedSessionIds, threadId],
  });
}

async function unarchiveThreadId(threadId: string): Promise<void> {
  const tabs = await readDesktopOpenConversationTabs();
  if (!tabs.archivedSessionIds.includes(threadId)) {
    return;
  }

  await updateDesktopOpenConversationTabs({
    archivedSessionIds: tabs.archivedSessionIds.filter((id) => id !== threadId),
  });
}

function completeActiveTurn(input: {
  socket: WebSocket;
  threadId: string;
  runtime: ConnectionThreadRuntime;
  status: 'completed' | 'interrupted';
}): void {
  const activeTurn = input.runtime.activeTurn;
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
      status: input.status,
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
  input.runtime.activeTurn = undefined;
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

      completeActiveTurn({
        socket: input.socket,
        threadId: input.threadId,
        runtime: activeRuntime,
        status: activeTurn.forcedCompletionStatus ?? 'completed',
      });
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

async function runCommandExec(input: {
  socket: WebSocket;
  state: ConnectionState;
  processId: string;
  command: string[];
  cwd?: string;
  env?: unknown;
  streamStdin: boolean;
  streamStdoutStderr: boolean;
  outputBytesCap: number | null;
  timeoutMs: number | null;
}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const [program, ...args] = input.command;
  if (!program || program.trim().length === 0) {
    throw new Error('command must not be empty.');
  }

  if (input.processId && input.state.commands.has(input.processId)) {
    throw new Error(`duplicate active command/exec process id: ${input.processId}`);
  }

  const child = spawn(program, args, {
    cwd: typeof input.cwd === 'string' && input.cwd.trim().length > 0 ? input.cwd.trim() : process.cwd(),
    env: buildCommandEnvironment(input.env),
    stdio: [input.streamStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

  const runtime: ConnectionCommandRuntime | null = input.processId
    ? {
        processId: input.processId,
        child,
        stdinWritable: input.streamStdin,
        supportsResize: false,
      }
    : null;

  if (runtime) {
    input.state.commands.set(runtime.processId, runtime);
  }

  const stdoutBytes = { value: 0 };
  const stderrBytes = { value: 0 };
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let killTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    if (killTimer) {
      clearTimeout(killTimer);
      killTimer = null;
    }
    if (runtime) {
      input.state.commands.delete(runtime.processId);
    }
  };

  if (input.timeoutMs !== null) {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (child.exitCode === null && !child.killed) {
          child.kill('SIGKILL');
        }
      }, COMMAND_KILL_GRACE_PERIOD_MS);
    }, input.timeoutMs);
  }

  child.stdout?.on('data', (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const captured = appendCapturedText(stdout, buffer, stdoutBytes, input.outputBytesCap);
    stdout = captured.next;
    if (input.streamStdoutStderr && input.processId) {
      sendCommandOutputDelta({
        socket: input.socket,
        processId: input.processId,
        stream: 'stdout',
        chunk: captured.capturedChunk,
        capReached: captured.capReached,
      });
    }
  });

  child.stderr?.on('data', (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const captured = appendCapturedText(stderr, buffer, stderrBytes, input.outputBytesCap);
    stderr = captured.next;
    if (input.streamStdoutStderr && input.processId) {
      sendCommandOutputDelta({
        socket: input.socket,
        processId: input.processId,
        stream: 'stderr',
        chunk: captured.capturedChunk,
        capReached: captured.capReached,
      });
    }
  });

  return await new Promise<{ exitCode: number; stdout: string; stderr: string }>((resolve, reject) => {
    child.once('error', (error) => {
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    });

    child.once('close', (code, signal) => {
      cleanup();
      resolve({
        exitCode: timedOut ? 124 : (typeof code === 'number' ? code : (signal ? 1 : 0)),
        stdout: input.streamStdoutStderr ? '' : stdout,
        stderr: input.streamStdoutStderr ? '' : stderr,
      });
    });
  });
}

async function disposeConnection(state: ConnectionState): Promise<void> {
  await Promise.all([...state.threads.values()].map(async (thread) => {
    thread.unsubscribe?.();
    thread.unsubscribe = undefined;
  }));

  for (const runtime of state.commands.values()) {
    disposeCommand(runtime);
  }
  state.commands.clear();
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
      const params = request.params as { limit?: number; cursor?: string; cwd?: string; searchTerm?: string; archived?: boolean } | undefined;
      const [sessions, modelState, archivedThreadIds] = await Promise.all([
        readDesktopSessions() as Promise<CompatSessionDetail['meta'][]>,
        readDesktopModels(),
        readArchivedThreadIdSet(),
      ]);
      const catalog = buildModelCatalog(modelState);
      const providerByModel = new Map(catalog.descriptors.map((descriptor) => [descriptor.model, descriptor.provider]));
      const cliVersion = process.env.npm_package_version || '0.1.0';
      let filtered = sessions.filter((session) => !params?.cwd || session.cwd === params.cwd);
      if (params?.archived === true) {
        filtered = filtered.filter((session) => archivedThreadIds.has(session.id));
      } else if (params?.archived === false) {
        filtered = filtered.filter((session) => !archivedThreadIds.has(session.id));
      }
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
      await unarchiveThreadId(threadId);
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

    if (method === 'thread/fork') {
      const params = request.params as { threadId?: string; cwd?: string | null; model?: string | null } | undefined;
      const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : '';
      if (!threadId) {
        sendError(socket, id, -32602, 'threadId required.');
        return;
      }

      const forkResult = await forkDesktopConversation({
        conversationId: threadId,
        ...(typeof params?.cwd === 'string' ? { cwd: params.cwd } : {}),
        ...(typeof params?.model === 'string' ? { model: params.model } : {}),
      });
      const modelState = await readDesktopModels();
      const catalog = buildModelCatalog(modelState);
      const requestedModel = typeof params?.model === 'string' && params.model.trim().length > 0 ? params.model : null;
      const initialModel = requestedModel ?? (modelState.currentModel || catalog.descriptors[0]?.model || '');
      const initialProvider = catalog.descriptors.find((descriptor) => descriptor.model === initialModel)?.provider ?? 'openai-codex';
      const { detail, thread } = await readThreadDetail({
        conversationId: forkResult.id,
        modelProvider: initialProvider,
        cliVersion: process.env.npm_package_version || '0.1.0',
      });
      const model = detail.meta.model || initialModel;
      const modelProvider = catalog.descriptors.find((descriptor) => descriptor.model === model)?.provider ?? initialProvider;
      const runtime = buildThreadRuntime({
        detail,
        model,
        modelProvider,
        reasoningEffort: buildModelCatalog(modelState).currentThinkingLevel,
      });
      state.threads.set(thread.id, runtime);
      sendResult(socket, id ?? 0, buildThreadStartLikeResponse({ thread, runtime }));
      sendNotification(socket, 'thread/started', { thread });
      return;
    }

    if (method === 'thread/rollback') {
      const params = request.params as { threadId?: string; numTurns?: number } | undefined;
      const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : '';
      const numTurns = typeof params?.numTurns === 'number' && Number.isInteger(params.numTurns)
        ? params.numTurns
        : null;
      if (!threadId || !numTurns || numTurns <= 0) {
        sendError(socket, id, -32602, 'threadId and positive numTurns required.');
        return;
      }

      await unarchiveThreadId(threadId);
      const runtime = state.threads.get(threadId);
      runtime?.unsubscribe?.();
      if (runtime) {
        runtime.unsubscribe = undefined;
        runtime.activeTurn = undefined;
      }

      const rollbackResult = await rollbackDesktopConversation({ conversationId: threadId, numTurns });
      const modelState = await readDesktopModels();
      const catalog = buildModelCatalog(modelState);
      const currentProvider = catalog.descriptors.find((descriptor) => descriptor.model === modelState.currentModel)?.provider ?? 'openai-codex';
      const { detail, thread } = await readThreadDetail({
        conversationId: rollbackResult.id,
        modelProvider: currentProvider,
        cliVersion: process.env.npm_package_version || '0.1.0',
      });
      if (runtime) {
        state.threads.set(thread.id, buildThreadRuntime({
          detail,
          model: runtime.model,
          modelProvider: runtime.modelProvider,
          reasoningEffort: runtime.reasoningEffort,
        }));
      }
      sendResult(socket, id ?? 0, { thread });
      return;
    }

    if (method === 'thread/archive') {
      const params = request.params as { threadId?: string } | undefined;
      const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : '';
      if (!threadId) {
        sendError(socket, id, -32602, 'threadId required.');
        return;
      }

      const sessions = await readDesktopSessions() as CompatSessionDetail['meta'][];
      if (!sessions.some((session) => session.id === threadId)) {
        sendError(socket, id, -32004, 'Thread not found.');
        return;
      }

      await archiveThreadId(threadId);
      sendResult(socket, id ?? 0, {});
      sendNotification(socket, 'thread/archived', { threadId });
      return;
    }

    if (method === 'thread/name/set' || method === 'thread/setName') {
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

      await unarchiveThreadId(threadId);
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

      await unarchiveThreadId(threadId);
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

    if (method === 'turn/interrupt') {
      const params = request.params as { threadId?: string; turnId?: string } | undefined;
      const threadId = typeof params?.threadId === 'string' ? params.threadId.trim() : '';
      const turnId = typeof params?.turnId === 'string' ? params.turnId.trim() : '';
      const runtime = state.threads.get(threadId);
      if (!threadId || !turnId || !runtime?.activeTurn || runtime.activeTurn.id !== turnId) {
        sendError(socket, id, -32012, 'Expected active turn not found.');
        return;
      }

      runtime.activeTurn.forcedCompletionStatus = 'interrupted';
      try {
        await abortDesktopLiveSession(threadId);
      } catch (error) {
        if (runtime.activeTurn?.id === turnId) {
          delete runtime.activeTurn.forcedCompletionStatus;
        }
        throw error;
      }

      if (runtime.activeTurn?.id === turnId) {
        completeActiveTurn({
          socket,
          threadId,
          runtime,
          status: 'interrupted',
        });
      }

      sendResult(socket, id ?? 0, {});
      return;
    }

    if (method === 'command/exec') {
      const params = request.params as {
        command?: unknown;
        processId?: unknown;
        tty?: unknown;
        streamStdin?: unknown;
        streamStdoutStderr?: unknown;
        outputBytesCap?: unknown;
        disableOutputCap?: unknown;
        disableTimeout?: unknown;
        timeoutMs?: unknown;
        cwd?: unknown;
        env?: unknown;
        size?: unknown;
      } | undefined;
      const command = Array.isArray(params?.command)
        ? params.command.filter((entry): entry is string => typeof entry === 'string')
        : [];
      const processId = normalizeCommandProcessId(params?.processId);
      const tty = params?.tty === true;
      const streamStdin = tty || params?.streamStdin === true;
      const streamStdoutStderr = tty || params?.streamStdoutStderr === true;
      if (command.length === 0) {
        sendError(socket, id, -32602, 'command must not be empty.');
        return;
      }
      if (tty) {
        sendError(socket, id, -32602, 'PTY command/exec is not supported by personal-agent yet.');
        return;
      }
      if (params?.size && !tty) {
        sendError(socket, id, -32602, 'command/exec size is only valid when tty is enabled.');
        return;
      }
      if ((streamStdin || streamStdoutStderr) && !processId) {
        sendError(socket, id, -32602, 'command/exec streaming requires processId.');
        return;
      }

      const result = await runCommandExec({
        socket,
        state,
        processId,
        command,
        cwd: typeof params?.cwd === 'string' ? params.cwd : undefined,
        env: params?.env,
        streamStdin,
        streamStdoutStderr,
        outputBytesCap: normalizeCommandOutputCap({
          outputBytesCap: params?.outputBytesCap,
          disableOutputCap: params?.disableOutputCap,
        }),
        timeoutMs: normalizeCommandTimeoutMs({
          timeoutMs: params?.timeoutMs,
          disableTimeout: params?.disableTimeout,
        }),
      });
      sendResult(socket, id ?? 0, {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      return;
    }

    if (method === 'command/exec/write') {
      const params = request.params as { processId?: unknown; deltaBase64?: unknown; closeStdin?: unknown } | undefined;
      const processId = normalizeCommandProcessId(params?.processId);
      if (!processId) {
        sendError(socket, id, -32602, 'processId required.');
        return;
      }
      const runtime = state.commands.get(processId);
      if (!runtime) {
        sendError(socket, id, -32013, 'No active command/exec process found.');
        return;
      }
      const closeStdin = params?.closeStdin === true;
      const deltaBase64 = typeof params?.deltaBase64 === 'string' ? params.deltaBase64 : null;
      if (!closeStdin && !deltaBase64) {
        sendError(socket, id, -32602, 'command/exec/write requires deltaBase64 or closeStdin.');
        return;
      }
      let decoded = Buffer.alloc(0);
      if (deltaBase64) {
        try {
          decoded = Buffer.from(deltaBase64, 'base64');
        } catch {
          sendError(socket, id, -32602, 'deltaBase64 must be valid base64.');
          return;
        }
      }
      await writeToCommandStdin(runtime, decoded, closeStdin);
      sendResult(socket, id ?? 0, {});
      return;
    }

    if (method === 'command/exec/terminate') {
      const params = request.params as { processId?: unknown } | undefined;
      const processId = normalizeCommandProcessId(params?.processId);
      if (!processId) {
        sendError(socket, id, -32602, 'processId required.');
        return;
      }
      const runtime = state.commands.get(processId);
      if (!runtime) {
        sendError(socket, id, -32013, 'No active command/exec process found.');
        return;
      }
      terminateCommand(runtime);
      sendResult(socket, id ?? 0, {});
      return;
    }

    if (method === 'command/exec/resize') {
      const params = request.params as { processId?: unknown } | undefined;
      const processId = normalizeCommandProcessId(params?.processId);
      if (!processId) {
        sendError(socket, id, -32602, 'processId required.');
        return;
      }
      const runtime = state.commands.get(processId);
      if (!runtime) {
        sendError(socket, id, -32013, 'No active command/exec process found.');
        return;
      }
      if (!runtime.supportsResize) {
        sendError(socket, id, -32602, 'PTY resize is not supported for this command/exec session.');
        return;
      }
      sendResult(socket, id ?? 0, {});
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
      commands: new Map(),
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
