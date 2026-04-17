import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';

const mocks = vi.hoisted(() => {
  let streamListener: ((event: { type: 'open' | 'message' | 'error' | 'close'; data?: string; message?: string }) => void) | null = null;
  const unsubscribeMock = vi.fn();

  return {
    readDesktopSessions: vi.fn(),
    readDesktopModels: vi.fn(),
    readDesktopConversationBootstrap: vi.fn(),
    createDesktopLiveSession: vi.fn(),
    forkDesktopConversation: vi.fn(),
    resumeDesktopLiveSession: vi.fn(),
    rollbackDesktopConversation: vi.fn(),
    submitDesktopLiveSessionPrompt: vi.fn(),
    renameDesktopConversation: vi.fn(),
    readDesktopOpenConversationTabs: vi.fn(),
    updateDesktopOpenConversationTabs: vi.fn(),
    abortDesktopLiveSession: vi.fn(),
    subscribeDesktopLocalApiStream: vi.fn(async (_path: string, onEvent: (event: { type: 'open' | 'message' | 'error' | 'close'; data?: string; message?: string }) => void) => {
      streamListener = onEvent;
      return unsubscribeMock;
    }),
    getStreamListener: () => streamListener,
    resetStreamListener: () => {
      streamListener = null;
    },
    unsubscribeMock,
  };
});

vi.mock('./app/localApi.js', () => ({
  readDesktopSessions: mocks.readDesktopSessions,
  readDesktopModels: mocks.readDesktopModels,
  abortDesktopLiveSession: mocks.abortDesktopLiveSession,
  readDesktopConversationBootstrap: mocks.readDesktopConversationBootstrap,
  createDesktopLiveSession: mocks.createDesktopLiveSession,
  forkDesktopConversation: mocks.forkDesktopConversation,
  readDesktopOpenConversationTabs: mocks.readDesktopOpenConversationTabs,
  resumeDesktopLiveSession: mocks.resumeDesktopLiveSession,
  rollbackDesktopConversation: mocks.rollbackDesktopConversation,
  submitDesktopLiveSessionPrompt: mocks.submitDesktopLiveSessionPrompt,
  renameDesktopConversation: mocks.renameDesktopConversation,
  subscribeDesktopLocalApiStream: mocks.subscribeDesktopLocalApiStream,
  updateDesktopOpenConversationTabs: mocks.updateDesktopOpenConversationTabs,
}));

import { startCodexAppServer } from './codex-app-server.js';

async function connectWebSocket(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
    socket.once('unexpected-response', async (_request, response) => {
      let body = '';
      for await (const chunk of response) {
        body += chunk.toString();
      }
      reject(new Error(`${String(response.statusCode ?? 500)} ${body}`.trim()));
    });
  });
}

async function readJsonMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    socket.once('message', (data) => {
      try {
        resolve(JSON.parse(data.toString()) as unknown);
      } catch (error) {
        reject(error);
      }
    });
    socket.once('error', reject);
  });
}

async function readJsonMessages(socket: WebSocket, count: number): Promise<unknown[]> {
  const messages: unknown[] = [];
  for (let index = 0; index < count; index += 1) {
    messages.push(await readJsonMessage(socket));
  }
  return messages;
}

async function collectJsonMessages(socket: WebSocket, action: () => void | Promise<void>, waitMs = 50): Promise<unknown[]> {
  const messages: unknown[] = [];
  const listener = (data: WebSocket.RawData) => {
    messages.push(JSON.parse(data.toString()) as unknown);
  };
  socket.on('message', listener);
  await action();
  await new Promise((resolve) => setTimeout(resolve, waitMs));
  socket.off('message', listener);
  return messages;
}

describe('codex app server', () => {
  let server: Awaited<ReturnType<typeof startCodexAppServer>> | null = null;

  beforeEach(() => {
    mocks.readDesktopSessions.mockReset();
    mocks.readDesktopModels.mockReset();
    mocks.readDesktopConversationBootstrap.mockReset();
    mocks.createDesktopLiveSession.mockReset();
    mocks.forkDesktopConversation.mockReset();
    mocks.resumeDesktopLiveSession.mockReset();
    mocks.rollbackDesktopConversation.mockReset();
    mocks.submitDesktopLiveSessionPrompt.mockReset();
    mocks.renameDesktopConversation.mockReset();
    mocks.readDesktopOpenConversationTabs.mockReset();
    mocks.updateDesktopOpenConversationTabs.mockReset();
    mocks.abortDesktopLiveSession.mockReset();
    mocks.subscribeDesktopLocalApiStream.mockClear();
    mocks.unsubscribeMock.mockReset();
    mocks.resetStreamListener();
    mocks.readDesktopOpenConversationTabs.mockResolvedValue({
      sessionIds: [],
      pinnedSessionIds: [],
      archivedSessionIds: [],
      workspacePaths: [],
    });
    mocks.updateDesktopOpenConversationTabs.mockResolvedValue({
      ok: true,
      sessionIds: [],
      pinnedSessionIds: [],
      archivedSessionIds: [],
      workspacePaths: [],
    });
    mocks.abortDesktopLiveSession.mockResolvedValue({ ok: true });
  });

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('rejects requests before initialize', async () => {
    server = await startCodexAppServer({ listenUrl: 'ws://127.0.0.1:0' });
    const socket = await connectWebSocket(server.websocketUrl);

    socket.send(JSON.stringify({ id: 1, method: 'thread/list', params: {} }));

    await expect(readJsonMessage(socket)).resolves.toEqual({
      id: 1,
      error: { code: -32002, message: 'Not initialized.' },
    });

    socket.close();
  });

  it('initializes and serves model and thread reads', async () => {
    mocks.readDesktopModels.mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'medium',
      models: [
        { id: 'gpt-5.4', provider: 'openai-codex', name: 'GPT-5.4', reasoning: true },
      ],
    });
    mocks.readDesktopSessions.mockResolvedValue([
      {
        id: 'conversation-1',
        file: '/sessions/conversation-1.jsonl',
        timestamp: '2026-04-14T10:00:00.000Z',
        cwd: '/repo',
        cwdSlug: 'repo',
        model: 'gpt-5.4',
        title: 'Example conversation',
        messageCount: 1,
        isRunning: false,
        isLive: false,
        lastActivityAt: '2026-04-14T10:05:00.000Z',
      },
    ]);
    mocks.readDesktopConversationBootstrap.mockResolvedValue({
      conversationId: 'conversation-1',
      sessionDetail: {
        meta: {
          id: 'conversation-1',
          file: '/sessions/conversation-1.jsonl',
          timestamp: '2026-04-14T10:00:00.000Z',
          cwd: '/repo',
          cwdSlug: 'repo',
          model: 'gpt-5.4',
          title: 'Example conversation',
          messageCount: 1,
          isRunning: false,
          isLive: false,
          lastActivityAt: '2026-04-14T10:05:00.000Z',
        },
        blocks: [
          { type: 'user', id: 'u1', ts: '2026-04-14T10:00:00.000Z', text: 'Hello' },
          { type: 'text', id: 'a1', ts: '2026-04-14T10:00:01.000Z', text: 'Hi' },
        ],
        blockOffset: 0,
        totalBlocks: 2,
        contextUsage: null,
        signature: 'sig-1',
      },
      liveSession: { live: false },
    });

    server = await startCodexAppServer({ listenUrl: 'ws://127.0.0.1:0' });
    const socket = await connectWebSocket(server.websocketUrl);
    socket.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'test-client', title: 'Test Client', version: '0.0.1' },
      },
    }));

    const initializeResponse = await readJsonMessage(socket) as { id: number; result: Record<string, unknown> };
    expect(initializeResponse.id).toBe(1);
    expect(initializeResponse.result.userAgent).toBe('personal-agent-codex-app-server');
    expect(typeof initializeResponse.result.codexHome).toBe('string');

    socket.send(JSON.stringify({ method: 'initialized', params: {} }));
    socket.send(JSON.stringify({ id: 2, method: 'model/list', params: {} }));
    await expect(readJsonMessage(socket)).resolves.toEqual({
      id: 2,
      result: {
        data: [
          {
            id: 'gpt-5.4',
            model: 'gpt-5.4',
            upgrade: null,
            upgradeInfo: null,
            availabilityNux: null,
            displayName: 'GPT-5.4',
            description: 'GPT-5.4',
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: 'low', description: 'Low reasoning' },
              { reasoningEffort: 'medium', description: 'Medium reasoning' },
              { reasoningEffort: 'high', description: 'High reasoning' },
            ],
            defaultReasoningEffort: 'medium',
            inputModalities: ['text'],
            supportsPersonality: false,
            additionalSpeedTiers: [],
            isDefault: true,
          },
        ],
        nextCursor: null,
      },
    });

    socket.send(JSON.stringify({ id: 3, method: 'thread/list', params: {} }));
    const listResponse = await readJsonMessage(socket) as { id: number; result: { data: Array<Record<string, unknown>> } };
    expect(listResponse.id).toBe(3);
    expect(listResponse.result.data[0]?.id).toBe('conversation-1');
    expect(listResponse.result.data[0]?.cwd).toBe('/repo');

    socket.send(JSON.stringify({
      id: 4,
      method: 'thread/read',
      params: { threadId: 'conversation-1', includeTurns: true },
    }));
    const readResponse = await readJsonMessage(socket) as { id: number; result: { thread: Record<string, unknown> } };
    expect(readResponse.id).toBe(4);
    expect(readResponse.result.thread.id).toBe('conversation-1');
    expect(readResponse.result.thread.turns).toEqual([
      {
        id: 'conversation-1:turn:1',
        items: [
          { type: 'userMessage', id: 'u1', content: [{ type: 'text', text: 'Hello', textElements: [] }] },
          { type: 'agentMessage', id: 'a1', text: 'Hi', phase: null, memoryCitation: null },
        ],
        status: 'completed',
        error: null,
        startedAt: 1776160800,
        completedAt: 1776160801,
        durationMs: 1000,
      },
    ]);

    socket.close();
  });

  it('runs buffered command/exec requests', async () => {
    server = await startCodexAppServer({ listenUrl: 'ws://127.0.0.1:0' });
    const socket = await connectWebSocket(server.websocketUrl);
    socket.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'test-client', title: 'Test Client', version: '0.0.1' } },
    }));
    await readJsonMessage(socket);
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));

    socket.send(JSON.stringify({
      id: 2,
      method: 'command/exec',
      params: {
        command: [
          process.execPath,
          '-e',
          "process.stdout.write('out'); process.stderr.write('err'); process.exit(3);",
        ],
      },
    }));

    await expect(readJsonMessage(socket)).resolves.toEqual({
      id: 2,
      result: {
        exitCode: 3,
        stdout: 'out',
        stderr: 'err',
      },
    });

    socket.close();
  });

  it('supports command/exec stdin writes and streamed stdout', async () => {
    server = await startCodexAppServer({ listenUrl: 'ws://127.0.0.1:0' });
    const socket = await connectWebSocket(server.websocketUrl);
    socket.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'test-client', title: 'Test Client', version: '0.0.1' } },
    }));
    await readJsonMessage(socket);
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));

    const messages = collectJsonMessages(socket, async () => {
      socket.send(JSON.stringify({
        id: 2,
        method: 'command/exec',
        params: {
          processId: 'proc-1',
          command: [
            process.execPath,
            '-e',
            "let data='';process.stdin.setEncoding('utf8');process.stdin.on('data', (chunk) => data += chunk);process.stdin.on('end', () => process.stdout.write(data.toUpperCase()));",
          ],
          streamStdin: true,
          streamStdoutStderr: true,
        },
      }));

      socket.send(JSON.stringify({
        id: 3,
        method: 'command/exec/write',
        params: {
          processId: 'proc-1',
          deltaBase64: Buffer.from('hello').toString('base64'),
          closeStdin: true,
        },
      }));
    }, 250) as Promise<Array<{ id?: number; method?: string; result?: Record<string, unknown>; params?: Record<string, unknown> }>>;

    await expect(messages).resolves.toEqual(expect.arrayContaining([
      {
        id: 3,
        result: {},
      },
      {
        method: 'command/exec/outputDelta',
        params: {
          processId: 'proc-1',
          stream: 'stdout',
          deltaBase64: Buffer.from('HELLO').toString('base64'),
          capReached: false,
        },
      },
      {
        id: 2,
        result: {
          exitCode: 0,
          stdout: '',
          stderr: '',
        },
      },
    ]));

    socket.close();
  });

  it('starts threads and translates live-session stream notifications', async () => {
    mocks.readDesktopModels.mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'medium',
      models: [
        { id: 'gpt-5.4', provider: 'openai-codex', name: 'GPT-5.4', reasoning: true },
      ],
    });
    mocks.createDesktopLiveSession.mockResolvedValue({
      id: 'live-1',
      sessionFile: '/sessions/live-1.jsonl',
      bootstrap: {
        conversationId: 'live-1',
        sessionDetail: {
          meta: {
            id: 'live-1',
            file: '/sessions/live-1.jsonl',
            timestamp: '2026-04-14T10:00:00.000Z',
            cwd: '/repo',
            cwdSlug: 'repo',
            model: 'gpt-5.4',
            title: 'Live workspace',
            messageCount: 0,
            isRunning: false,
            isLive: true,
            lastActivityAt: '2026-04-14T10:00:00.000Z',
          },
          blocks: [],
          blockOffset: 0,
          totalBlocks: 0,
          contextUsage: null,
          signature: 'sig-live',
        },
        liveSession: {
          live: true,
          id: 'live-1',
          cwd: '/repo',
          sessionFile: '/sessions/live-1.jsonl',
          isStreaming: false,
        },
      },
    });
    mocks.submitDesktopLiveSessionPrompt.mockResolvedValue({
      ok: true,
      accepted: true,
      delivery: 'started',
      referencedTaskIds: [],
      referencedMemoryDocIds: [],
      referencedVaultFileIds: [],
      referencedAttachmentIds: [],
    });

    server = await startCodexAppServer({ listenUrl: 'ws://127.0.0.1:0' });
    const socket = await connectWebSocket(server.websocketUrl);
    socket.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'test-client', title: 'Test Client', version: '0.0.1' } },
    }));
    await readJsonMessage(socket);
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));

    const startMessages = await collectJsonMessages(socket, () => {
      socket.send(JSON.stringify({
        id: 2,
        method: 'thread/start',
        params: { cwd: '/repo', model: 'gpt-5.4' },
      }));
    }) as Array<{ id?: number; method?: string; result?: { thread?: { id: string } }; params?: { thread?: { id: string } } }>;
    const startResponse = startMessages.find((message) => message.id === 2);
    const startedNotification = startMessages.find((message) => message.method === 'thread/started');
    expect(startResponse?.result?.thread?.id).toBe('live-1');
    expect(startedNotification).toEqual({
      method: 'thread/started',
      params: expect.objectContaining({ thread: expect.objectContaining({ id: 'live-1' }) }),
    });

    const turnMessages = await collectJsonMessages(socket, () => {
      socket.send(JSON.stringify({
        id: 3,
        method: 'turn/start',
        params: { threadId: 'live-1', input: [{ type: 'text', text: 'Hello', textElements: [] }] },
      }));
    }) as Array<{ id?: number; method?: string; result?: { turn?: { id: string; status: string } }; params?: unknown }>;
    expect(mocks.subscribeDesktopLocalApiStream).toHaveBeenCalledWith('/api/live-sessions/live-1/events', expect.any(Function));
    expect(turnMessages).toEqual(expect.arrayContaining([
      {
        id: 3,
        result: {
          turn: expect.objectContaining({ id: 'live-1:active-turn:1', status: 'inProgress' }),
        },
      },
      {
        method: 'thread/status/changed',
        params: { threadId: 'live-1', status: { type: 'active', activeFlags: [] } },
      },
      {
        method: 'turn/started',
        params: { threadId: 'live-1', turn: expect.objectContaining({ id: 'live-1:active-turn:1', status: 'inProgress' }) },
      },
    ]));

    const streamListener = mocks.getStreamListener();
    const streamedMessages = await collectJsonMessages(socket, () => {
      streamListener?.({ type: 'message', data: JSON.stringify({ type: 'text_delta', delta: 'Hello ' }) });
      streamListener?.({ type: 'message', data: JSON.stringify({ type: 'turn_end' }) });
    }) as Array<{ method?: string; params?: unknown }>;

    expect(streamedMessages).toEqual(expect.arrayContaining([
      {
        method: 'item/started',
        params: {
          threadId: 'live-1',
          turnId: 'live-1:active-turn:1',
          item: { type: 'agentMessage', id: 'live-1:active-turn:1:agent-message', text: '', phase: null, memoryCitation: null },
        },
      },
      {
        method: 'item/agentMessage/delta',
        params: {
          threadId: 'live-1',
          turnId: 'live-1:active-turn:1',
          itemId: 'live-1:active-turn:1:agent-message',
          delta: 'Hello ',
        },
      },
      {
        method: 'item/completed',
        params: {
          threadId: 'live-1',
          turnId: 'live-1:active-turn:1',
          item: { type: 'agentMessage', id: 'live-1:active-turn:1:agent-message', text: 'Hello ', phase: null, memoryCitation: null },
        },
      },
      {
        method: 'turn/completed',
        params: {
          threadId: 'live-1',
          turn: expect.objectContaining({ id: 'live-1:active-turn:1', status: 'completed' }),
        },
      },
      {
        method: 'thread/status/changed',
        params: { threadId: 'live-1', status: { type: 'idle' } },
      },
    ]));

    socket.close();
  });

  it('accepts image-only turn/start prompts without requiring text input', async () => {
    mocks.readDesktopModels.mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'medium',
      models: [
        { id: 'gpt-5.4', provider: 'openai-codex', name: 'GPT-5.4', reasoning: true },
      ],
    });
    mocks.createDesktopLiveSession.mockResolvedValue({
      id: 'live-1',
      sessionFile: '/sessions/live-1.jsonl',
      bootstrap: {
        conversationId: 'live-1',
        sessionDetail: {
          meta: {
            id: 'live-1',
            file: '/sessions/live-1.jsonl',
            timestamp: '2026-04-14T10:00:00.000Z',
            cwd: '/repo',
            cwdSlug: 'repo',
            model: 'gpt-5.4',
            title: 'Live workspace',
            messageCount: 0,
            isRunning: false,
            isLive: true,
            lastActivityAt: '2026-04-14T10:00:00.000Z',
          },
          blocks: [],
          blockOffset: 0,
          totalBlocks: 0,
          contextUsage: null,
          signature: 'sig-live',
        },
        liveSession: {
          live: true,
          id: 'live-1',
          cwd: '/repo',
          sessionFile: '/sessions/live-1.jsonl',
          isStreaming: false,
        },
      },
    });
    mocks.submitDesktopLiveSessionPrompt.mockResolvedValue({
      ok: true,
      accepted: true,
      delivery: 'started',
      referencedTaskIds: [],
      referencedMemoryDocIds: [],
      referencedVaultFileIds: [],
      referencedAttachmentIds: [],
    });

    server = await startCodexAppServer({ listenUrl: 'ws://127.0.0.1:0' });
    const socket = await connectWebSocket(server.websocketUrl);
    socket.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'test-client', title: 'Test Client', version: '0.0.1' } },
    }));
    await readJsonMessage(socket);
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));

    await collectJsonMessages(socket, () => {
      socket.send(JSON.stringify({
        id: 2,
        method: 'thread/start',
        params: { cwd: '/repo', model: 'gpt-5.4' },
      }));
    });

    const turnMessages = await collectJsonMessages(socket, () => {
      socket.send(JSON.stringify({
        id: 3,
        method: 'turn/start',
        params: {
          threadId: 'live-1',
          input: [],
          images: [{ data: 'abc123', mimeType: 'image/png', name: 'screen.png' }],
        },
      }));
    }) as Array<{ id?: number; result?: { turn?: { id: string; status: string } } }>;

    expect(turnMessages).toEqual(expect.arrayContaining([
      {
        id: 3,
        result: {
          turn: expect.objectContaining({ id: 'live-1:active-turn:1', status: 'inProgress' }),
        },
      },
    ]));

    expect(mocks.submitDesktopLiveSessionPrompt).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'live-1',
      text: '',
      behavior: 'followUp',
      images: [{ data: 'abc123', mimeType: 'image/png', name: 'screen.png' }],
    }));

    socket.close();
  });

  it('filters archived threads and archives threads', async () => {
    mocks.readDesktopModels.mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'medium',
      models: [
        { id: 'gpt-5.4', provider: 'openai-codex', name: 'GPT-5.4', reasoning: true },
      ],
    });
    mocks.readDesktopSessions.mockResolvedValue([
      {
        id: 'conversation-1',
        file: '/sessions/conversation-1.jsonl',
        timestamp: '2026-04-14T10:00:00.000Z',
        cwd: '/repo',
        cwdSlug: 'repo',
        model: 'gpt-5.4',
        title: 'Active conversation',
        messageCount: 1,
        isRunning: false,
        isLive: false,
        lastActivityAt: '2026-04-14T10:05:00.000Z',
      },
      {
        id: 'conversation-2',
        file: '/sessions/conversation-2.jsonl',
        timestamp: '2026-04-14T11:00:00.000Z',
        cwd: '/repo',
        cwdSlug: 'repo',
        model: 'gpt-5.4',
        title: 'Archived conversation',
        messageCount: 1,
        isRunning: false,
        isLive: false,
        lastActivityAt: '2026-04-14T11:05:00.000Z',
      },
    ]);
    mocks.readDesktopOpenConversationTabs.mockResolvedValue({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-pinned'],
      archivedSessionIds: ['conversation-2'],
      workspacePaths: [],
    });

    server = await startCodexAppServer({ listenUrl: 'ws://127.0.0.1:0' });
    const socket = await connectWebSocket(server.websocketUrl);
    socket.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'test-client', title: 'Test Client', version: '0.0.1' } },
    }));
    await readJsonMessage(socket);
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));

    socket.send(JSON.stringify({ id: 2, method: 'thread/list', params: { archived: false } }));
    await expect(readJsonMessage(socket)).resolves.toEqual({
      id: 2,
      result: {
        data: [expect.objectContaining({ id: 'conversation-1' })],
        nextCursor: null,
      },
    });

    socket.send(JSON.stringify({ id: 3, method: 'thread/list', params: { archived: true } }));
    await expect(readJsonMessage(socket)).resolves.toEqual({
      id: 3,
      result: {
        data: [expect.objectContaining({ id: 'conversation-2' })],
        nextCursor: null,
      },
    });

    const archiveMessages = await collectJsonMessages(socket, () => {
      socket.send(JSON.stringify({ id: 4, method: 'thread/archive', params: { threadId: 'conversation-1' } }));
    }) as Array<{ id?: number; method?: string; params?: Record<string, unknown>; result?: Record<string, unknown> }>;

    expect(mocks.updateDesktopOpenConversationTabs).toHaveBeenCalledWith({
      sessionIds: [],
      pinnedSessionIds: ['conversation-pinned'],
      archivedSessionIds: ['conversation-2', 'conversation-1'],
    });
    expect(archiveMessages).toEqual(expect.arrayContaining([
      { id: 4, result: {} },
      { method: 'thread/archived', params: { threadId: 'conversation-1' } },
    ]));

    socket.close();
  });

  it('forks threads into new live workspaces', async () => {
    mocks.readDesktopModels.mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'medium',
      models: [
        { id: 'gpt-5.4', provider: 'openai-codex', name: 'GPT-5.4', reasoning: true },
      ],
    });
    mocks.forkDesktopConversation.mockResolvedValue({
      id: 'fork-1',
      sessionFile: '/sessions/fork-1.jsonl',
    });
    mocks.readDesktopConversationBootstrap.mockResolvedValue({
      conversationId: 'fork-1',
      sessionDetail: {
        meta: {
          id: 'fork-1',
          file: '/sessions/fork-1.jsonl',
          timestamp: '2026-04-14T12:00:00.000Z',
          cwd: '/repo',
          cwdSlug: 'repo',
          model: 'gpt-5.4',
          title: 'Forked conversation',
          messageCount: 1,
          isRunning: false,
          isLive: true,
          lastActivityAt: '2026-04-14T12:05:00.000Z',
          parentSessionId: 'conversation-1',
        },
        blocks: [
          { type: 'user', id: 'u1', ts: '2026-04-14T12:00:00.000Z', text: 'Hello' },
          { type: 'text', id: 'a1', ts: '2026-04-14T12:00:01.000Z', text: 'Forked' },
        ],
        blockOffset: 0,
        totalBlocks: 2,
        contextUsage: null,
        signature: 'sig-fork',
      },
      liveSession: { live: true },
    });

    server = await startCodexAppServer({ listenUrl: 'ws://127.0.0.1:0' });
    const socket = await connectWebSocket(server.websocketUrl);
    socket.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'test-client', title: 'Test Client', version: '0.0.1' } },
    }));
    await readJsonMessage(socket);
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));

    const forkMessages = await collectJsonMessages(socket, () => {
      socket.send(JSON.stringify({
        id: 2,
        method: 'thread/fork',
        params: { threadId: 'conversation-1', model: 'gpt-5.4' },
      }));
    }) as Array<{ id?: number; result?: { thread?: { id: string; forkedFromId: string | null } }; method?: string; params?: { thread?: { id: string } } }>;

    expect(mocks.forkDesktopConversation).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      model: 'gpt-5.4',
    });
    expect(forkMessages).toEqual(expect.arrayContaining([
      {
        id: 2,
        result: expect.objectContaining({
          thread: expect.objectContaining({ id: 'fork-1', forkedFromId: 'conversation-1' }),
        }),
      },
      {
        method: 'thread/started',
        params: expect.objectContaining({ thread: expect.objectContaining({ id: 'fork-1' }) }),
      },
    ]));

    socket.close();
  });

  it('rolls threads back and returns the updated thread snapshot', async () => {
    mocks.readDesktopModels.mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'medium',
      models: [
        { id: 'gpt-5.4', provider: 'openai-codex', name: 'GPT-5.4', reasoning: true },
      ],
    });
    mocks.rollbackDesktopConversation.mockResolvedValue({
      id: 'conversation-1',
      sessionFile: '/sessions/conversation-1.jsonl',
    });
    mocks.readDesktopConversationBootstrap.mockResolvedValue({
      conversationId: 'conversation-1',
      sessionDetail: {
        meta: {
          id: 'conversation-1',
          file: '/sessions/conversation-1.jsonl',
          timestamp: '2026-04-14T10:00:00.000Z',
          cwd: '/repo',
          cwdSlug: 'repo',
          model: 'gpt-5.4',
          title: 'Rolled back conversation',
          messageCount: 1,
          isRunning: false,
          isLive: false,
          lastActivityAt: '2026-04-14T10:05:00.000Z',
        },
        blocks: [
          { type: 'user', id: 'u1', ts: '2026-04-14T10:00:00.000Z', text: 'Only the first turn remains' },
          { type: 'text', id: 'a1', ts: '2026-04-14T10:00:01.000Z', text: 'Okay' },
        ],
        blockOffset: 0,
        totalBlocks: 2,
        contextUsage: null,
        signature: 'sig-rollback',
      },
      liveSession: { live: false },
    });

    server = await startCodexAppServer({ listenUrl: 'ws://127.0.0.1:0' });
    const socket = await connectWebSocket(server.websocketUrl);
    socket.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'test-client', title: 'Test Client', version: '0.0.1' } },
    }));
    await readJsonMessage(socket);
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));

    socket.send(JSON.stringify({
      id: 2,
      method: 'thread/rollback',
      params: { threadId: 'conversation-1', numTurns: 1 },
    }));

    await expect(readJsonMessage(socket)).resolves.toEqual({
      id: 2,
      result: {
        thread: expect.objectContaining({
          id: 'conversation-1',
          turns: [
            expect.objectContaining({ id: 'conversation-1:turn:1', status: 'completed' }),
          ],
        }),
      },
    });
    expect(mocks.rollbackDesktopConversation).toHaveBeenCalledWith({ conversationId: 'conversation-1', numTurns: 1 });

    socket.close();
  });

  it('interrupts active turns as interrupted', async () => {
    mocks.readDesktopModels.mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'medium',
      models: [
        { id: 'gpt-5.4', provider: 'openai-codex', name: 'GPT-5.4', reasoning: true },
      ],
    });
    mocks.createDesktopLiveSession.mockResolvedValue({
      id: 'live-1',
      sessionFile: '/sessions/live-1.jsonl',
      bootstrap: {
        conversationId: 'live-1',
        sessionDetail: {
          meta: {
            id: 'live-1',
            file: '/sessions/live-1.jsonl',
            timestamp: '2026-04-14T10:00:00.000Z',
            cwd: '/repo',
            cwdSlug: 'repo',
            model: 'gpt-5.4',
            title: 'Live workspace',
            messageCount: 0,
            isRunning: false,
            isLive: true,
            lastActivityAt: '2026-04-14T10:00:00.000Z',
          },
          blocks: [],
          blockOffset: 0,
          totalBlocks: 0,
          contextUsage: null,
          signature: 'sig-live',
        },
        liveSession: {
          live: true,
          id: 'live-1',
          cwd: '/repo',
          sessionFile: '/sessions/live-1.jsonl',
          isStreaming: false,
        },
      },
    });
    mocks.submitDesktopLiveSessionPrompt.mockResolvedValue({
      ok: true,
      accepted: true,
      delivery: 'started',
      referencedTaskIds: [],
      referencedMemoryDocIds: [],
      referencedVaultFileIds: [],
      referencedAttachmentIds: [],
    });

    server = await startCodexAppServer({ listenUrl: 'ws://127.0.0.1:0' });
    const socket = await connectWebSocket(server.websocketUrl);
    socket.send(JSON.stringify({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'test-client', title: 'Test Client', version: '0.0.1' } },
    }));
    await readJsonMessage(socket);
    socket.send(JSON.stringify({ method: 'initialized', params: {} }));

    await collectJsonMessages(socket, () => {
      socket.send(JSON.stringify({
        id: 2,
        method: 'thread/start',
        params: { cwd: '/repo', model: 'gpt-5.4' },
      }));
    });

    const turnMessages = await collectJsonMessages(socket, () => {
      socket.send(JSON.stringify({
        id: 3,
        method: 'turn/start',
        params: { threadId: 'live-1', input: [{ type: 'text', text: 'Hello', textElements: [] }] },
      }));
    }) as Array<{ id?: number; result?: { turn?: { id: string } } }>;
    const turnId = turnMessages.find((message) => message.id === 3)?.result?.turn?.id;
    expect(turnId).toBe('live-1:active-turn:1');

    const interruptMessages = await collectJsonMessages(socket, () => {
      socket.send(JSON.stringify({
        id: 4,
        method: 'turn/interrupt',
        params: { threadId: 'live-1', turnId },
      }));
    }) as Array<{ id?: number; method?: string; result?: Record<string, unknown>; params?: Record<string, unknown> }>;

    expect(mocks.abortDesktopLiveSession).toHaveBeenCalledWith('live-1');
    expect(interruptMessages).toEqual(expect.arrayContaining([
      { id: 4, result: {} },
      {
        method: 'turn/completed',
        params: {
          threadId: 'live-1',
          turn: expect.objectContaining({ id: 'live-1:active-turn:1', status: 'interrupted' }),
        },
      },
      {
        method: 'thread/status/changed',
        params: { threadId: 'live-1', status: { type: 'idle' } },
      },
    ]));

    socket.close();
  });
});
