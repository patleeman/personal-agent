import { PassThrough, Readable, Writable } from 'node:stream';

import * as acp from '@agentclientprotocol/sdk';
import type { ExtensionProtocolContext } from '@personal-agent/extensions';
import { afterEach, describe, expect, it } from 'vitest';

import { runAcpProtocol } from '../backend.js';

type Block = Record<string, unknown>;
type ConversationRecord = {
  id: string;
  cwd: string;
  title: string | null;
  blocks: Block[];
  subscribers: Array<(event: unknown) => void>;
  pendingCancel?: { resolve: () => void } | null;
};

class TestClient {
  public readonly updates: acp.SessionNotification[] = [];

  async sessionUpdate(params: acp.SessionNotification): Promise<void> {
    this.updates.push(params);
  }

  async requestPermission(_params: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    throw new Error('permission requests not expected in ACP test harness');
  }

  async readTextFile(_params: acp.ReadTextFileRequest): Promise<acp.ReadTextFileResponse> {
    return { content: '' };
  }

  async writeTextFile(_params: acp.WriteTextFileRequest): Promise<acp.WriteTextFileResponse> {
    return {};
  }
}

function createProtocolHarness() {
  const abortController = new AbortController();
  const storage = new Map<string, unknown>();
  const conversations = new Map<string, ConversationRecord>();
  let conversationCounter = 0;

  function emit(conversationId: string, event: unknown) {
    const record = conversations.get(conversationId);
    if (!record) return;
    for (const subscriber of record.subscribers) {
      subscriber(event);
    }
  }

  function createConversation(cwd: string): ConversationRecord {
    conversationCounter += 1;
    const record: ConversationRecord = {
      id: `conv-${conversationCounter}`,
      cwd,
      title: null,
      blocks: [],
      subscribers: [],
      pendingCancel: null,
    };
    conversations.set(record.id, record);
    return record;
  }

  const ctx: ExtensionProtocolContext = {
    extensionId: 'system-acp',
    profile: 'shared',
    runtimeDir: '/tmp/runtime',
    profileSettingsFilePath: '/tmp/settings.json',
    protocolId: 'acp',
    stdio: {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    },
    signal: abortController.signal,
    runtime: {
      getLiveSessionResourceOptions: () => ({
        additionalExtensionPaths: [],
        additionalSkillPaths: [],
        additionalPromptTemplatePaths: [],
        additionalThemePaths: [],
      }),
      getRepoRoot: () => process.cwd(),
    },
    storage: {
      get: async (key) => (storage.has(key) ? (storage.get(key) as any) : null),
      put: async (key, value) => {
        storage.set(key, value);
        return { ok: true as const };
      },
      delete: async (key) => {
        const deleted = storage.delete(key);
        return { ok: true as const, deleted };
      },
      list: async (prefix = '') =>
        [...storage.entries()].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, value: value as any })),
    },
    runs: {},
    automations: {},
    vault: {},
    workspace: {},
    git: {},
    models: {},
    shell: {
      exec: async () => ({ command: '', args: [], stdout: '', stderr: '', executionWrappers: [] }),
    },
    notify: {
      toast: () => undefined,
      system: () => false,
      setBadge: () => ({ badge: 0, aggregated: 0 }),
      clearBadge: () => undefined,
      isSystemAvailable: () => false,
    },
    events: {
      publish: async () => undefined,
      subscribe: () => ({ unsubscribe: () => undefined }),
    },
    extensions: {
      callAction: async () => undefined,
      listActions: async () => [],
      getStatus: async () => ({ enabled: false, healthy: false }),
      setEnabled: () => undefined,
    },
    secrets: {
      get: () => undefined,
    },
    ui: {
      invalidate: () => undefined,
    },
    telemetry: {
      record: () => undefined,
    },
    log: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    conversations: {
      list: async () => [],
      getMeta: async (conversationId: string) => {
        const record = conversations.get(conversationId);
        if (!record) throw new Error('Conversation not found');
        return {
          id: record.id,
          title: record.title,
          cwd: record.cwd,
        };
      },
      get: async () => ({}),
      getBlocks: async (conversationId: string) => {
        const record = conversations.get(conversationId);
        if (!record) throw new Error('Conversation not found');
        return { blocks: record.blocks };
      },
      searchIndex: async () => ({}),
      create: async (input?: { cwd?: string }) => {
        const record = createConversation(input?.cwd ?? process.cwd());
        return { id: record.id, conversationId: record.id };
      },
      ensureLive: async (conversationId: string) => {
        const record = conversations.get(conversationId);
        if (!record) throw new Error('Conversation not found');
        return { id: record.id, conversationId: record.id };
      },
      fork: async (input: { conversationId: string; cwd?: string }) => {
        const source = conversations.get(input.conversationId);
        if (!source) throw new Error('Conversation not found');
        const record = createConversation(input.cwd ?? source.cwd);
        record.title = source.title;
        record.blocks = structuredClone(source.blocks);
        return { id: record.id, conversationId: record.id };
      },
      sendMessage: async (conversationId: string, text: string) => {
        const record = conversations.get(conversationId);
        if (!record) throw new Error('Conversation not found');
        record.blocks.push({ type: 'user', text, id: crypto.randomUUID(), ts: new Date().toISOString() });
        emit(conversationId, {
          type: 'user_message',
          block: { type: 'user', text, id: crypto.randomUUID(), ts: new Date().toISOString() },
        });

        if (text.includes('hang forever')) {
          await new Promise<void>((resolve) => {
            record.pendingCancel = { resolve };
          });
          record.pendingCancel = null;
          return { accepted: true };
        }

        emit(conversationId, { type: 'thinking_delta', delta: 'thinking…' });
        emit(conversationId, { type: 'text_delta', delta: 'hello ' });
        emit(conversationId, { type: 'tool_start', toolCallId: 'tool-1', toolName: 'read', args: { path: 'README.md' } });
        emit(conversationId, { type: 'tool_update', toolCallId: 'tool-1', partialResult: { chunk: 1 } });
        emit(conversationId, {
          type: 'tool_end',
          toolCallId: 'tool-1',
          toolName: 'read',
          isError: false,
          durationMs: 12,
          output: 'file contents',
          details: { content: 'file contents' },
        });
        emit(conversationId, { type: 'text_delta', delta: 'world' });
        record.title = 'ACP Session';
        record.blocks.push({
          type: 'tool_use',
          tool: 'read',
          toolCallId: 'tool-1',
          input: { path: 'README.md' },
          output: 'file contents',
          id: crypto.randomUUID(),
          ts: new Date().toISOString(),
        });
        record.blocks.push({ type: 'text', text: 'hello world', id: crypto.randomUUID(), ts: new Date().toISOString() });
        emit(conversationId, { type: 'title_update', title: 'ACP Session' });
        emit(conversationId, { type: 'stats_update', tokens: { input: 1, output: 2, total: 3, cacheRead: 0, cacheWrite: 0 } });
        emit(conversationId, { type: 'turn_end' });
        return { accepted: true };
      },
      abort: async (conversationId: string) => {
        const record = conversations.get(conversationId);
        record?.pendingCancel?.resolve();
        return { ok: true };
      },
      appendVisibleCustomMessage: async () => ({ ok: true }),
      setTitle: async (conversationId: string, title: string) => {
        const record = conversations.get(conversationId);
        if (record) record.title = title;
        return { ok: true };
      },
      compact: async () => ({ ok: true }),
      appendTranscriptBlock: async () => ({ blockId: crypto.randomUUID() }),
      updateTranscriptBlock: async () => ({ blockId: crypto.randomUUID() }),
      subscribe: (conversationId: string, handler: (event: unknown) => void) => {
        const record = conversations.get(conversationId);
        if (!record) return null;
        record.subscribers.push(handler);
        return () => {
          record.subscribers = record.subscribers.filter((candidate) => candidate !== handler);
        };
      },
    } as ExtensionProtocolContext['conversations'],
  };

  const clientToAgent = new PassThrough();
  const agentToClient = new PassThrough();
  ctx.stdio.stdin = clientToAgent;
  ctx.stdio.stdout = agentToClient;

  const client = new TestClient();
  const clientConnection = new acp.ClientSideConnection(
    () => client,
    acp.ndJsonStream(Writable.toWeb(clientToAgent), Readable.toWeb(agentToClient)),
  );

  const runPromise = runAcpProtocol({}, ctx);

  return {
    abortController,
    client,
    clientConnection,
    conversations,
    runPromise,
  };
}

afterEach(() => {
  // no-op; each test owns its own abort controller
});

describe('system-acp protocol', () => {
  it('supports the exposed ACP session lifecycle and prompt streaming with the official client SDK', async () => {
    const harness = createProtocolHarness();
    const init = await harness.clientConnection.initialize({
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: 'vitest-client', version: '1.0.0' },
    });
    expect(init.agentCapabilities?.loadSession).toBe(true);
    expect(init.agentCapabilities?.sessionCapabilities?.list).toEqual({});
    expect(init.agentCapabilities?.sessionCapabilities?.resume).toEqual({});
    expect(init.agentCapabilities?.sessionCapabilities?.close).toEqual({});
    expect(init.agentCapabilities?.sessionCapabilities?.fork).toEqual({});

    const created = await harness.clientConnection.newSession({ cwd: '/repo', mcpServers: [] });
    expect(created.sessionId).toBeTruthy();
    expect(created.modes?.currentModeId).toBe('code');

    const listed = await harness.clientConnection.listSessions({ cwd: '/repo' });
    expect(listed.sessions).toHaveLength(1);
    expect(listed.sessions[0]?.sessionId).toBe(created.sessionId);

    await harness.clientConnection.setSessionMode({ sessionId: created.sessionId, modeId: 'ask' });
    const resumed = await harness.clientConnection.resumeSession({ sessionId: created.sessionId, cwd: '/repo', mcpServers: [] });
    expect(resumed.modes?.currentModeId).toBe('ask');

    const promptResult = await harness.clientConnection.prompt({
      sessionId: created.sessionId,
      messageId: crypto.randomUUID(),
      prompt: [{ type: 'text', text: 'say hello' }],
    });
    expect(promptResult.stopReason).toBe('end_turn');

    const updateKinds = harness.client.updates.map((update) => update.update.sessionUpdate);
    expect(updateKinds).toContain('agent_message_chunk');
    expect(updateKinds).toContain('agent_thought_chunk');
    expect(updateKinds).toContain('tool_call');
    expect(updateKinds).toContain('tool_call_update');
    expect(updateKinds).toContain('usage_update');
    expect(updateKinds).toContain('session_info_update');

    harness.client.updates.length = 0;
    const loaded = await harness.clientConnection.loadSession({ sessionId: created.sessionId, cwd: '/repo', mcpServers: [] });
    expect(loaded.sessionId).toBe(created.sessionId);
    expect(harness.client.updates.some((update) => update.update.sessionUpdate === 'user_message_chunk')).toBe(true);
    expect(harness.client.updates.some((update) => update.update.sessionUpdate === 'tool_call')).toBe(true);

    const forked = await harness.clientConnection.unstable_forkSession({ sessionId: created.sessionId, cwd: '/repo-fork', mcpServers: [] });
    expect(forked.sessionId).not.toBe(created.sessionId);
    const listedAgain = await harness.clientConnection.listSessions({});
    expect(listedAgain.sessions).toHaveLength(2);

    await harness.clientConnection.closeSession({ sessionId: created.sessionId });

    harness.abortController.abort();
    await harness.runPromise;
  });

  it('reports cancelled stopReason when the client cancels an active prompt', async () => {
    const harness = createProtocolHarness();
    await harness.clientConnection.initialize({ protocolVersion: acp.PROTOCOL_VERSION, clientCapabilities: {} });
    const created = await harness.clientConnection.newSession({ cwd: '/repo', mcpServers: [] });

    const pendingPrompt = harness.clientConnection.prompt({
      sessionId: created.sessionId,
      prompt: [{ type: 'text', text: 'hang forever' }],
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    await harness.clientConnection.cancel({ sessionId: created.sessionId });
    const result = await pendingPrompt;
    expect(result.stopReason).toBe('cancelled');

    harness.abortController.abort();
    await harness.runPromise;
  });
});
