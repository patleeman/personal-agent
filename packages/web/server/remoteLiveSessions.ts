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

type SseEvent =
  | { type: 'snapshot'; blocks: SessionDetail['blocks']; blockOffset: number; totalBlocks: number }
  | { type: 'agent_start' }
  | { type: 'agent_end' }
  | { type: 'turn_end' }
  | { type: 'user_message'; block: Extract<SessionDetail['blocks'][number], { type: 'user' }> }
  | { type: 'queue_state'; steering: string[]; followUp: string[] }
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
  idleTimer?: ReturnType<typeof setTimeout>;
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

export const remoteRegistry = new Map<string, RemoteLiveEntry>();

function quoteShellArg(value: string): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
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

function emit(entry: RemoteLiveEntry, event: SseEvent): void {
  for (const listener of entry.listeners) {
    listener(event);
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
      return;
    }

    if (type === 'agent_end') {
      entry.isStreaming = false;
      void syncMirrorFromRemote(entry)
        .then(() => {
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
  const installedTarget = await ensureRemoteTargetInstalled(options.target);
  const remotePaCommand = installedTarget?.launcherPath || options.target.remotePaCommand || 'pa';

  let bootstrapCleanup: (() => Promise<void>) | undefined;
  let remoteBootstrapFile: string | undefined;
  if (options.bootstrapLocalSessionFile) {
    const uploaded = await createBootstrapRemoteFile(options.target, options.bootstrapLocalSessionFile);
    bootstrapCleanup = uploaded.cleanup;
    remoteBootstrapFile = uploaded.remotePath;
  }

  try {
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

    return entry;
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
  await entry.rpc.stop().catch(() => undefined);
}

export function isRemoteLiveSession(conversationId: string): boolean {
  return remoteRegistry.has(conversationId);
}

export function getRemoteLiveSessionMeta(conversationId: string): { id: string; cwd: string; sessionFile: string; title?: string; isStreaming: boolean } | null {
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
  };
}

export function listRemoteLiveSessions(): Array<{ id: string; cwd: string; sessionFile: string; title?: string; isStreaming: boolean }> {
  return Array.from(remoteRegistry.values()).map((entry) => ({
    id: entry.conversationId,
    cwd: entry.remoteCwd,
    sessionFile: entry.localSessionFile,
    ...(entry.title ? { title: entry.title } : {}),
    isStreaming: entry.isStreaming,
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
  listener({ type: 'queue_state', steering: [], followUp: [] });
  if (entry.isStreaming) {
    listener({ type: 'agent_start' });
  }

  return () => {
    entry.listeners.delete(listener);
    scheduleIdleStop(entry);
  };
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

  clearTimeout(entry.idleTimer);
  const promptText = options.hiddenContext ? `${options.hiddenContext}\n\n${options.text}` : options.text;
  if (!options.behavior) {
    appendLocalUserMessage(entry.localSessionFile, options.text);
  }

  if (options.behavior === 'steer') {
    await entry.rpc.steer(promptText, options.images);
    return;
  }

  if (options.behavior === 'followUp') {
    await entry.rpc.followUp(promptText, options.images);
    return;
  }

  await entry.rpc.prompt(promptText, options.images);
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
}
