import { Buffer } from 'node:buffer';
import {
  buildSessionDetailFromCodexThread,
  buildSessionMetaFromCodexThread,
  type CodexThread,
  type CodexThreadItem,
} from '@personal-agent/core';
import type { DesktopApiStreamEvent, HostApiDispatchResult } from './types.js';
import { CodexAppServerClient } from './codex-app-server-client.js';

function jsonResult(statusCode: number, body: unknown): HostApiDispatchResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: Uint8Array.from(Buffer.from(JSON.stringify(body), 'utf-8')),
  };
}

function notSupported(path: string): HostApiDispatchResult {
  return jsonResult(501, { error: `Remote workspace route not supported yet: ${path}` });
}

interface ThreadListResult {
  data: CodexThread[];
}

interface ThreadReadResult {
  thread: CodexThread;
}

interface ThreadLoadedListResult {
  data: string[];
}

interface ModelListResult {
  data: Array<{
    model: string;
    defaultReasoningEffort?: string | null;
    isDefault?: boolean;
  }>;
}

export class CodexWorkspaceApiAdapter {
  private sessionMetaCache = new Map<string, ReturnType<typeof buildSessionMetaFromCodexThread>>();
  private threadRuntimeCache = new Map<string, { model: string; thinkingLevel: string }>();
  private activeTurnIds = new Map<string, string>();

  constructor(
    private readonly client: CodexAppServerClient,
    private readonly options: { workspaceRoot?: string } = {},
  ) {}

  async dispatchApiRequest(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<HostApiDispatchResult> {
    const url = new URL(input.path, 'http://127.0.0.1');
    const path = url.pathname;

    if (input.method === 'GET' && path === '/api/status') {
      const workspace = this.options.workspaceRoot?.trim() || this.sessionMetaCache.values().next().value?.cwd || '';
      return jsonResult(200, {
        profile: 'remote-workspace',
        repoRoot: workspace,
        projectCount: 0,
      });
    }

    if (input.method === 'GET' && path === '/api/models') {
      const models = await this.client.request<ModelListResult>('model/list', {});
      const current = models.data.find((entry) => entry.isDefault) ?? models.data[0] ?? null;
      return jsonResult(200, {
        currentModel: current?.model ?? '',
        currentThinkingLevel: current?.defaultReasoningEffort ?? 'medium',
        models: models.data.map((entry) => ({
          id: entry.model,
          provider: 'remote-workspace',
          name: entry.model,
          context: 128_000,
        })),
      });
    }

    if (input.method === 'GET' && path === '/api/sessions') {
      const result = await this.client.request<ThreadListResult>('thread/list', this.options.workspaceRoot?.trim()
        ? { cwd: this.options.workspaceRoot.trim() }
        : {});
      const defaultModel = await this.readDefaultModel();
      const loadedIds = await this.readLoadedThreadIds();
      const sessions = result.data.map((thread) => {
        const meta = buildSessionMetaFromCodexThread({ thread, model: this.threadRuntimeCache.get(thread.id)?.model ?? defaultModel.model });
        const normalized = loadedIds.has(thread.id) ? { ...meta, isLive: true } : meta;
        this.sessionMetaCache.set(normalized.id, normalized);
        return normalized;
      });
      return jsonResult(200, sessions);
    }

    const sessionMetaMatch = path.match(/^\/api\/sessions\/([^/]+)\/meta$/);
    if (input.method === 'GET' && sessionMetaMatch) {
      const sessionId = decodeURIComponent(sessionMetaMatch[1] ?? '');
      const thread = await this.readThread(sessionId);
      const meta = buildSessionMetaFromCodexThread({ thread: thread.thread, model: thread.model });
      this.sessionMetaCache.set(meta.id, meta);
      return jsonResult(200, meta);
    }

    if (input.method === 'POST' && path === '/api/sessions/search-index') {
      const sessionIds = Array.isArray((input.body as { sessionIds?: unknown } | undefined)?.sessionIds)
        ? ((input.body as { sessionIds: string[] }).sessionIds)
        : [];
      const index = Object.fromEntries(sessionIds.map((sessionId) => {
        const meta = this.sessionMetaCache.get(sessionId);
        return [sessionId, [meta?.title, meta?.cwd, meta?.model].filter(Boolean).join('\n')];
      }));
      return jsonResult(200, { index });
    }

    const bootstrapMatch = path.match(/^\/api\/conversations\/([^/]+)\/bootstrap$/);
    if (input.method === 'GET' && bootstrapMatch) {
      const conversationId = decodeURIComponent(bootstrapMatch[1] ?? '');
      const thread = await this.readThread(conversationId);
      return jsonResult(200, {
        conversationId,
        sessionDetail: thread.detail,
        sessionDetailSignature: null,
        sessionDetailUnchanged: false,
        sessionDetailAppendOnly: null,
        liveSession: !thread.isLoaded
          ? { live: false }
          : {
              live: true,
              id: conversationId,
              cwd: thread.thread.cwd,
              sessionFile: thread.thread.path ?? '',
              title: thread.thread.name ?? undefined,
              isStreaming: thread.thread.status.type === 'active',
            },
      });
    }

    const conversationTitleMatch = path.match(/^\/api\/conversations\/([^/]+)\/title$/);
    if (input.method === 'PATCH' && conversationTitleMatch) {
      const conversationId = decodeURIComponent(conversationTitleMatch[1] ?? '');
      const name = typeof (input.body as { name?: unknown } | undefined)?.name === 'string'
        ? (input.body as { name: string }).name
        : '';
      await this.client.request('thread/name/set', { threadId: conversationId, name });
      return jsonResult(200, { ok: true, title: name });
    }

    const conversationModelMatch = path.match(/^\/api\/conversations\/([^/]+)\/model-preferences$/);
    if (input.method === 'GET' && conversationModelMatch) {
      const conversationId = decodeURIComponent(conversationModelMatch[1] ?? '');
      const cached = this.threadRuntimeCache.get(conversationId);
      const fallback = await this.readDefaultModel();
      return jsonResult(200, {
        currentModel: cached?.model ?? fallback.model,
        currentThinkingLevel: cached?.thinkingLevel ?? fallback.thinkingLevel,
      });
    }

    const liveSessionMatch = path.match(/^\/api\/live-sessions\/([^/]+)$/);
    if (input.method === 'GET' && liveSessionMatch) {
      const conversationId = decodeURIComponent(liveSessionMatch[1] ?? '');
      const thread = await this.readThread(conversationId);
      return jsonResult(200, {
        live: thread.isLoaded,
        id: conversationId,
        cwd: thread.thread.cwd,
        sessionFile: thread.thread.path ?? '',
        title: thread.thread.name ?? undefined,
        isStreaming: thread.thread.status.type === 'active',
      });
    }

    const liveSessionContextMatch = path.match(/^\/api\/live-sessions\/([^/]+)\/context$/);
    if (input.method === 'GET' && liveSessionContextMatch) {
      const conversationId = decodeURIComponent(liveSessionContextMatch[1] ?? '');
      const thread = await this.readThread(conversationId);
      return jsonResult(200, {
        cwd: thread.thread.cwd,
        branch: null,
        git: null,
      });
    }

    if (input.method === 'POST' && path === '/api/live-sessions') {
      const body = (input.body as { cwd?: unknown; model?: unknown; thinkingLevel?: unknown; text?: unknown } | undefined) ?? {};
      const result = await this.client.request<{
        thread: CodexThread;
        model: string;
        modelProvider: string;
        reasoningEffort?: string | null;
      }>('thread/start', {
        ...((typeof body.cwd === 'string' && body.cwd.trim().length > 0)
          ? { cwd: body.cwd.trim() }
          : (this.options.workspaceRoot?.trim().length
            ? { cwd: this.options.workspaceRoot.trim() }
            : {})),
        ...(typeof body.model === 'string' && body.model.trim().length > 0 ? { model: body.model.trim() } : {}),
        ...(typeof body.thinkingLevel === 'string' && body.thinkingLevel.trim().length > 0 ? { effort: body.thinkingLevel.trim() } : {}),
      });
      this.threadRuntimeCache.set(result.thread.id, {
        model: result.model,
        thinkingLevel: typeof result.reasoningEffort === 'string' ? result.reasoningEffort : 'medium',
      });
      return jsonResult(200, {
        id: result.thread.id,
        sessionFile: result.thread.path ?? '',
      });
    }

    const livePromptMatch = path.match(/^\/api\/live-sessions\/([^/]+)\/prompt$/);
    if (input.method === 'POST' && livePromptMatch) {
      const conversationId = decodeURIComponent(livePromptMatch[1] ?? '');
      const body = (input.body as { text?: unknown; behavior?: unknown } | undefined) ?? {};
      const text = typeof body.text === 'string' ? body.text : '';
      const behavior = body.behavior === 'steer' ? 'steer' : 'followUp';
      if (behavior === 'steer') {
        const activeTurnId = this.activeTurnIds.get(conversationId);
        if (!activeTurnId) {
          return jsonResult(409, { error: 'No active turn is available to steer for this remote workspace.' });
        }
        await this.client.request('turn/steer', {
          threadId: conversationId,
          expectedTurnId: activeTurnId,
          input: [{ type: 'text', text, textElements: [] }],
        });
      } else {
        const result = await this.client.request<{ turn: { id: string } }>('turn/start', {
          threadId: conversationId,
          input: [{ type: 'text', text, textElements: [] }],
        });
        this.activeTurnIds.set(conversationId, result.turn.id);
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

    return notSupported(path);
  }

  async subscribeApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void> {
    const url = new URL(path, 'http://127.0.0.1');
    if (url.pathname === '/api/app-events') {
      onEvent({ type: 'open' });
      return () => {
        onEvent({ type: 'close' });
      };
    }

    const match = url.pathname.match(/^\/api\/live-sessions\/([^/]+)\/events$/);
    if (!match) {
      onEvent({ type: 'open' });
      onEvent({ type: 'error', message: `Remote stream not supported yet: ${path}` });
      return () => {
        onEvent({ type: 'close' });
      };
    }

    const threadId = decodeURIComponent(match[1] ?? '');
    const thread = await this.readThread(threadId);
    onEvent({ type: 'open' });
    onEvent({
      type: 'message',
      data: JSON.stringify({
        type: 'snapshot',
        blocks: thread.detail.blocks,
        blockOffset: thread.detail.blockOffset,
        totalBlocks: thread.detail.totalBlocks,
      }),
    });

    try {
      await this.client.request('thread/resume', { threadId });
    } catch {
      // Best effort only. A not-yet-live thread can still serve a snapshot.
    }

    const pendingToolStarts = new Map<string, { toolName: string; args: Record<string, unknown> }>();
    const unsubscribe = this.client.subscribeNotifications((notification) => {
      switch (notification.method) {
        case 'thread/status/changed': {
          const params = notification.params as { threadId?: string; status?: { type?: string } } | undefined;
          if (params?.threadId !== threadId) {
            return;
          }
          if (params.status?.type === 'active') {
            onEvent({ type: 'message', data: JSON.stringify({ type: 'agent_start' }) });
          }
          return;
        }
        case 'turn/started': {
          const params = notification.params as { threadId?: string; turn?: { id?: string } } | undefined;
          if (params?.threadId !== threadId || typeof params.turn?.id !== 'string') {
            return;
          }
          this.activeTurnIds.set(threadId, params.turn.id);
          return;
        }
        case 'item/agentMessage/delta': {
          const params = notification.params as { threadId?: string; delta?: string } | undefined;
          if (params?.threadId !== threadId || typeof params.delta !== 'string') {
            return;
          }
          onEvent({ type: 'message', data: JSON.stringify({ type: 'text_delta', delta: params.delta }) });
          return;
        }
        case 'item/reasoning/textDelta': {
          const params = notification.params as { threadId?: string; delta?: string } | undefined;
          if (params?.threadId !== threadId || typeof params.delta !== 'string') {
            return;
          }
          onEvent({ type: 'message', data: JSON.stringify({ type: 'thinking_delta', delta: params.delta }) });
          return;
        }
        case 'item/started': {
          const params = notification.params as { threadId?: string; item?: CodexThreadItem } | undefined;
          if (params?.threadId !== threadId || !params.item || params.item.type !== 'dynamicToolCall') {
            return;
          }
          pendingToolStarts.set(params.item.id, {
            toolName: params.item.tool,
            args: (params.item.arguments ?? {}) as Record<string, unknown>,
          });
          onEvent({
            type: 'message',
            data: JSON.stringify({
              type: 'tool_start',
              toolCallId: params.item.id,
              toolName: params.item.tool,
              args: (params.item.arguments ?? {}) as Record<string, unknown>,
            }),
          });
          return;
        }
        case 'item/completed': {
          const params = notification.params as { threadId?: string; item?: CodexThreadItem } | undefined;
          if (params?.threadId !== threadId || !params.item) {
            return;
          }
          if (params.item.type === 'dynamicToolCall') {
            const started = pendingToolStarts.get(params.item.id);
            pendingToolStarts.delete(params.item.id);
            onEvent({
              type: 'message',
              data: JSON.stringify({
                type: 'tool_end',
                toolCallId: params.item.id,
                toolName: started?.toolName ?? params.item.tool,
                isError: params.item.status === 'failed',
                durationMs: params.item.durationMs ?? 0,
                output: (params.item.contentItems ?? [])
                  .filter((entry): entry is Extract<NonNullable<typeof params.item.contentItems>[number], { type: 'inputText' }> => entry.type === 'inputText')
                  .map((entry) => entry.text)
                  .join(''),
              }),
            });
          }
          return;
        }
        case 'turn/completed': {
          const params = notification.params as { threadId?: string } | undefined;
          if (params?.threadId !== threadId) {
            return;
          }
          this.activeTurnIds.delete(threadId);
          onEvent({ type: 'message', data: JSON.stringify({ type: 'agent_end' }) });
          onEvent({ type: 'message', data: JSON.stringify({ type: 'turn_end' }) });
          return;
        }
        case 'thread/name/updated': {
          const params = notification.params as { threadId?: string; name?: string } | undefined;
          if (params?.threadId !== threadId || typeof params.name !== 'string') {
            return;
          }
          onEvent({ type: 'message', data: JSON.stringify({ type: 'title_update', title: params.name }) });
          return;
        }
        case 'error': {
          const params = notification.params as { threadId?: string; error?: { message?: string } } | undefined;
          if (params?.threadId !== threadId) {
            return;
          }
          onEvent({ type: 'message', data: JSON.stringify({ type: 'error', message: params.error?.message ?? 'Remote workspace error' }) });
        }
      }
    });

    return () => {
      unsubscribe();
      onEvent({ type: 'close' });
    };
  }

  private async readThread(threadId: string): Promise<{ thread: CodexThread; detail: ReturnType<typeof buildSessionDetailFromCodexThread>; model: string; isLoaded: boolean }> {
    const response = await this.client.request<ThreadReadResult>('thread/read', { threadId, includeTurns: true });
    const cached = this.threadRuntimeCache.get(threadId);
    const defaultModel = await this.readDefaultModel();
    const model = cached?.model || this.sessionMetaCache.get(threadId)?.model || defaultModel.model;
    const detail = buildSessionDetailFromCodexThread({
      thread: response.thread,
      model,
    });
    const loadedIds = await this.readLoadedThreadIds();
    const meta = loadedIds.has(threadId) ? { ...detail.meta, isLive: true } : detail.meta;
    this.sessionMetaCache.set(threadId, meta);
    return { thread: response.thread, detail: { ...detail, meta }, model, isLoaded: loadedIds.has(threadId) };
  }

  private async readLoadedThreadIds(): Promise<Set<string>> {
    const result = await this.client.request<ThreadLoadedListResult>('thread/loaded/list', {});
    return new Set(result.data);
  }

  private async readDefaultModel(): Promise<{ model: string; thinkingLevel: string }> {
    const models = await this.client.request<ModelListResult>('model/list', {});
    const current = models.data.find((entry) => entry.isDefault) ?? models.data[0] ?? null;
    return {
      model: current?.model ?? '',
      thinkingLevel: typeof current?.defaultReasoningEffort === 'string' ? current.defaultReasoningEffort : 'medium',
    };
  }
}
