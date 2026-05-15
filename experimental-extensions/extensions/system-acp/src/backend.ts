import { Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';
import type { ExtensionProtocolContext } from '@personal-agent/extensions';

const SESSION_KEY_PREFIX = 'session/';
const DEFAULT_MODE_ID = 'code';
const MODES: acp.SessionMode[] = [
  { id: 'code', name: 'Code', description: 'Normal coding-agent mode for Personal Agent.' },
  { id: 'ask', name: 'Ask', description: 'Discussion-oriented mode for lighter guidance.' },
];

type StoredSessionRecord = {
  sessionId: string;
  conversationId: string;
  cwd: string;
  additionalDirectories: string[];
  currentModeId: string;
  updatedAt: string;
  title?: string | null;
};

type ActivePrompt = {
  abortController: AbortController;
  currentAgentMessageId: string;
  currentThinkingMessageId: string;
};

function sessionKey(sessionId: string): string {
  return `${SESSION_KEY_PREFIX}${sessionId}`;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function toToolKind(toolName: string | undefined): acp.ToolKind {
  const name = (toolName ?? '').toLowerCase();
  if (name.includes('read')) return 'read';
  if (name.includes('write') || name.includes('edit')) return 'edit';
  if (name.includes('delete') || name.includes('remove')) return 'delete';
  if (name.includes('move') || name.includes('rename')) return 'move';
  if (name.includes('search') || name.includes('grep') || name.includes('find')) return 'search';
  if (name.includes('bash') || name.includes('exec') || name.includes('command')) return 'execute';
  if (name.includes('web')) return 'fetch';
  if (name.includes('think')) return 'think';
  return 'other';
}

function contentBlockToText(block: acp.ContentBlock): string {
  switch (block.type) {
    case 'text':
      return block.text;
    case 'resource_link':
      return [`Resource: ${block.name}`, block.uri, block.description ?? ''].filter(Boolean).join('\n');
    case 'resource': {
      const text = 'text' in block.resource ? block.resource.text : block.resource.blob;
      return [`Embedded resource: ${block.resource.uri}`, asText(text)].join('\n');
    }
    case 'image':
      return `[image] ${block.mimeType ?? 'unknown'} ${block.uri ?? ''}`.trim();
    case 'audio':
      return `[audio] ${block.mimeType ?? 'unknown'}`;
    default:
      return asText(block);
  }
}

function promptToText(blocks: acp.ContentBlock[]): string {
  return blocks.map(contentBlockToText).join('\n\n').trim();
}

async function readSessionRecord(ctx: ExtensionProtocolContext, sessionId: string): Promise<StoredSessionRecord | null> {
  return ctx.storage.get<StoredSessionRecord>(sessionKey(sessionId));
}

async function writeSessionRecord(ctx: ExtensionProtocolContext, record: StoredSessionRecord): Promise<void> {
  await ctx.storage.put(sessionKey(record.sessionId), record);
}

async function listSessionRecords(ctx: ExtensionProtocolContext): Promise<StoredSessionRecord[]> {
  const entries = await ctx.storage.list<StoredSessionRecord>(SESSION_KEY_PREFIX);
  return entries.map((entry) => entry.value).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

async function refreshSessionRecord(ctx: ExtensionProtocolContext, sessionId: string): Promise<StoredSessionRecord> {
  const record = await readSessionRecord(ctx, sessionId);
  if (!record) {
    throw new Error(`ACP session not found: ${sessionId}`);
  }
  const meta = (await ctx.conversations.getMeta(record.conversationId)) as Record<string, unknown>;
  const next: StoredSessionRecord = {
    ...record,
    cwd: typeof meta.cwd === 'string' && meta.cwd ? meta.cwd : record.cwd,
    title: typeof meta.title === 'string' ? meta.title : record.title,
    updatedAt: new Date().toISOString(),
  };
  await writeSessionRecord(ctx, next);
  return next;
}

async function ensureLiveConversation(ctx: ExtensionProtocolContext, record: StoredSessionRecord): Promise<StoredSessionRecord> {
  const ensured = (await ctx.conversations.ensureLive(record.conversationId, { cwd: record.cwd })) as {
    id: string;
    conversationId: string;
  };
  const next = { ...record, conversationId: ensured.conversationId, updatedAt: new Date().toISOString() };
  await writeSessionRecord(ctx, next);
  return next;
}

function buildModes(currentModeId: string): acp.SessionModeState {
  return {
    availableModes: MODES,
    currentModeId,
  };
}

function buildSessionInfo(record: StoredSessionRecord): acp.SessionInfo {
  return {
    sessionId: record.sessionId,
    cwd: record.cwd,
    title: record.title ?? null,
    updatedAt: record.updatedAt,
    ...(record.additionalDirectories.length > 0 ? { additionalDirectories: record.additionalDirectories } : {}),
  };
}

class PersonalAgentAcpAgent implements acp.Agent {
  private readonly activePrompts = new Map<string, ActivePrompt>();

  constructor(
    private readonly connection: acp.AgentSideConnection,
    private readonly ctx: ExtensionProtocolContext,
  ) {}

  async initialize(_params: acp.InitializeRequest): Promise<acp.InitializeResponse> {
    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentInfo: {
        name: 'personal-agent',
        title: 'Personal Agent',
        version: '0.8.0',
      },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: {
          embeddedContext: true,
          image: true,
        },
        sessionCapabilities: {
          list: {},
          resume: {},
          close: {},
          fork: {},
          additionalDirectories: {},
        },
      },
    };
  }

  async authenticate(_params: acp.AuthenticateRequest): Promise<acp.AuthenticateResponse> {
    return {};
  }

  async newSession(params: acp.NewSessionRequest): Promise<acp.NewSessionResponse> {
    const created = (await this.ctx.conversations.create({ cwd: params.cwd })) as { conversationId: string };
    const sessionId = crypto.randomUUID();
    const record: StoredSessionRecord = {
      sessionId,
      conversationId: created.conversationId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories ?? [],
      currentModeId: DEFAULT_MODE_ID,
      updatedAt: new Date().toISOString(),
      title: null,
    };
    await writeSessionRecord(this.ctx, record);
    return {
      sessionId,
      modes: buildModes(record.currentModeId),
    };
  }

  async loadSession(params: acp.LoadSessionRequest): Promise<acp.LoadSessionResponse> {
    const record = await ensureLiveConversation(this.ctx, await refreshSessionRecord(this.ctx, params.sessionId));
    await this.replayConversation(record);
    return {
      sessionId: record.sessionId,
      modes: buildModes(record.currentModeId),
    };
  }

  async unstable_forkSession(params: acp.ForkSessionRequest): Promise<acp.ForkSessionResponse> {
    const record = await ensureLiveConversation(this.ctx, await refreshSessionRecord(this.ctx, params.sessionId));
    const forked = (await this.ctx.conversations.fork({
      conversationId: record.conversationId,
      cwd: params.cwd,
      title: record.title ?? undefined,
    })) as { conversationId: string };
    const next: StoredSessionRecord = {
      sessionId: crypto.randomUUID(),
      conversationId: forked.conversationId,
      cwd: params.cwd,
      additionalDirectories: params.additionalDirectories ?? record.additionalDirectories,
      currentModeId: record.currentModeId,
      updatedAt: new Date().toISOString(),
      title: record.title ?? null,
    };
    await writeSessionRecord(this.ctx, next);
    return {
      sessionId: next.sessionId,
      modes: buildModes(next.currentModeId),
    };
  }

  async listSessions(params: acp.ListSessionsRequest): Promise<acp.ListSessionsResponse> {
    const records = (await listSessionRecords(this.ctx)).filter((record) => {
      if (params.cwd && record.cwd !== params.cwd) return false;
      if ((params.additionalDirectories?.length ?? 0) > 0) {
        return JSON.stringify(record.additionalDirectories) === JSON.stringify(params.additionalDirectories ?? []);
      }
      return true;
    });
    return { sessions: records.map(buildSessionInfo) };
  }

  async resumeSession(params: acp.ResumeSessionRequest): Promise<acp.ResumeSessionResponse> {
    const record = await ensureLiveConversation(this.ctx, await refreshSessionRecord(this.ctx, params.sessionId));
    return {
      sessionId: record.sessionId,
      modes: buildModes(record.currentModeId),
    };
  }

  async closeSession(params: acp.CloseSessionRequest): Promise<acp.CloseSessionResponse> {
    await this.cancel({ sessionId: params.sessionId });
    return {};
  }

  async setSessionMode(params: acp.SetSessionModeRequest): Promise<acp.SetSessionModeResponse> {
    const record = await refreshSessionRecord(this.ctx, params.sessionId);
    const next = { ...record, currentModeId: params.modeId, updatedAt: new Date().toISOString() };
    await writeSessionRecord(this.ctx, next);
    await this.connection.sessionUpdate({
      sessionId: params.sessionId,
      update: {
        sessionUpdate: 'current_mode_update',
        currentModeId: params.modeId,
      },
    });
    return {};
  }

  async prompt(params: acp.PromptRequest): Promise<acp.PromptResponse> {
    const record = await ensureLiveConversation(this.ctx, await refreshSessionRecord(this.ctx, params.sessionId));
    const text = promptToText(params.prompt);
    const active: ActivePrompt = {
      abortController: new AbortController(),
      currentAgentMessageId: crypto.randomUUID(),
      currentThinkingMessageId: crypto.randomUUID(),
    };
    this.activePrompts.get(params.sessionId)?.abortController.abort();
    this.activePrompts.set(params.sessionId, active);

    const unsubscribe = this.ctx.conversations.subscribe(record.conversationId, (event) => {
      void this.forwardEvent(record.sessionId, event, active);
    });

    try {
      await this.ctx.conversations.sendMessage(record.conversationId, text, { steer: false });
      const updated = await refreshSessionRecord(this.ctx, params.sessionId);
      this.activePrompts.delete(params.sessionId);
      await this.connection.sessionUpdate({
        sessionId: record.sessionId,
        update: {
          sessionUpdate: 'session_info_update',
          title: updated.title ?? null,
          updatedAt: updated.updatedAt,
        },
      });
      return {
        stopReason: active.abortController.signal.aborted ? 'cancelled' : 'end_turn',
        ...(params.messageId ? { userMessageId: params.messageId } : {}),
      };
    } finally {
      unsubscribe?.();
      this.activePrompts.delete(params.sessionId);
    }
  }

  async cancel(params: acp.CancelNotification): Promise<void> {
    const active = this.activePrompts.get(params.sessionId);
    active?.abortController.abort();
    const record = await readSessionRecord(this.ctx, params.sessionId);
    if (record) {
      try {
        await this.ctx.conversations.abort(record.conversationId);
      } catch {
        // ignore best-effort aborts
      }
    }
  }

  async unstable_didOpenDocument(_params: acp.DidOpenDocumentNotification): Promise<void> {}
  async unstable_didChangeDocument(_params: acp.DidChangeDocumentNotification): Promise<void> {}
  async unstable_didCloseDocument(_params: acp.DidCloseDocumentNotification): Promise<void> {}
  async unstable_didSaveDocument(_params: acp.DidSaveDocumentNotification): Promise<void> {}
  async unstable_didFocusDocument(_params: acp.DidFocusDocumentNotification): Promise<void> {}

  private async replayConversation(record: StoredSessionRecord): Promise<void> {
    const detail = (await this.ctx.conversations.getBlocks(record.conversationId)) as { blocks?: Array<Record<string, unknown>> };
    for (const block of detail.blocks ?? []) {
      await this.forwardHistoricalBlock(record.sessionId, block);
    }
    await this.connection.sessionUpdate({
      sessionId: record.sessionId,
      update: {
        sessionUpdate: 'session_info_update',
        title: record.title ?? null,
        updatedAt: record.updatedAt,
      },
    });
  }

  private async forwardHistoricalBlock(sessionId: string, block: Record<string, unknown>): Promise<void> {
    const type = typeof block.type === 'string' ? block.type : '';
    if (type === 'user') {
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'user_message_chunk',
          messageId: crypto.randomUUID(),
          content: { type: 'text', text: typeof block.text === 'string' ? block.text : '' },
        },
      });
      return;
    }
    if (type === 'text') {
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: crypto.randomUUID(),
          content: { type: 'text', text: typeof block.text === 'string' ? block.text : '' },
        },
      });
      return;
    }
    if (type === 'thinking') {
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_thought_chunk',
          messageId: crypto.randomUUID(),
          content: { type: 'text', text: typeof block.text === 'string' ? block.text : '' },
        },
      });
      return;
    }
    if (type === 'tool_use') {
      const toolCallId = typeof block.toolCallId === 'string' ? block.toolCallId : crypto.randomUUID();
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId,
          title: typeof block.tool === 'string' ? block.tool : 'tool',
          kind: toToolKind(typeof block.tool === 'string' ? block.tool : undefined),
          status: 'completed',
          rawInput: block.input,
          rawOutput: block.output,
        },
      });
      return;
    }
    if (type === 'error') {
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          messageId: crypto.randomUUID(),
          content: { type: 'text', text: typeof block.message === 'string' ? block.message : 'Unknown error' },
        },
      });
    }
  }

  private async forwardEvent(sessionId: string, event: unknown, active: ActivePrompt): Promise<void> {
    const payload = event as Record<string, unknown>;
    switch (payload.type) {
      case 'text_delta':
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            messageId: active.currentAgentMessageId,
            content: { type: 'text', text: typeof payload.delta === 'string' ? payload.delta : '' },
          },
        });
        return;
      case 'thinking_delta':
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'agent_thought_chunk',
            messageId: active.currentThinkingMessageId,
            content: { type: 'text', text: typeof payload.delta === 'string' ? payload.delta : '' },
          },
        });
        return;
      case 'tool_start':
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: asText(payload.toolCallId),
            title: typeof payload.toolName === 'string' ? payload.toolName : 'tool',
            kind: toToolKind(typeof payload.toolName === 'string' ? payload.toolName : undefined),
            status: 'in_progress',
            rawInput: payload.args,
          },
        });
        return;
      case 'tool_update':
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: asText(payload.toolCallId),
            rawOutput: payload.partialResult,
            status: 'in_progress',
          },
        });
        return;
      case 'tool_end':
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: asText(payload.toolCallId),
            status: payload.isError === true ? 'failed' : 'completed',
            title: typeof payload.toolName === 'string' ? payload.toolName : 'tool',
            kind: toToolKind(typeof payload.toolName === 'string' ? payload.toolName : undefined),
            rawOutput: payload.details ?? payload.output,
            ...(typeof payload.output === 'string'
              ? {
                  content: [
                    {
                      type: 'content',
                      content: {
                        type: 'text',
                        text: payload.output,
                      },
                    },
                  ],
                }
              : {}),
          },
        });
        return;
      case 'title_update':
        await this.connection.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: 'session_info_update',
            title: typeof payload.title === 'string' ? payload.title : null,
            updatedAt: new Date().toISOString(),
          },
        });
        return;
      case 'stats_update': {
        const tokens = payload.tokens as Record<string, unknown> | undefined;
        const used = typeof tokens?.total === 'number' ? tokens.total : 0;
        if (used > 0) {
          await this.connection.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: 'usage_update',
              used,
              size: used,
            },
          });
        }
        return;
      }
      default:
        return;
    }
  }
}

export async function runAcpProtocol(_input: unknown, ctx: ExtensionProtocolContext): Promise<void> {
  const stream = acp.ndJsonStream(Writable.toWeb(ctx.stdio.stdout), Readable.toWeb(ctx.stdio.stdin));
  const connection = new acp.AgentSideConnection((agentConnection) => new PersonalAgentAcpAgent(agentConnection, ctx), stream);
  await Promise.race([
    connection.closed,
    new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true })),
  ]);
}
