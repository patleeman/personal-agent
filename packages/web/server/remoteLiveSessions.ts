import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import { getExecutionTarget, type ExecutionTargetRecord } from '@personal-agent/core';
import { readSessionBlocksByFile, type SessionDetail } from './sessions.js';
import { ensureSessionFileExists, patchSessionManagerPersistence, resolvePersistentSessionDir } from './liveSessions.js';
import {
  deleteRemoteConversationBinding,
  getRemoteConversationBinding,
  setRemoteConversationBinding,
  type RemoteConversationBinding,
} from './remoteConversationBindings.js';

const LOCAL_PA_CLI_PATH = join(process.cwd(), 'packages', 'cli', 'dist', 'index.js');
const REMOTE_BOOTSTRAP_FILE = 'bootstrap-session.jsonl';
const REMOTE_IDLE_STOP_DELAY_MS = 60_000;
const REMOTE_MIRROR_SYNC_TTL_MS = 5_000;

interface QueuedPromptPreview {
  id: string;
  text: string;
  imageCount: number;
  restorable?: boolean;
}

type SseEvent =
  | { type: 'snapshot'; blocks: SessionDetail['blocks']; blockOffset: number; totalBlocks: number }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'user_message'; block: Extract<SessionDetail['blocks'][number], { type: 'user' }> }
  | { type: 'queue_state'; steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] }
  | { type: 'text_delta'; delta: string }
  | { type: 'thinking_delta'; delta: string }
  | { type: 'tool_start'; toolCallId: string; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_update'; toolCallId: string; partialResult: unknown }
  | { type: 'tool_end'; toolCallId: string; toolName: string; isError: boolean; durationMs: number; output: string; details?: unknown }
  | { type: 'error'; message: string };

type LiveListener = (event: SseEvent) => void;

interface RpcResponse {
  id?: string;
  type?: string;
  success?: boolean;
  data?: unknown;
  error?: string;
}

interface RpcState {
  sessionFile?: string;
  isStreaming?: boolean;
  sessionName?: string;
  pendingMessageCount?: number;
}

interface RemoteRpcClient {
  child: ChildProcessWithoutNullStreams;
  start(): Promise<void>;
  stop(): Promise<void>;
  getState(): Promise<RpcState>;
  prompt(message: string, images?: Array<{ type: 'image'; data: string; mimeType: string; name?: string }>): Promise<void>;
  steer(message: string, images?: Array<{ type: 'image'; data: string; mimeType: string; name?: string }>): Promise<void>;
  followUp(message: string, images?: Array<{ type: 'image'; data: string; mimeType: string; name?: string }>): Promise<void>;
  abort(): Promise<void>;
  onEvent(listener: (event: Record<string, unknown>) => void): () => void;
  onExit(listener: (error: string | null) => void): () => void;
}

interface RemoteLiveEntry {
  conversationId: string;
  profile: string;
  target: ExecutionTargetRecord;
  remoteCwd: string;
  localSessionFile: string;
  remoteSessionFile?: string;
  rpc: RemoteRpcClient;
  listeners: Set<LiveListener>;
  title?: string;
  isStreaming: boolean;
  pendingMessageCount: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export interface RemoteConversationMirrorSyncTelemetry {
  status: 'synced-live' | 'synced-binding' | 'skipped-fresh' | 'not-remote';
  durationMs: number;
}

export interface RemoteFolderEntry {
  name: string;
  path: string;
}

export interface RemoteFolderListing {
  cwd: string;
  parent: string | null;
  entries: RemoteFolderEntry[];
}

export interface RemoteConversationConnectionState {
  conversationId: string;
  targetId: string | null;
  connected: boolean;
  state: 'local' | 'idle' | 'installing' | 'connecting' | 'connected' | 'error';
  message: string | null;
  updatedAt: string | null;
}

export const remoteRegistry = new Map<string, RemoteLiveEntry>();
const remoteConnectionStates = new Map<string, RemoteConversationConnectionState>();
const remoteConnectionListeners = new Map<string, Set<() => void>>();
const remoteMirrorLastSyncedAt = new Map<string, number>();

function quoteShellArg(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function notifyRemoteConversationConnectionChanged(conversationId: string): void {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    return;
  }

  const listeners = remoteConnectionListeners.get(normalizedConversationId);
  if (!listeners) {
    return;
  }

  for (const listener of [...listeners]) {
    listener();
  }
}

export function subscribeRemoteConversationConnection(conversationId: string, listener: () => void): () => void {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    return () => {};
  }

  const listeners = remoteConnectionListeners.get(normalizedConversationId) ?? new Set<() => void>();
  listeners.add(listener);
  remoteConnectionListeners.set(normalizedConversationId, listeners);

  return () => {
    const currentListeners = remoteConnectionListeners.get(normalizedConversationId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      remoteConnectionListeners.delete(normalizedConversationId);
    }
  };
}

function setRemoteConnectionState(state: RemoteConversationConnectionState): RemoteConversationConnectionState {
  remoteConnectionStates.set(state.conversationId, state);
  notifyRemoteConversationConnectionChanged(state.conversationId);
  return state;
}

function readRequiredString(value: unknown, label: string): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw new Error(`${label} is required.`);
  }

  return normalized;
}

function buildUserMessage(text: string) {
  return {
    role: 'user' as const,
    content: [{ type: 'text' as const, text }],
    timestamp: Date.now(),
  };
}

function readConversationIdFromSessionFile(sessionFile: string): string {
  const manager = SessionManager.open(sessionFile);
  return manager.getSessionId();
}

function appendLocalUserMessage(sessionFile: string, text: string): void {
  const normalized = text.trim();
  if (!normalized) {
    return;
  }

  const manager = SessionManager.open(sessionFile);
  patchSessionManagerPersistence(manager);
  manager.appendMessage(buildUserMessage(normalized));
  ensureSessionFileExists(manager);
}

function rewriteLocalSessionHeader(sessionFile: string, conversationId: string, cwd: string): void {
  if (!existsSync(sessionFile)) {
    return;
  }

  const lines = readFileSync(sessionFile, 'utf-8').split('\n').filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return;
  }

  let sawSession = false;
  const rewritten = lines.flatMap((line) => {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.type === 'session') {
      if (sawSession) {
        return [];
      }

      sawSession = true;
      return [JSON.stringify({ ...parsed, id: conversationId, cwd })];
    }

    return [JSON.stringify(parsed)];
  });

  writeFileSync(sessionFile, `${rewritten.join('\n')}\n`);
}

function rewriteLocalMirrorFromRemote(options: {
  localSessionFile: string;
  conversationId: string;
  remoteCwd: string;
  remoteContent: string;
}): void {
  const lines = options.remoteContent
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return;
  }

  let sawSession = false;
  const rewritten = lines.flatMap((line) => {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    if (parsed.type === 'session') {
      if (sawSession) {
        return [];
      }

      sawSession = true;
      return [JSON.stringify({ ...parsed, id: options.conversationId, cwd: options.remoteCwd })];
    }

    return [JSON.stringify(parsed)];
  });

  writeFileSync(options.localSessionFile, `${rewritten.join('\n')}\n`);
}

async function runProcess(command: string, args: string[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
} = {}): Promise<{ stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error((stderr || stdout || `Command exited with code ${code}`).trim()));
      }
    });

    if (options.input) {
      child.stdin.write(options.input);
    }
    child.stdin.end();
  });
}

function sshArgs(target: ExecutionTargetRecord, remoteCommand: string): string[] {
  return [target.sshDestination, `bash -lc ${quoteShellArg(remoteCommand)}`];
}

async function runSsh(target: ExecutionTargetRecord, remoteCommand: string, input?: string): Promise<{ stdout: string; stderr: string }> {
  return await runProcess(target.sshCommand || 'ssh', sshArgs(target, remoteCommand), { input });
}

async function runRemoteNodeScript(target: ExecutionTargetRecord, script: string, env: Record<string, string>): Promise<string> {
  const commandPrefix = target.commandPrefix ? `${target.commandPrefix} && ` : '';
  const envAssignments = Object.entries(env)
    .map(([key, value]) => `${key}=${quoteShellArg(value)}`)
    .join(' ');
  const command = [
    'set -euo pipefail',
    `${commandPrefix}${envAssignments} exec node`.trim(),
  ].join(' && ');
  const result = await runSsh(target, command, script);
  return result.stdout;
}

async function uploadFile(target: ExecutionTargetRecord, localPath: string, remotePath: string): Promise<void> {
  const child = spawn(target.sshCommand || 'ssh', sshArgs(target, `mkdir -p ${quoteShellArg(dirname(remotePath))} && cat > ${quoteShellArg(remotePath)}`), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  await new Promise<void>((resolve, reject) => {
    child.stdout.resume();
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error((stderr || `Upload exited with code ${code}`).trim()));
      }
    });

    child.stdin.on('error', reject);
    child.stdin.end(readFileSync(localPath));
  });
}

async function downloadRemoteFile(target: ExecutionTargetRecord, remotePath: string): Promise<string> {
  const result = await runSsh(target, `cat ${quoteShellArg(remotePath)}`);
  return result.stdout;
}

async function ensureRemoteTargetInstalled(target: ExecutionTargetRecord): Promise<{ launcherPath?: string } | null> {
  if (target.remotePaCommand) {
    return null;
  }

  if (!existsSync(LOCAL_PA_CLI_PATH)) {
    throw new Error(`Local pa CLI not found: ${LOCAL_PA_CLI_PATH}`);
  }

  const result = await runProcess(process.execPath, [LOCAL_PA_CLI_PATH, '--plain', 'targets', 'install', target.id, '--json'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NO_COLOR: '1',
      PERSONAL_AGENT_PLAIN_OUTPUT: '1',
    },
  });

  return JSON.parse(result.stdout) as { launcherPath?: string };
}

function buildRemoteRpcCommand(options: {
  target: ExecutionTargetRecord;
  remotePaCommand: string;
  remoteCwd: string;
  remoteSessionFile?: string;
  remoteBootstrapFile?: string;
}): string {
  const profileArg = options.target.profile ? ` --profile ${quoteShellArg(options.target.profile)}` : '';
  const commandPrefix = options.target.commandPrefix ? `${options.target.commandPrefix} && ` : '';
  const rpcArgs = [
    '--mode', 'rpc',
    ...(options.remoteSessionFile ? ['--session', options.remoteSessionFile] : []),
    ...(options.remoteBootstrapFile ? ['--fork', options.remoteBootstrapFile] : []),
  ].map((value) => quoteShellArg(value)).join(' ');

  return [
    'set -euo pipefail',
    `cd ${quoteShellArg(options.remoteCwd)}`,
    `${commandPrefix}exec ${options.remotePaCommand} tui${profileArg} -- ${rpcArgs}`,
  ].join(' && ');
}

function createSshRpcClient(options: {
  target: ExecutionTargetRecord;
  remotePaCommand: string;
  remoteCwd: string;
  remoteSessionFile?: string;
  remoteBootstrapFile?: string;
}): RemoteRpcClient {
  const eventListeners = new Set<(event: Record<string, unknown>) => void>();
  const exitListeners = new Set<(error: string | null) => void>();
  const pending = new Map<string, { resolve: (value: RpcResponse) => void; reject: (error: Error) => void }>();
  const command = buildRemoteRpcCommand(options);
  const child = spawn(options.target.sshCommand || 'ssh', sshArgs(options.target, command), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let requestId = 0;
  let stdoutBuffer = '';
  let stderr = '';
  let started = false;

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk;
    while (true) {
      const newlineIndex = stdoutBuffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }

      const line = stdoutBuffer.slice(0, newlineIndex).replace(/\r$/, '');
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (!line.trim()) {
        continue;
      }

      let parsed: RpcResponse | Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as RpcResponse | Record<string, unknown>;
      } catch {
        continue;
      }

      if ((parsed as RpcResponse).type === 'response' && typeof (parsed as RpcResponse).id === 'string') {
        const response = parsed as RpcResponse;
        const responseId = response.id as string;
        const deferred = pending.get(responseId);
        if (!deferred) {
          continue;
        }

        pending.delete(responseId);
        if (response.success === false) {
          deferred.reject(new Error(response.error?.trim() || 'Remote RPC command failed.'));
        } else {
          deferred.resolve(response);
        }
        continue;
      }

      for (const listener of eventListeners) {
        listener(parsed as Record<string, unknown>);
      }
    }
  });

  child.on('close', (code, signal) => {
    const message = code === 0
      ? null
      : (stderr.trim() || `Remote RPC process exited with code ${code ?? 'null'} signal ${signal ?? 'none'}.`);
    for (const deferred of pending.values()) {
      deferred.reject(new Error(message ?? 'Remote RPC process exited.'));
    }
    pending.clear();
    for (const listener of exitListeners) {
      listener(message);
    }
  });

  async function send(commandObject: Record<string, unknown>): Promise<RpcResponse> {
    const id = `req-${++requestId}`;
    const payload = `${JSON.stringify({ ...commandObject, id })}\n`;
    return await new Promise<RpcResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(payload, (error) => {
        if (error) {
          pending.delete(id);
          reject(error);
        }
      });
    });
  }

  return {
    child,
    async start() {
      if (started) {
        return;
      }

      started = true;
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (child.exitCode !== null) {
        throw new Error(`Remote RPC process exited immediately with code ${child.exitCode}. ${stderr.trim()}`.trim());
      }
    },
    async stop() {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 250));
      if (child.exitCode === null) {
        child.kill('SIGKILL');
      }
    },
    async getState() {
      const response = await send({ type: 'get_state' });
      return (response.data ?? {}) as RpcState;
    },
    async prompt(message, images) {
      await send({ type: 'prompt', message, images });
    },
    async steer(message, images) {
      await send({ type: 'steer', message, images });
    },
    async followUp(message, images) {
      await send({ type: 'follow_up', message, images });
    },
    async abort() {
      await send({ type: 'abort' });
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onExit(listener) {
      exitListeners.add(listener);
      return () => exitListeners.delete(listener);
    },
  };
}

function buildSnapshot(sessionFile: string, tailBlocks?: number): SseEvent {
  const detail = readSessionBlocksByFile(sessionFile, tailBlocks ? { tailBlocks } : undefined);
  return {
    type: 'snapshot',
    blocks: detail?.blocks ?? [],
    blockOffset: detail?.blockOffset ?? 0,
    totalBlocks: detail?.totalBlocks ?? 0,
  };
}

function buildRemoteQueueState(entry: Pick<RemoteLiveEntry, 'pendingMessageCount'>): Extract<SseEvent, { type: 'queue_state' }> {
  if (entry.pendingMessageCount <= 0) {
    return { type: 'queue_state', steering: [], followUp: [] };
  }

  const label = entry.pendingMessageCount === 1
    ? '1 queued remote prompt'
    : `${entry.pendingMessageCount} queued remote prompts`;

  return {
    type: 'queue_state',
    steering: [],
    followUp: [{
      id: 'remote-pending',
      text: label,
      imageCount: 0,
      restorable: false,
    }],
  };
}

function emit(entry: RemoteLiveEntry, event: SseEvent): void {
  for (const listener of entry.listeners) {
    listener(event);
  }
}

async function refreshRemoteQueueState(entry: RemoteLiveEntry, options: { emitUpdate?: boolean } = {}): Promise<void> {
  const state = await entry.rpc.getState();
  entry.pendingMessageCount = Number.isInteger(state.pendingMessageCount) && Number(state.pendingMessageCount) > 0
    ? Number(state.pendingMessageCount)
    : 0;
  if (options.emitUpdate) {
    emit(entry, buildRemoteQueueState(entry));
  }
}

function summarizeToolResult(result: unknown): { output: string; details?: unknown } {
  const record = result && typeof result === 'object' && !Array.isArray(result)
    ? result as { content?: Array<{ type?: string; text?: string }>; details?: unknown }
    : {};
  const output = Array.isArray(record.content)
    ? record.content
      .filter((item) => item && typeof item === 'object' && (item as { type?: string }).type === 'text')
      .map((item) => (item as { text?: string }).text ?? '')
      .join('')
    : '';
  return {
    output,
    ...(record.details !== undefined ? { details: record.details } : {}),
  };
}

export function shouldSkipRemoteConversationMirrorSync(options: {
  conversationId: string;
  localSessionFile: string;
  force?: boolean;
  now?: number;
}): boolean {
  if (options.force) {
    return false;
  }

  if (!existsSync(options.localSessionFile)) {
    return false;
  }

  const lastSyncedAt = remoteMirrorLastSyncedAt.get(options.conversationId);
  if (typeof lastSyncedAt !== 'number') {
    return false;
  }

  return ((options.now ?? Date.now()) - lastSyncedAt) < REMOTE_MIRROR_SYNC_TTL_MS;
}

async function syncMirrorFromRemote(entry: RemoteLiveEntry): Promise<void> {
  if (!entry.remoteSessionFile) {
    return;
  }

  const remoteContent = await downloadRemoteFile(entry.target, entry.remoteSessionFile);
  rewriteLocalMirrorFromRemote({
    localSessionFile: entry.localSessionFile,
    conversationId: entry.conversationId,
    remoteCwd: entry.remoteCwd,
    remoteContent,
  });

  const detail = readSessionBlocksByFile(entry.localSessionFile);
  entry.title = detail?.meta.title;
  remoteMirrorLastSyncedAt.set(entry.conversationId, Date.now());
}

export async function syncRemoteConversationMirror(options: { profile: string; conversationId: string; force?: boolean }): Promise<RemoteConversationMirrorSyncTelemetry> {
  const startedAt = process.hrtime.bigint();
  const liveEntry = remoteRegistry.get(options.conversationId);
  if (liveEntry) {
    if (shouldSkipRemoteConversationMirrorSync({
      conversationId: options.conversationId,
      localSessionFile: liveEntry.localSessionFile,
      force: options.force,
    })) {
      return {
        status: 'skipped-fresh',
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      };
    }

    await syncMirrorFromRemote(liveEntry);
    return {
      status: 'synced-live',
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    };
  }

  const binding = getRemoteConversationBinding(options);
  if (!binding?.remoteSessionFile) {
    return {
      status: 'not-remote',
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    };
  }

  if (shouldSkipRemoteConversationMirrorSync({
    conversationId: options.conversationId,
    localSessionFile: binding.localSessionFile,
    force: options.force,
  })) {
    return {
      status: 'skipped-fresh',
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
    };
  }

  const target = getExecutionTarget({ targetId: binding.targetId });
  if (!target) {
    throw new Error(`Execution target ${binding.targetId} not found.`);
  }

  const remoteContent = await downloadRemoteFile(target, binding.remoteSessionFile);
  rewriteLocalMirrorFromRemote({
    localSessionFile: binding.localSessionFile,
    conversationId: binding.conversationId,
    remoteCwd: binding.remoteCwd,
    remoteContent,
  });
  remoteMirrorLastSyncedAt.set(binding.conversationId, Date.now());
  return {
    status: 'synced-binding',
    durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
  };
}

function scheduleIdleStop(entry: RemoteLiveEntry): void {
  if (entry.listeners.size > 0 || entry.isStreaming) {
    return;
  }

  clearTimeout(entry.idleTimer);
  entry.idleTimer = setTimeout(() => {
    void stopRemoteLiveSession(entry.conversationId);
  }, REMOTE_IDLE_STOP_DELAY_MS);
}

function attachRpcEventForwarding(entry: RemoteLiveEntry): void {
  entry.rpc.onEvent((event) => {
    const type = typeof event.type === 'string' ? event.type : '';
    if (type === 'agent_start') {
      entry.isStreaming = true;
      emit(entry, { type: 'agent_start' });
      void refreshRemoteQueueState(entry, { emitUpdate: true }).catch(() => undefined);
      return;
    }

    if (type === 'agent_end') {
      entry.isStreaming = false;
      void syncMirrorFromRemote(entry)
        .then(async () => {
          await refreshRemoteQueueState(entry, { emitUpdate: true });
          emit(entry, buildSnapshot(entry.localSessionFile));
          emit(entry, { type: 'turn_end' });
          emit(entry, { type: 'agent_end' });
          scheduleIdleStop(entry);
        })
        .catch((error) => {
          emit(entry, { type: 'error', message: error instanceof Error ? error.message : String(error) });
        });
      return;
    }

    if (type === 'message_update') {
      const assistantMessageEvent = event.assistantMessageEvent;
      const deltaType = assistantMessageEvent && typeof assistantMessageEvent === 'object' && !Array.isArray(assistantMessageEvent)
        ? (assistantMessageEvent as { type?: string }).type
        : undefined;
      if (deltaType === 'text_delta') {
        emit(entry, { type: 'text_delta', delta: String((assistantMessageEvent as { delta?: unknown }).delta ?? '') });
      }
      if (deltaType === 'thinking_delta') {
        emit(entry, { type: 'thinking_delta', delta: String((assistantMessageEvent as { delta?: unknown }).delta ?? '') });
      }
      return;
    }

    if (type === 'tool_execution_start') {
      emit(entry, {
        type: 'tool_start',
        toolCallId: String(event.toolCallId ?? ''),
        toolName: String(event.toolName ?? ''),
        args: (event.args && typeof event.args === 'object' && !Array.isArray(event.args) ? event.args : {}) as Record<string, unknown>,
      });
      return;
    }

    if (type === 'tool_execution_update') {
      emit(entry, {
        type: 'tool_update',
        toolCallId: String(event.toolCallId ?? ''),
        partialResult: event.partialResult,
      });
      return;
    }

    if (type === 'tool_execution_end') {
      const summary = summarizeToolResult(event.result);
      emit(entry, {
        type: 'tool_end',
        toolCallId: String(event.toolCallId ?? ''),
        toolName: String(event.toolName ?? ''),
        isError: Boolean(event.isError),
        durationMs: 0,
        output: summary.output,
        ...(summary.details !== undefined ? { details: summary.details } : {}),
      });
      return;
    }
  });

  entry.rpc.onExit((error) => {
    entry.isStreaming = false;
    if (error) {
      emit(entry, { type: 'error', message: error });
    }
    setRemoteConnectionState({
      conversationId: entry.conversationId,
      targetId: entry.target.id,
      connected: false,
      state: error ? 'error' : 'idle',
      message: error || 'Remote workspace disconnected.',
      updatedAt: new Date().toISOString(),
    });
    remoteRegistry.delete(entry.conversationId);
  });
}

async function createBootstrapRemoteFile(target: ExecutionTargetRecord, localSessionFile: string): Promise<{ remotePath: string; cleanup: () => Promise<void> }> {
  const remoteTempRoot = (await runSsh(target, 'mktemp -d')).stdout.trim();
  const remotePath = `${remoteTempRoot}/${REMOTE_BOOTSTRAP_FILE}`;
  await uploadFile(target, localSessionFile, remotePath);
  return {
    remotePath,
    cleanup: async () => {
      await runSsh(target, `rm -rf ${quoteShellArg(remoteTempRoot)}`).catch(() => undefined);
    },
  };
}

async function startRemoteEntry(options: {
  profile: string;
  target: ExecutionTargetRecord;
  conversationId: string;
  localSessionFile: string;
  remoteCwd: string;
  remoteSessionFile?: string;
  bootstrapLocalSessionFile?: string;
}): Promise<RemoteLiveEntry> {
  setRemoteConnectionState({
    conversationId: options.conversationId,
    targetId: options.target.id,
    connected: false,
    state: 'installing',
    message: 'Preparing the remote runtime…',
    updatedAt: new Date().toISOString(),
  });

  let bootstrapCleanup: (() => Promise<void>) | undefined;
  try {
    const installedTarget = await ensureRemoteTargetInstalled(options.target);
    const remotePaCommand = installedTarget?.launcherPath || options.target.remotePaCommand || 'pa';

    let remoteBootstrapFile: string | undefined;
    if (options.bootstrapLocalSessionFile) {
      setRemoteConnectionState({
        conversationId: options.conversationId,
        targetId: options.target.id,
        connected: false,
        state: 'connecting',
        message: 'Uploading the local conversation mirror…',
        updatedAt: new Date().toISOString(),
      });
      const uploaded = await createBootstrapRemoteFile(options.target, options.bootstrapLocalSessionFile);
      bootstrapCleanup = uploaded.cleanup;
      remoteBootstrapFile = uploaded.remotePath;
    }

    setRemoteConnectionState({
      conversationId: options.conversationId,
      targetId: options.target.id,
      connected: false,
      state: 'connecting',
      message: 'Opening the remote Pi session…',
      updatedAt: new Date().toISOString(),
    });

    const rpc = createSshRpcClient({
      target: options.target,
      remotePaCommand,
      remoteCwd: options.remoteCwd,
      ...(options.remoteSessionFile ? { remoteSessionFile: options.remoteSessionFile } : {}),
      ...(remoteBootstrapFile ? { remoteBootstrapFile } : {}),
    });
    await rpc.start();
    const state = await rpc.getState();
    const remoteSessionFile = readRequiredString(state.sessionFile, 'remote session file');

    const entry: RemoteLiveEntry = {
      conversationId: options.conversationId,
      profile: options.profile,
      target: options.target,
      remoteCwd: options.remoteCwd,
      localSessionFile: options.localSessionFile,
      remoteSessionFile,
      rpc,
      listeners: new Set(),
      isStreaming: Boolean(state.isStreaming),
      pendingMessageCount: Number.isInteger(state.pendingMessageCount) && Number(state.pendingMessageCount) > 0
        ? Number(state.pendingMessageCount)
        : 0,
      ...(typeof state.sessionName === 'string' && state.sessionName.trim() ? { title: state.sessionName.trim() } : {}),
    };

    attachRpcEventForwarding(entry);
    remoteRegistry.set(entry.conversationId, entry);

    setRemoteConversationBinding({
      profile: options.profile,
      conversationId: options.conversationId,
      targetId: options.target.id,
      remoteCwd: options.remoteCwd,
      localSessionFile: options.localSessionFile,
      remoteSessionFile,
    });

    setRemoteConnectionState({
      conversationId: options.conversationId,
      targetId: options.target.id,
      connected: true,
      state: 'connected',
      message: 'Connected to the remote workspace.',
      updatedAt: new Date().toISOString(),
    });

    return entry;
  } catch (error) {
    setRemoteConnectionState({
      conversationId: options.conversationId,
      targetId: options.target.id,
      connected: false,
      state: 'error',
      message: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    await bootstrapCleanup?.();
  }
}

export async function browseRemoteTargetDirectory(options: {
  targetId: string;
  cwd?: string;
  baseCwd?: string;
}): Promise<RemoteFolderListing> {
  const target = getExecutionTarget({ targetId: options.targetId });
  if (!target) {
    throw new Error(`Execution target ${options.targetId} not found.`);
  }

  const stdout = await runRemoteNodeScript(target, `
const fs = require('node:fs');
const path = require('node:path');

function normalize(input) {
  return typeof input === 'string' ? input.trim() : '';
}

function expandHome(input) {
  if (input === '~') {
    return process.env.HOME || '/';
  }
  if (input.startsWith('~/')) {
    return path.posix.resolve(process.env.HOME || '/', input.slice(2));
  }
  return input;
}

const requested = normalize(process.env.TARGET_DIR);
const base = normalize(process.env.BASE_DIR) || process.env.HOME || '/';
const selected = requested ? expandHome(requested) : base;
const resolved = requested && !selected.startsWith('/')
  ? path.posix.resolve(base, selected)
  : path.posix.resolve(selected);
if (!fs.existsSync(resolved)) {
  throw new Error('Directory does not exist: ' + resolved);
}
const stat = fs.statSync(resolved);
if (!stat.isDirectory()) {
  throw new Error('Not a directory: ' + resolved);
}
const cwd = fs.realpathSync(resolved);
const root = path.parse(cwd).root;
const parent = cwd === root ? null : path.posix.dirname(cwd);
const entries = fs.readdirSync(cwd, { withFileTypes: true })
  .map((entry) => ({
    name: entry.name,
    path: path.posix.join(cwd, entry.name),
    isDirectory: (() => {
      try {
        return fs.statSync(path.posix.join(cwd, entry.name)).isDirectory();
      } catch {
        return false;
      }
    })(),
  }))
  .filter((entry) => entry.isDirectory)
  .sort((left, right) => left.name.localeCompare(right.name))
  .slice(0, 200)
  .map(({ name, path }) => ({ name, path }));
process.stdout.write(JSON.stringify({ cwd, parent, entries }));
`, {
    TARGET_DIR: options.cwd?.trim() ?? '',
    BASE_DIR: options.baseCwd?.trim() ?? target.defaultRemoteCwd?.trim() ?? '',
  });

  return JSON.parse(stdout) as RemoteFolderListing;
}

export function forkLocalMirrorSession(options: {
  sessionFile: string;
  remoteCwd: string;
}): { id: string; sessionFile: string } {
  const sessionManager = SessionManager.forkFrom(
    options.sessionFile,
    options.remoteCwd,
    resolvePersistentSessionDir(options.remoteCwd),
  );
  patchSessionManagerPersistence(sessionManager);
  ensureSessionFileExists(sessionManager);
  const sessionFile = readRequiredString(sessionManager.getSessionFile(), 'forked local mirror sessionFile');
  const conversationId = sessionManager.getSessionId();
  rewriteLocalSessionHeader(sessionFile, conversationId, options.remoteCwd);
  return {
    id: conversationId,
    sessionFile,
  };
}

export async function createRemoteLiveSession(options: {
  profile: string;
  targetId: string;
  remoteCwd: string;
  localSessionFile: string;
  conversationId: string;
  bootstrapLocalSessionFile?: string;
}): Promise<{ id: string; sessionFile: string }> {
  const target = getExecutionTarget({ targetId: options.targetId });
  if (!target) {
    throw new Error(`Execution target ${options.targetId} not found.`);
  }

  if (!remoteRegistry.has(options.conversationId)) {
    await startRemoteEntry({
      profile: options.profile,
      target,
      conversationId: options.conversationId,
      localSessionFile: options.localSessionFile,
      remoteCwd: options.remoteCwd,
      ...(options.bootstrapLocalSessionFile ? { bootstrapLocalSessionFile: options.bootstrapLocalSessionFile } : {}),
    });
  }

  return {
    id: options.conversationId,
    sessionFile: options.localSessionFile,
  };
}

export async function resumeRemoteLiveSession(options: {
  profile: string;
  conversationId: string;
  localSessionFile: string;
  targetId?: string;
}): Promise<{ id: string }> {
  if (remoteRegistry.has(options.conversationId)) {
    return { id: options.conversationId };
  }

  const binding = getRemoteConversationBinding({
    profile: options.profile,
    conversationId: options.conversationId,
  });
  const targetId = binding?.targetId ?? options.targetId;
  if (!targetId) {
    throw new Error(`Conversation ${options.conversationId} is not bound to a remote target.`);
  }

  const target = getExecutionTarget({ targetId });
  if (!target) {
    throw new Error(`Execution target ${targetId} not found.`);
  }

  const remoteCwd = binding?.remoteCwd || SessionManager.open(options.localSessionFile).getCwd();
  rewriteLocalSessionHeader(options.localSessionFile, options.conversationId, remoteCwd);

  await startRemoteEntry({
    profile: options.profile,
    target,
    conversationId: options.conversationId,
    localSessionFile: options.localSessionFile,
    remoteCwd,
    ...(binding?.remoteSessionFile ? { remoteSessionFile: binding.remoteSessionFile } : { bootstrapLocalSessionFile: options.localSessionFile }),
  });

  return { id: options.conversationId };
}

export async function stopRemoteLiveSession(conversationId: string): Promise<void> {
  const entry = remoteRegistry.get(conversationId);
  if (!entry) {
    return;
  }

  clearTimeout(entry.idleTimer);
  remoteRegistry.delete(conversationId);
  setRemoteConnectionState({
    conversationId: entry.conversationId,
    targetId: entry.target.id,
    connected: false,
    state: 'idle',
    message: 'Remote workspace disconnected.',
    updatedAt: new Date().toISOString(),
  });
  await entry.rpc.stop().catch(() => undefined);
}

export function isRemoteLiveSession(conversationId: string): boolean {
  return remoteRegistry.has(conversationId);
}

export function getRemoteLiveSessionMeta(conversationId: string): { id: string; cwd: string; sessionFile: string; title?: string; isStreaming: boolean; hasPendingHiddenTurn: boolean } | null {
  const entry = remoteRegistry.get(conversationId);
  if (!entry) {
    return null;
  }

  return {
    id: entry.conversationId,
    cwd: entry.remoteCwd,
    sessionFile: entry.localSessionFile,
    ...(entry.title ? { title: entry.title } : {}),
    isStreaming: entry.isStreaming,
    hasPendingHiddenTurn: false,
  };
}

export function listRemoteLiveSessions(): Array<{ id: string; cwd: string; sessionFile: string; title?: string; isStreaming: boolean; hasPendingHiddenTurn: boolean }> {
  return Array.from(remoteRegistry.values()).map((entry) => ({
    id: entry.conversationId,
    cwd: entry.remoteCwd,
    sessionFile: entry.localSessionFile,
    ...(entry.title ? { title: entry.title } : {}),
    isStreaming: entry.isStreaming,
    hasPendingHiddenTurn: false,
  }));
}

export function subscribeRemoteLiveSession(conversationId: string, listener: LiveListener, options?: { tailBlocks?: number }): (() => void) | null {
  const entry = remoteRegistry.get(conversationId);
  if (!entry) {
    return null;
  }

  clearTimeout(entry.idleTimer);
  entry.listeners.add(listener);
  listener(buildSnapshot(entry.localSessionFile, options?.tailBlocks));
  listener(buildRemoteQueueState(entry));
  void refreshRemoteQueueState(entry, { emitUpdate: true }).catch(() => undefined);
  if (entry.isStreaming) {
    listener({ type: 'agent_start' });
  }

  return () => {
    entry.listeners.delete(listener);
    scheduleIdleStop(entry);
  };
}

async function runRemotePrompt(entry: RemoteLiveEntry, options: {
  text: string;
  behavior?: 'steer' | 'followUp';
  images?: Array<{ type: 'image'; data: string; mimeType: string; name?: string }>;
  hiddenContext?: string;
}): Promise<void> {
  clearTimeout(entry.idleTimer);
  const promptText = options.hiddenContext ? `${options.hiddenContext}\n\n${options.text}` : options.text;
  if (!options.behavior) {
    appendLocalUserMessage(entry.localSessionFile, options.text);
  }

  if (options.behavior === 'steer') {
    await entry.rpc.steer(promptText, options.images);
    await refreshRemoteQueueState(entry, { emitUpdate: true });
    return;
  }

  if (options.behavior === 'followUp') {
    await entry.rpc.followUp(promptText, options.images);
    await refreshRemoteQueueState(entry, { emitUpdate: true });
    return;
  }

  await entry.rpc.prompt(promptText, options.images);
}

export async function promptRemoteLiveSession(options: {
  conversationId: string;
  text: string;
  behavior?: 'steer' | 'followUp';
  images?: Array<{ type: 'image'; data: string; mimeType: string; name?: string }>;
  hiddenContext?: string;
}): Promise<void> {
  const entry = remoteRegistry.get(options.conversationId);
  if (!entry) {
    throw new Error(`Session ${options.conversationId} is not live`);
  }

  await runRemotePrompt(entry, options);
}

export async function submitRemoteLiveSessionPrompt(options: {
  conversationId: string;
  text: string;
  behavior?: 'steer' | 'followUp';
  images?: Array<{ type: 'image'; data: string; mimeType: string; name?: string }>;
  hiddenContext?: string;
}): Promise<{ acceptedAs: 'started' | 'queued'; completion: Promise<void> }> {
  const entry = remoteRegistry.get(options.conversationId);
  if (!entry) {
    throw new Error(`Session ${options.conversationId} is not live`);
  }

  if (options.behavior === 'steer' || options.behavior === 'followUp') {
    await runRemotePrompt(entry, options);
    return {
      acceptedAs: 'queued',
      completion: Promise.resolve(),
    };
  }

  let settled = false;
  let unsubscribeEvent: (() => void) | null = null;
  let unsubscribeExit: (() => void) | null = null;
  const accepted = new Promise<void>((resolve, reject) => {
    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      unsubscribeEvent?.();
      unsubscribeExit?.();
      unsubscribeEvent = null;
      unsubscribeExit = null;
      handler();
    };

    unsubscribeEvent = entry.rpc.onEvent((event) => {
      const type = typeof event.type === 'string' ? event.type : '';
      if (type === 'agent_start' || type === 'agent_end') {
        finish(resolve);
      }
    });
    unsubscribeExit = entry.rpc.onExit((error) => {
      finish(() => reject(new Error(error || 'Remote workspace disconnected.')));
    });
  });

  const completion = runRemotePrompt(entry, options);
  void completion.finally(() => {
    if (!settled) {
      settled = true;
      unsubscribeEvent?.();
      unsubscribeExit?.();
      unsubscribeEvent = null;
      unsubscribeExit = null;
    }
  });

  await Promise.race([accepted, completion]);
  return {
    acceptedAs: 'started',
    completion,
  };
}

export async function abortRemoteLiveSession(conversationId: string): Promise<void> {
  const entry = remoteRegistry.get(conversationId);
  if (!entry) {
    return;
  }

  await entry.rpc.abort();
}

export async function createLocalMirrorSession(options: { remoteCwd: string }): Promise<{ id: string; sessionFile: string }> {
  const sessionManager = SessionManager.create(options.remoteCwd, resolvePersistentSessionDir(options.remoteCwd));
  patchSessionManagerPersistence(sessionManager);
  ensureSessionFileExists(sessionManager);
  return {
    id: sessionManager.getSessionId(),
    sessionFile: readRequiredString(sessionManager.getSessionFile(), 'local mirror sessionFile'),
  };
}

export function readRemoteConversationBindingForConversation(options: { profile: string; conversationId: string }): RemoteConversationBinding | null {
  return getRemoteConversationBinding(options);
}

export function clearRemoteConversationBindingForConversation(options: { profile: string; conversationId: string }): void {
  deleteRemoteConversationBinding(options);
  remoteConnectionStates.delete(options.conversationId);
  notifyRemoteConversationConnectionChanged(options.conversationId);
}

export function getRemoteConversationConnectionState(options: { profile: string; conversationId: string }): RemoteConversationConnectionState {
  const liveEntry = remoteRegistry.get(options.conversationId);
  if (liveEntry) {
    const current = remoteConnectionStates.get(options.conversationId);
    return {
      conversationId: options.conversationId,
      targetId: liveEntry.target.id,
      connected: true,
      state: 'connected',
      message: current?.message ?? 'Connected to the remote workspace.',
      updatedAt: current?.updatedAt ?? new Date().toISOString(),
    };
  }

  const binding = getRemoteConversationBinding(options);
  if (!binding) {
    return {
      conversationId: options.conversationId,
      targetId: null,
      connected: false,
      state: 'local',
      message: null,
      updatedAt: null,
    };
  }

  const current = remoteConnectionStates.get(options.conversationId);
  if (current && current.targetId === binding.targetId) {
    return current;
  }

  return {
    conversationId: options.conversationId,
    targetId: binding.targetId,
    connected: false,
    state: 'idle',
    message: 'Remote workspace disconnected. Click connect to resume.',
    updatedAt: binding.updatedAt,
  };
}
