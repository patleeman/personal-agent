import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';

import { getDesktopAppBaseUrl } from '../app-protocol.js';
import { loadLocalApiModule, type LocalApiModule, type LocalApiModuleLoader } from '../local-api-module.js';
import { emitDesktopRemoteOperationStatus } from '../remote-operation-events.js';
import { parseRemotePlatform } from '../remote-platform.js';
import { SshRemoteConversationRuntime } from '../ssh-remote-runtime.js';
import { runSshCommand } from '../system-ssh.js';
import { parseApiDispatchResult } from './api-dispatch.js';
import type {
  DesktopApiStreamEvent,
  DesktopHostRecord,
  DesktopSshConnectionTestResult,
  HostApiDispatchResult,
  HostController,
  HostStatus,
} from './types.js';

function jsonResult(statusCode: number, body: unknown): HostApiDispatchResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: Uint8Array.from(Buffer.from(JSON.stringify(body), 'utf-8')),
  };
}

function parsePath(path: string): { pathname: string; query: URLSearchParams } {
  const parsed = new URL(path, 'http://127.0.0.1');
  return {
    pathname: parsed.pathname,
    query: parsed.searchParams,
  };
}

function parseJsonBody<T = unknown>(response: HostApiDispatchResult): T | null {
  const contentType = response.headers['content-type'] ?? response.headers['Content-Type'] ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(response.body).toString('utf-8')) as T;
  } catch {
    return null;
  }
}

function normalizeThinkingLevel(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : 'medium';
}

function normalizeModel(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readModelId(value: Record<string, unknown>): string {
  const model = value.model;
  if (!model || typeof model !== 'object') {
    return '';
  }

  return normalizeModel((model as { id?: unknown }).id);
}

function readConversationId(pathname: string, prefix: RegExp): string {
  const match = pathname.match(prefix);
  return typeof match?.[1] === 'string' ? decodeURIComponent(match[1]) : '';
}

function buildSshConnectionProbeCommand(): string {
  return [
    'set -eu',
    'os=$(uname -s)',
    'arch=$(uname -m)',
    'home=${HOME:?HOME is not set}',
    'tmp=${TMPDIR:-/tmp}',
    'cache="$home/.cache/personal-agent/ssh-runtime"',
    'mkdir -p "$cache"',
    'test -w "$cache"',
    'probe=$(mktemp -d "${tmp%/}/personal-agent-ssh-test.XXXXXX")',
    'rmdir "$probe"',
    'printf "%s\\n%s\\n%s\\n%s\\n%s\\n" "$os" "$arch" "$home" "$tmp" "$cache"',
  ].join('; ');
}

export function testSshConnection(input: { sshTarget: string }): DesktopSshConnectionTestResult {
  const sshTarget = input.sshTarget.trim();
  if (!sshTarget) {
    throw new Error('SSH target is required.');
  }

  const output = runSshCommand(sshTarget, `sh -lc '${buildSshConnectionProbeCommand()}'`).trim();
  const [rawOs = '', rawArch = '', homeDirectory = '', tempDirectory = '', cacheDirectory = ''] = output.split(/\r?\n/);
  const platform = parseRemotePlatform({ os: rawOs, arch: rawArch });
  const osLabel = platform.os === 'darwin' ? 'macOS' : 'Linux';
  const message = `${sshTarget} is reachable · ${osLabel} ${platform.arch}`;

  return {
    ok: true,
    sshTarget,
    os: platform.os,
    arch: platform.arch,
    platformKey: platform.key,
    homeDirectory,
    tempDirectory,
    cacheDirectory,
    message,
  };
}

export class SshHostController implements HostController {
  readonly id: string;
  readonly label: string;
  readonly kind = 'ssh' as const;

  private readonly runtimes = new Map<string, SshRemoteConversationRuntime>();
  private localApiPromise: Promise<LocalApiModule> | null = null;

  constructor(
    private readonly record: Extract<DesktopHostRecord, { kind: 'ssh' }>,
    private readonly loadLocalApi: LocalApiModuleLoader = loadLocalApiModule,
  ) {
    this.id = record.id;
    this.label = record.label;
  }

  async ensureRunning(): Promise<void> {
    runSshCommand(this.record.sshTarget, 'printf ok');
  }

  async getBaseUrl(): Promise<string> {
    return getDesktopAppBaseUrl();
  }

  async getStatus(): Promise<HostStatus> {
    try {
      await this.ensureRunning();
      return {
        reachable: true,
        mode: 'ssh-tunnel',
        summary: `SSH remote ${this.record.sshTarget} is reachable.`,
      };
    } catch (error) {
      return {
        reachable: false,
        mode: 'ssh-tunnel',
        summary: `SSH remote ${this.record.sshTarget} is not reachable.`,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async openNewConversation(): Promise<string> {
    return new URL('/conversations/new', getDesktopAppBaseUrl()).toString();
  }

  async dispatchApiRequest(input: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<HostApiDispatchResult> {
    const { pathname, query } = parsePath(input.path);

    if (input.method === 'POST' && pathname === '/api/live-sessions') {
      const body = (input.body as { conversationId?: unknown; cwd?: unknown; sessionContent?: unknown } | undefined) ?? {};
      const conversationId = typeof body.conversationId === 'string' ? body.conversationId.trim() : '';
      const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : '';
      const sessionContent = typeof body.sessionContent === 'string' ? body.sessionContent : undefined;
      if (!conversationId) {
        return jsonResult(400, { error: 'conversationId required' });
      }
      if (!cwd) {
        return jsonResult(400, { error: 'cwd required' });
      }

      const runtime = await this.getRuntime(conversationId);
      await runtime.ensureRuntime({ conversationId, cwd, sessionContent });
      return jsonResult(200, {
        id: conversationId,
        sessionFile: await this.readLocalSessionFile(conversationId),
      });
    }

    const conversationId = readConversationId(pathname, /^\/api\/(?:conversations|live-sessions|sessions)\/([^/]+)/);
    if (!conversationId) {
      return jsonResult(501, { error: `SSH remote route not supported: ${pathname}` });
    }

    if (pathname === `/api/conversations/${encodeURIComponent(conversationId)}/title` && input.method === 'PATCH') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      const body = (input.body as { name?: unknown } | undefined) ?? {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) {
        return jsonResult(400, { error: 'name required' });
      }
      await runtime.requestHelper({ type: 'rpc', command: { type: 'set_session_name', name } });
      return jsonResult(200, { ok: true, title: name });
    }

    if (pathname === `/api/conversations/${encodeURIComponent(conversationId)}/model-preferences`) {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      if (input.method === 'GET') {
        const state = await this.readPiState(runtime);
        return jsonResult(200, {
          currentModel: readModelId(state),
          currentThinkingLevel: normalizeThinkingLevel(state.thinkingLevel),
          currentServiceTier: '',
        });
      }

      if (input.method === 'PATCH') {
        const body = (input.body as { model?: unknown; thinkingLevel?: unknown } | undefined) ?? {};
        const model = typeof body.model === 'string' ? body.model.trim() : '';
        const thinkingLevel = typeof body.thinkingLevel === 'string' ? body.thinkingLevel.trim() : '';
        if (model) {
          const [provider, modelId] = model.includes('/') ? model.split('/', 2) : ['', model];
          await runtime.requestHelper({
            type: 'rpc',
            command: provider ? { type: 'set_model', provider, modelId } : { type: 'set_model', modelId },
          });
        }
        if (thinkingLevel) {
          await runtime.requestHelper({ type: 'rpc', command: { type: 'set_thinking_level', level: thinkingLevel } });
        }
        const state = await this.readPiState(runtime);
        return jsonResult(200, {
          currentModel: readModelId(state),
          currentThinkingLevel: normalizeThinkingLevel(state.thinkingLevel),
          currentServiceTier: '',
        });
      }
    }

    if (pathname === `/api/conversations/${encodeURIComponent(conversationId)}/cwd` && input.method === 'POST') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      const body = (input.body as { cwd?: unknown } | undefined) ?? {};
      const cwd = typeof body.cwd === 'string' ? body.cwd.trim() : '';
      if (!cwd) {
        return jsonResult(400, { error: 'cwd required' });
      }
      const runtimeInfo = await runtime.restartRuntime(cwd, conversationId);
      const localFile = await this.readLocalSessionFile(conversationId);
      await runtime.syncRemoteSessionToLocal({ conversationId, localFilePath: localFile });
      return jsonResult(200, {
        id: conversationId,
        sessionFile: localFile,
        cwd: runtimeInfo.cwd,
        changed: true,
      });
    }

    if (pathname === `/api/conversations/${encodeURIComponent(conversationId)}/bootstrap` && input.method === 'GET') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      const localFile = await this.readLocalSessionFile(conversationId);
      await runtime.syncRemoteSessionToLocal({ conversationId, localFilePath: localFile });
      const localApi = await this.getLocalApi();
      const localResponse = await localApi.dispatchDesktopLocalApiRequest({
        method: 'GET',
        path: `/api/conversations/${encodeURIComponent(conversationId)}/bootstrap${query.toString() ? `?${query.toString()}` : ''}`,
      });
      const parsed = parseJsonBody<Record<string, unknown>>(localResponse) ?? {};
      const runtimeInfo = await this.readHelperInfo(runtime);
      return jsonResult(200, {
        ...parsed,
        conversationId,
        liveSession: {
          live: true,
          id: conversationId,
          cwd: runtimeInfo.cwd,
          sessionFile: localFile,
          title:
            typeof (parsed.liveSession as { title?: unknown } | undefined)?.title === 'string'
              ? (parsed.liveSession as { title: string }).title
              : ((parsed.sessionDetail as { meta?: { title?: unknown } } | undefined)?.meta?.title as string | undefined),
          isStreaming: runtimeInfo.isStreaming,
          hasPendingHiddenTurn: false,
        },
      });
    }

    if (pathname === `/api/live-sessions/${encodeURIComponent(conversationId)}` && input.method === 'GET') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      const runtimeInfo = await this.readHelperInfo(runtime);
      const localFile = await this.readLocalSessionFile(conversationId);
      await runtime.syncRemoteSessionToLocal({ conversationId, localFilePath: localFile });
      const meta = await this.readLocalSessionMeta(conversationId);
      return jsonResult(200, {
        live: true,
        id: conversationId,
        cwd: runtimeInfo.cwd,
        sessionFile: localFile,
        title: meta?.title,
        isStreaming: runtimeInfo.isStreaming,
        hasPendingHiddenTurn: false,
      });
    }

    if (pathname === `/api/live-sessions/${encodeURIComponent(conversationId)}/context` && input.method === 'GET') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      const runtimeInfo = await this.readHelperInfo(runtime);
      return jsonResult(200, {
        cwd: runtimeInfo.cwd,
        branch: null,
        git: null,
      });
    }

    if (pathname === `/api/live-sessions/${encodeURIComponent(conversationId)}/prompt` && input.method === 'POST') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      const body =
        (input.body as
          | {
              text?: unknown;
              behavior?: unknown;
              images?: unknown;
              attachmentRefs?: unknown;
              contextMessages?: unknown;
            }
          | undefined) ?? {};
      const attachmentRefs = Array.isArray(body.attachmentRefs) ? body.attachmentRefs : [];
      if (attachmentRefs.length > 0) {
        return jsonResult(400, { error: 'Remote Pi sessions do not support local attachment refs yet.' });
      }
      const behavior = body.behavior === 'steer' ? 'steer' : body.behavior === 'followUp' ? 'followUp' : 'prompt';
      const commandType = behavior === 'steer' ? 'steer' : behavior === 'followUp' ? 'follow_up' : 'prompt';
      const command = {
        type: commandType,
        ...(typeof body.text === 'string' ? { message: body.text } : {}),
        ...(Array.isArray(body.images) ? { images: body.images } : {}),
      } as Record<string, unknown>;
      const response = (await runtime.requestHelper({ type: 'rpc', command })) as {
        success?: boolean;
        error?: string;
      };
      if (response?.success === false) {
        return jsonResult(500, { error: response.error || `Remote ${commandType} failed.` });
      }
      return jsonResult(200, {
        ok: true,
        accepted: true,
        delivery: 'started',
        referencedTaskIds: [],
        referencedMemoryDocIds: [],
        referencedVaultFileIds: [],
        referencedAttachmentIds: [],
      });
    }

    if (pathname === `/api/live-sessions/${encodeURIComponent(conversationId)}/bash` && input.method === 'POST') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      const body = (input.body as { command?: unknown } | undefined) ?? {};
      const command = typeof body.command === 'string' ? body.command.trim() : '';
      if (!command) {
        return jsonResult(400, { error: 'command required' });
      }
      const response = (await runtime.requestHelper({ type: 'rpc', command: { type: 'bash', command } })) as {
        data?: { output?: string; exitCode?: number; cancelled?: boolean; truncated?: boolean; fullOutputPath?: string };
      };
      return jsonResult(200, {
        ok: true,
        result: response?.data ?? {},
      });
    }

    if (pathname === `/api/live-sessions/${encodeURIComponent(conversationId)}/abort` && input.method === 'POST') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      await Promise.allSettled([
        runtime.requestHelper({ type: 'rpc', command: { type: 'abort' } }),
        runtime.requestHelper({ type: 'rpc', command: { type: 'abort_bash' } }),
      ]);
      return jsonResult(200, { ok: true });
    }

    if (pathname === `/api/live-sessions/${encodeURIComponent(conversationId)}/export` && input.method === 'POST') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      const body = (input.body as { outputPath?: unknown } | undefined) ?? {};
      const outputPath = typeof body.outputPath === 'string' ? body.outputPath.trim() : '';
      const response = (await runtime.requestHelper({
        type: 'rpc',
        command: {
          type: 'export_html',
          ...(outputPath ? { outputPath } : {}),
        },
      })) as { data?: { path?: string } };
      return jsonResult(200, {
        ok: true,
        path: typeof response?.data?.path === 'string' ? response.data.path : outputPath,
      });
    }

    if (pathname === `/api/live-sessions/${encodeURIComponent(conversationId)}/fork-entries` && input.method === 'GET') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      const response = (await runtime.requestHelper({ type: 'rpc', command: { type: 'get_fork_messages' } })) as {
        data?: { messages?: Array<{ entryId?: string; text?: string }> };
      };
      return jsonResult(
        200,
        (response?.data?.messages ?? []).map((message) => ({
          entryId: typeof message.entryId === 'string' ? message.entryId : '',
          text: typeof message.text === 'string' ? message.text : '',
        })),
      );
    }

    if (pathname === `/api/live-sessions/${encodeURIComponent(conversationId)}/reload` && input.method === 'POST') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      const localFile = await this.readLocalSessionFile(conversationId);
      await runtime.syncRemoteSessionToLocal({ conversationId, localFilePath: localFile });
      return jsonResult(200, { ok: true });
    }

    if (pathname === `/api/live-sessions/${encodeURIComponent(conversationId)}` && input.method === 'DELETE') {
      const runtime = this.runtimes.get(conversationId);
      if (runtime) {
        await runtime.shutdownRuntime(conversationId, true).catch(() => undefined);
        runtime.dispose();
        this.runtimes.delete(conversationId);
      }
      return jsonResult(200, { ok: true });
    }

    if (pathname.startsWith(`/api/sessions/${encodeURIComponent(conversationId)}`) && input.method === 'GET') {
      const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
      const localFile = await this.readLocalSessionFile(conversationId);
      await runtime.syncRemoteSessionToLocal({ conversationId, localFilePath: localFile });
      const localApi = await this.getLocalApi();
      return localApi.dispatchDesktopLocalApiRequest(input);
    }

    return jsonResult(501, { error: `SSH remote route not supported: ${pathname}` });
  }

  async invokeLocalApi(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const response = await this.dispatchApiRequest({ method, path, body });
    return parseApiDispatchResult(response);
  }

  async readDirectory(path?: string | null) {
    const runtime = new SshRemoteConversationRuntime(this.record.sshTarget, this.id, this.label, (status) =>
      emitDesktopRemoteOperationStatus(status),
    );
    return runtime.readDirectory(path);
  }

  async subscribeApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void> {
    const { pathname, query } = parsePath(path);
    const conversationId = readConversationId(pathname, /^\/api\/live-sessions\/([^/]+)\/events$/);
    if (!conversationId) {
      onEvent({ type: 'open' });
      onEvent({ type: 'error', message: `SSH remote stream not supported: ${path}` });
      return () => {
        onEvent({ type: 'close' });
      };
    }

    const runtime = await this.ensureConversationRuntimeFromLocal(conversationId);
    const localFile = await this.readLocalSessionFile(conversationId);
    await runtime.syncRemoteSessionToLocal({ conversationId, localFilePath: localFile });
    const localApi = await this.getLocalApi();
    const detail = await localApi.invokeDesktopLocalApi<{
      blocks: unknown[];
      blockOffset: number;
      totalBlocks: number;
    }>({
      method: 'GET',
      path: `/api/sessions/${encodeURIComponent(conversationId)}${query.toString() ? `?${query.toString()}` : ''}`,
    });

    onEvent({ type: 'open' });
    onEvent({
      type: 'message',
      data: JSON.stringify({
        type: 'snapshot',
        blocks: detail.blocks,
        blockOffset: detail.blockOffset,
        totalBlocks: detail.totalBlocks,
      }),
    });

    const unsubscribe = runtime.subscribeEvents((event) => {
      const eventType = typeof event.type === 'string' ? event.type : '';
      switch (eventType) {
        case 'agent_start':
          onEvent({ type: 'message', data: JSON.stringify({ type: 'agent_start' }) });
          return;
        case 'agent_end':
          void runtime.syncRemoteSessionToLocal({ conversationId, localFilePath: localFile }).catch(() => undefined);
          onEvent({ type: 'message', data: JSON.stringify({ type: 'agent_end' }) });
          return;
        case 'queue_update':
          onEvent({
            type: 'message',
            data: JSON.stringify({
              type: 'queue_state',
              steering: Array.isArray(event.steering) ? event.steering : [],
              followUp: Array.isArray(event.followUp) ? event.followUp : [],
            }),
          });
          return;
        case 'tool_execution_start':
          onEvent({
            type: 'message',
            data: JSON.stringify({
              type: 'tool_start',
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
            }),
          });
          return;
        case 'tool_execution_update':
          onEvent({
            type: 'message',
            data: JSON.stringify({
              type: 'tool_update',
              toolCallId: event.toolCallId,
              partialResult: event.partialResult,
            }),
          });
          return;
        case 'tool_execution_end': {
          const result =
            typeof event.result === 'object' && event.result !== null
              ? (event.result as { content?: Array<{ text?: string }>; details?: unknown })
              : null;
          const output = result?.content?.map((entry) => entry?.text ?? '').join('') ?? '';
          onEvent({
            type: 'message',
            data: JSON.stringify({
              type: 'tool_end',
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              output,
              details: result?.details,
              isError: event.isError === true,
            }),
          });
          return;
        }
        case 'message_update': {
          const assistantMessageEvent =
            typeof event.assistantMessageEvent === 'object' && event.assistantMessageEvent !== null
              ? (event.assistantMessageEvent as { type?: unknown; delta?: unknown })
              : null;
          if (assistantMessageEvent?.type === 'text_delta' && typeof assistantMessageEvent.delta === 'string') {
            onEvent({ type: 'message', data: JSON.stringify({ type: 'text_delta', delta: assistantMessageEvent.delta }) });
          }
          if (assistantMessageEvent?.type === 'thinking_delta' && typeof assistantMessageEvent.delta === 'string') {
            onEvent({ type: 'message', data: JSON.stringify({ type: 'thinking_delta', delta: assistantMessageEvent.delta }) });
          }
          return;
        }
        case 'error':
          if (typeof event.message === 'string') {
            onEvent({ type: 'message', data: JSON.stringify({ type: 'error', message: event.message }) });
          }
          return;
      }
    });

    return () => {
      unsubscribe();
      onEvent({ type: 'close' });
    };
  }

  async restart(): Promise<void> {
    await this.ensureRunning();
  }

  async stop(): Promise<void> {
    for (const [conversationId, runtime] of this.runtimes) {
      await runtime.shutdownRuntime(conversationId, false).catch(() => undefined);
      runtime.dispose();
    }
    this.runtimes.clear();
  }

  async dispose(): Promise<void> {
    for (const runtime of this.runtimes.values()) {
      runtime.dispose();
    }
    this.runtimes.clear();
  }

  private async ensureConversationRuntimeFromLocal(conversationId: string): Promise<SshRemoteConversationRuntime> {
    const meta = await this.readLocalSessionMeta(conversationId);
    const cwd = meta?.cwd?.trim() || '';
    if (!cwd) {
      throw new Error(`Conversation ${conversationId} does not have a local cwd to start remotely.`);
    }

    const localFile = meta?.file?.trim() || '';
    let fallbackSessionContent: string | undefined;
    if (localFile) {
      try {
        fallbackSessionContent = readFileSync(localFile, 'utf-8');
      } catch {
        fallbackSessionContent = undefined;
      }
    }

    const runtime = await this.getRuntime(conversationId);
    await runtime.ensureRuntime({ conversationId, cwd, fallbackSessionContent });
    return runtime;
  }

  private async readPiState(runtime: SshRemoteConversationRuntime): Promise<Record<string, unknown>> {
    const response = (await runtime.requestHelper({ type: 'rpc', command: { type: 'get_state' } })) as {
      data?: Record<string, unknown>;
    };
    return response?.data ?? {};
  }

  private async readHelperInfo(runtime: SshRemoteConversationRuntime): Promise<{ cwd: string; sessionFile: string; isStreaming: boolean }> {
    const info = await runtime.requestHelper({ type: 'get_info' });
    if (!info || typeof info !== 'object') {
      throw new Error(`Remote helper for ${this.label} returned malformed runtime info.`);
    }
    const candidate = info as { cwd?: unknown; sessionFile?: unknown; isStreaming?: unknown };
    return {
      cwd: typeof candidate.cwd === 'string' ? candidate.cwd : '',
      sessionFile: typeof candidate.sessionFile === 'string' ? candidate.sessionFile : '',
      isStreaming: candidate.isStreaming === true,
    };
  }

  private async getLocalApi(): Promise<LocalApiModule> {
    if (!this.localApiPromise) {
      this.localApiPromise = this.loadLocalApi();
    }
    return this.localApiPromise;
  }

  private async readLocalSessionMeta(conversationId: string): Promise<{ file?: string; cwd?: string; title?: string } | null> {
    const localApi = await this.getLocalApi();
    try {
      return (await localApi.readDesktopSessionMeta(conversationId)) as { file?: string; cwd?: string; title?: string } | null;
    } catch {
      return null;
    }
  }

  private async readLocalSessionFile(conversationId: string): Promise<string> {
    const meta = await this.readLocalSessionMeta(conversationId);
    const filePath = meta?.file?.trim() || '';
    if (!filePath) {
      throw new Error(`Conversation ${conversationId} does not have a persisted local session file.`);
    }
    return filePath;
  }

  private async getRuntime(conversationId: string): Promise<SshRemoteConversationRuntime> {
    const existing = this.runtimes.get(conversationId);
    if (existing) {
      return existing;
    }

    const runtime = new SshRemoteConversationRuntime(this.record.sshTarget, this.id, this.label, (status) =>
      emitDesktopRemoteOperationStatus(status),
    );
    this.runtimes.set(conversationId, runtime);
    return runtime;
  }
}
