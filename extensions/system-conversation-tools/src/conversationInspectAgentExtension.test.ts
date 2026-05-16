import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createConversationInspectAgentExtension } from './conversationInspectAgentExtension.js';

const {
  executeConversationInspectMock,
  persistTraceContextPointerInspectMock,
  querySessionSuggestedPointerIdsMock,
  readConversationSessionsCapabilityMock,
} = vi.hoisted(() => ({
  executeConversationInspectMock: vi.fn(),
  persistTraceContextPointerInspectMock: vi.fn(),
  querySessionSuggestedPointerIdsMock: vi.fn(),
  readConversationSessionsCapabilityMock: vi.fn(),
}));

vi.mock('@personal-agent/extensions/backend/conversations', () => ({
  CONVERSATION_INSPECT_ACTION_VALUES: ['list', 'search', 'query', 'diff', 'outline', 'read_window'],
  CONVERSATION_INSPECT_BLOCK_TYPE_VALUES: ['user', 'text', 'context', 'summary', 'tool_use', 'image', 'error'],
  CONVERSATION_INSPECT_ORDER_VALUES: ['asc', 'desc'],
  CONVERSATION_INSPECT_ROLE_VALUES: ['user', 'assistant', 'tool', 'context', 'summary', 'image', 'error'],
  CONVERSATION_INSPECT_SCOPE_VALUES: ['all', 'live', 'running', 'archived'],
  CONVERSATION_INSPECT_SEARCH_MODE_VALUES: ['phrase', 'allTerms', 'anyTerm'],
  executeConversationInspect: executeConversationInspectMock,
  persistTraceContextPointerInspect: persistTraceContextPointerInspectMock,
  querySessionSuggestedPointerIds: querySessionSuggestedPointerIdsMock,
  readConversationSessionsCapability: readConversationSessionsCapabilityMock,
}));

type RegisteredTool = Parameters<Parameters<typeof createConversationInspectAgentExtension>[0]>[0] extends never
  ? never
  : {
      name: string;
      promptGuidelines?: string[];
      execute: (...args: unknown[]) => Promise<{ content: Array<{ text?: string }>; details?: Record<string, unknown> }>;
    };

function registerConversationInspectTool() {
  let tool: RegisteredTool | undefined;

  createConversationInspectAgentExtension()({
    registerTool: (registeredTool: unknown) => {
      tool = registeredTool as RegisteredTool;
    },
  } as never);

  if (!tool) {
    throw new Error('conversation_inspect tool was not registered');
  }

  return tool;
}

function createToolContext(conversationId = 'conv-self') {
  return {
    sessionManager: {
      getSessionId: () => conversationId,
    },
  };
}

async function flushAsyncTelemetry() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

beforeEach(() => {
  executeConversationInspectMock.mockReset();
  persistTraceContextPointerInspectMock.mockReset();
  querySessionSuggestedPointerIdsMock.mockReset();
  querySessionSuggestedPointerIdsMock.mockReturnValue(new Set<string>());
  readConversationSessionsCapabilityMock.mockReset();
  readConversationSessionsCapabilityMock.mockReturnValue([
    {
      id: 'conv-self',
      title: 'Current thread',
      cwd: '/repo/current',
      file: '/sessions/conv-self.jsonl',
      timestamp: '2026-05-12T10:00:00.000Z',
      lastActivityAt: '2026-05-12T10:05:00.000Z',
      isLive: true,
      isRunning: true,
      messageCount: 12,
    },
    {
      id: 'conv-2',
      title: 'Other thread',
      cwd: '/repo/other',
      file: '/sessions/conv-2.jsonl',
      timestamp: '2026-05-12T09:00:00.000Z',
      lastActivityAt: '2026-05-12T09:30:00.000Z',
      isLive: true,
      isRunning: false,
      messageCount: 4,
    },
  ]);
});

describe('conversation inspect agent extension', () => {
  it('registers read-only cross-thread guidance', () => {
    const tool = registerConversationInspectTool();
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';

    expect(tool.name).toBe('conversation_inspect');
    expect(guidelines).toContain('read-only');
    expect(guidelines).toContain('list first');
    expect(guidelines).toContain('conversationId');
    expect(guidelines).toContain('hidden reasoning');
  });

  it('dispatches all actions to the worker client with correct params', async () => {
    executeConversationInspectMock.mockImplementation(async (action: string, _params: Record<string, unknown>) => {
      if (action === 'list') {
        return {
          action: 'list',
          result: { scope: 'running', totalMatching: 1, returnedCount: 1, sessions: [{ id: 'conv-2' }] },
          text: 'list text',
        };
      }
      if (action === 'search') {
        return {
          action: 'search',
          result: { query: 'chrono', totalMatching: 1, returnedCount: 1, matches: [{ conversationId: 'conv-2' }] },
          text: 'search text',
        };
      }
      if (action === 'query') {
        return {
          action: 'query',
          result: { conversationId: 'conv-2', returnedBlocks: 1, blocks: [{ id: 'block-1' }] },
          text: 'query text',
        };
      }
      if (action === 'outline') {
        return {
          action: 'outline',
          result: { conversationId: 'conv-2', anchors: [] },
          text: 'outline text',
        };
      }
      if (action === 'read_window') {
        return {
          action: 'read_window',
          result: { conversationId: 'conv-2', returnedBlocks: 1, blocks: [{ id: 'block-1' }] },
          text: 'read_window text',
        };
      }
      if (action === 'diff') {
        return {
          action: 'diff',
          result: { conversationId: 'conv-2', unchanged: false, returnedBlocks: 1, blocks: [{ id: 'block-2' }] },
          text: 'diff text',
        };
      }
      throw new Error(`Unknown action: ${action}`);
    });

    const tool = registerConversationInspectTool();
    const ctx = createToolContext('conv-self');

    const listResult = await tool.execute('tool-1', { action: 'list', scope: 'running' }, undefined, undefined, ctx);
    const searchResult = await tool.execute('tool-2', { action: 'search', query: 'chrono' }, undefined, undefined, ctx);
    const queryResult = await tool.execute(
      'tool-3',
      { action: 'query', conversationId: 'conv-2', text: 'chrono' },
      undefined,
      undefined,
      ctx,
    );
    const outlineResult = await tool.execute('tool-4', { action: 'outline', conversationId: 'conv-2' }, undefined, undefined, ctx);
    const readWindowResult = await tool.execute(
      'tool-5',
      { action: 'read_window', conversationId: 'conv-2', aroundBlockId: 'block-1' },
      undefined,
      undefined,
      ctx,
    );
    const diffResult = await tool.execute(
      'tool-6',
      { action: 'diff', conversationId: 'conv-2', afterBlockId: 'block-1' },
      undefined,
      undefined,
      ctx,
    );

    // list: includes currentConversationId from ctx, passes scope through
    expect(executeConversationInspectMock).toHaveBeenCalledWith('list', {
      action: 'list',
      scope: 'running',
      currentConversationId: 'conv-self',
      sessionSnapshot: [
        {
          id: 'conv-self',
          title: 'Current thread',
          cwd: '/repo/current',
          file: '/sessions/conv-self.jsonl',
          timestamp: '2026-05-12T10:00:00.000Z',
          lastActivityAt: '2026-05-12T10:05:00.000Z',
          isLive: true,
          isRunning: true,
          messageCount: 12,
        },
        {
          id: 'conv-2',
          title: 'Other thread',
          cwd: '/repo/other',
          file: '/sessions/conv-2.jsonl',
          timestamp: '2026-05-12T09:00:00.000Z',
          lastActivityAt: '2026-05-12T09:30:00.000Z',
          isLive: true,
          isRunning: false,
          messageCount: 4,
        },
      ],
    });
    expect(listResult.content[0]?.text).toBe('list text');
    expect(listResult.details).toMatchObject({ action: 'list', scope: 'running', totalMatching: 1 });

    // search: includes currentConversationId from ctx
    expect(executeConversationInspectMock).toHaveBeenCalledWith('search', {
      action: 'search',
      query: 'chrono',
      currentConversationId: 'conv-self',
      sessionSnapshot: [
        {
          id: 'conv-self',
          title: 'Current thread',
          cwd: '/repo/current',
          file: '/sessions/conv-self.jsonl',
          timestamp: '2026-05-12T10:00:00.000Z',
          lastActivityAt: '2026-05-12T10:05:00.000Z',
          isLive: true,
          isRunning: true,
          messageCount: 12,
        },
        {
          id: 'conv-2',
          title: 'Other thread',
          cwd: '/repo/other',
          file: '/sessions/conv-2.jsonl',
          timestamp: '2026-05-12T09:00:00.000Z',
          lastActivityAt: '2026-05-12T09:30:00.000Z',
          isLive: true,
          isRunning: false,
          messageCount: 4,
        },
      ],
    });
    expect(searchResult.content[0]?.text).toBe('search text');
    expect(searchResult.details).toMatchObject({ action: 'search', query: 'chrono', totalMatching: 1 });

    // query: passes params through
    expect(executeConversationInspectMock).toHaveBeenCalledWith('query', {
      action: 'query',
      conversationId: 'conv-2',
      text: 'chrono',
      sessionSnapshot: [
        {
          id: 'conv-2',
          title: 'Other thread',
          cwd: '/repo/other',
          file: '/sessions/conv-2.jsonl',
          timestamp: '2026-05-12T09:00:00.000Z',
          lastActivityAt: '2026-05-12T09:30:00.000Z',
          isLive: true,
          isRunning: false,
          messageCount: 4,
        },
      ],
    });
    expect(queryResult.content[0]?.text).toBe('query text');
    expect(queryResult.details).toMatchObject({ action: 'query', conversationId: 'conv-2' });

    // outline: passes params through
    expect(executeConversationInspectMock).toHaveBeenCalledWith('outline', {
      action: 'outline',
      conversationId: 'conv-2',
      sessionSnapshot: [
        {
          id: 'conv-2',
          title: 'Other thread',
          cwd: '/repo/other',
          file: '/sessions/conv-2.jsonl',
          timestamp: '2026-05-12T09:00:00.000Z',
          lastActivityAt: '2026-05-12T09:30:00.000Z',
          isLive: true,
          isRunning: false,
          messageCount: 4,
        },
      ],
    });
    expect(outlineResult.content[0]?.text).toBe('outline text');
    expect(outlineResult.details).toMatchObject({ action: 'outline', conversationId: 'conv-2' });

    // read_window: passes params through
    expect(executeConversationInspectMock).toHaveBeenCalledWith('read_window', {
      action: 'read_window',
      conversationId: 'conv-2',
      aroundBlockId: 'block-1',
      sessionSnapshot: [
        {
          id: 'conv-2',
          title: 'Other thread',
          cwd: '/repo/other',
          file: '/sessions/conv-2.jsonl',
          timestamp: '2026-05-12T09:00:00.000Z',
          lastActivityAt: '2026-05-12T09:30:00.000Z',
          isLive: true,
          isRunning: false,
          messageCount: 4,
        },
      ],
    });
    expect(readWindowResult.content[0]?.text).toBe('read_window text');
    expect(readWindowResult.details).toMatchObject({ action: 'read_window', conversationId: 'conv-2' });

    // diff: passes params through
    expect(executeConversationInspectMock).toHaveBeenCalledWith('diff', {
      action: 'diff',
      conversationId: 'conv-2',
      afterBlockId: 'block-1',
      sessionSnapshot: [
        {
          id: 'conv-2',
          title: 'Other thread',
          cwd: '/repo/other',
          file: '/sessions/conv-2.jsonl',
          timestamp: '2026-05-12T09:00:00.000Z',
          lastActivityAt: '2026-05-12T09:30:00.000Z',
          isLive: true,
          isRunning: false,
          messageCount: 4,
        },
      ],
    });
    expect(diffResult.content[0]?.text).toBe('diff text');
    expect(diffResult.details).toMatchObject({ action: 'diff', conversationId: 'conv-2' });
  });

  it('falls back to worker-local inspection when the main-thread snapshot is unavailable', async () => {
    readConversationSessionsCapabilityMock.mockImplementation(() => {
      throw new Error('conversation service unavailable');
    });
    executeConversationInspectMock.mockResolvedValue({
      action: 'list',
      result: { scope: 'live', totalMatching: 0, returnedCount: 0, sessions: [] },
      text: 'list text',
    });

    const tool = registerConversationInspectTool();
    const ctx = createToolContext('conv-self');

    await tool.execute('tool-1', { action: 'list', scope: 'live' }, undefined, undefined, ctx);

    expect(executeConversationInspectMock).toHaveBeenCalledWith('list', {
      action: 'list',
      scope: 'live',
      currentConversationId: 'conv-self',
    });
  });

  it('tracks suggested pointer inspections from async backend lookups', async () => {
    querySessionSuggestedPointerIdsMock.mockResolvedValue(new Set<string>(['conv-2']));
    executeConversationInspectMock.mockResolvedValue({
      action: 'query',
      result: { conversationId: 'conv-2', returnedBlocks: 1, blocks: [{ id: 'block-1' }] },
      text: 'query text',
    });

    const tool = registerConversationInspectTool();
    const ctx = createToolContext('conv-self');

    const result = await tool.execute('tool-1', { action: 'query', conversationId: 'conv-2' }, undefined, undefined, ctx);

    expect(result.content[0]?.text).toBe('query text');
    await flushAsyncTelemetry();
    expect(persistTraceContextPointerInspectMock).toHaveBeenCalledWith({
      sessionId: 'conv-self',
      inspectedConversationId: 'conv-2',
      wasSuggested: true,
    });
  });

  it('does not fail inspect calls when pointer telemetry fails', async () => {
    querySessionSuggestedPointerIdsMock.mockRejectedValue(new Error('trace unavailable'));
    executeConversationInspectMock.mockResolvedValue({
      action: 'query',
      result: { conversationId: 'conv-2', returnedBlocks: 1, blocks: [{ id: 'block-1' }] },
      text: 'query text',
    });

    const tool = registerConversationInspectTool();
    const ctx = createToolContext('conv-self');

    const result = await tool.execute('tool-1', { action: 'query', conversationId: 'conv-2' }, undefined, undefined, ctx);

    expect(result.content[0]?.text).toBe('query text');
    await flushAsyncTelemetry();
    expect(querySessionSuggestedPointerIdsMock).toHaveBeenCalledWith('conv-self');
    expect(persistTraceContextPointerInspectMock).not.toHaveBeenCalled();
  });

  it('forwards errors from the worker client', async () => {
    executeConversationInspectMock.mockRejectedValue(new Error('worker exploded'));

    const tool = registerConversationInspectTool();
    const ctx = createToolContext('conv-self');

    await expect(tool.execute('tool-1', { action: 'list' }, undefined, undefined, ctx)).rejects.toThrow('worker exploded');
  });
});
