import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationInspectAgentExtension } from './conversationInspectAgentExtension.js';

const {
  listConversationInspectSessionsMock,
  formatConversationInspectSessionListMock,
  searchConversationInspectSessionsMock,
  formatConversationInspectSearchResultMock,
  queryConversationInspectBlocksMock,
  formatConversationInspectQueryResultMock,
  outlineConversationInspectSessionMock,
  formatConversationInspectOutlineResultMock,
  readWindowConversationInspectBlocksMock,
  diffConversationInspectBlocksMock,
  formatConversationInspectDiffResultMock,
} = vi.hoisted(() => ({
  listConversationInspectSessionsMock: vi.fn(),
  formatConversationInspectSessionListMock: vi.fn(),
  searchConversationInspectSessionsMock: vi.fn(),
  formatConversationInspectSearchResultMock: vi.fn(),
  queryConversationInspectBlocksMock: vi.fn(),
  formatConversationInspectQueryResultMock: vi.fn(),
  outlineConversationInspectSessionMock: vi.fn(),
  formatConversationInspectOutlineResultMock: vi.fn(),
  readWindowConversationInspectBlocksMock: vi.fn(),
  diffConversationInspectBlocksMock: vi.fn(),
  formatConversationInspectDiffResultMock: vi.fn(),
}));

vi.mock('../conversations/conversationInspectCapability.js', () => ({
  CONVERSATION_INSPECT_ACTION_VALUES: ['list', 'search', 'query', 'diff', 'outline', 'read_window'],
  CONVERSATION_INSPECT_BLOCK_TYPE_VALUES: ['user', 'text', 'context', 'summary', 'tool_use', 'image', 'error'],
  CONVERSATION_INSPECT_ORDER_VALUES: ['asc', 'desc'],
  CONVERSATION_INSPECT_SCOPE_VALUES: ['all', 'live', 'running', 'archived'],
  listConversationInspectSessions: listConversationInspectSessionsMock,
  formatConversationInspectSessionList: formatConversationInspectSessionListMock,
  searchConversationInspectSessions: searchConversationInspectSessionsMock,
  formatConversationInspectSearchResult: formatConversationInspectSearchResultMock,
  queryConversationInspectBlocks: queryConversationInspectBlocksMock,
  formatConversationInspectQueryResult: formatConversationInspectQueryResultMock,
  outlineConversationInspectSession: outlineConversationInspectSessionMock,
  formatConversationInspectOutlineResult: formatConversationInspectOutlineResultMock,
  readWindowConversationInspectBlocks: readWindowConversationInspectBlocksMock,
  diffConversationInspectBlocks: diffConversationInspectBlocksMock,
  formatConversationInspectDiffResult: formatConversationInspectDiffResultMock,
}));

type RegisteredTool = Parameters<Parameters<typeof createConversationInspectAgentExtension>[0]>[0] extends never ? never : {
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

beforeEach(() => {
  listConversationInspectSessionsMock.mockReset();
  formatConversationInspectSessionListMock.mockReset();
  searchConversationInspectSessionsMock.mockReset();
  formatConversationInspectSearchResultMock.mockReset();
  queryConversationInspectBlocksMock.mockReset();
  formatConversationInspectQueryResultMock.mockReset();
  outlineConversationInspectSessionMock.mockReset();
  formatConversationInspectOutlineResultMock.mockReset();
  readWindowConversationInspectBlocksMock.mockReset();
  diffConversationInspectBlocksMock.mockReset();
  formatConversationInspectDiffResultMock.mockReset();
});

describe('conversation inspect agent extension', () => {
  it('registers read-only cross-thread guidance', () => {
    const tool = registerConversationInspectTool();
    const guidelines = tool.promptGuidelines?.join('\n') ?? '';

    expect(tool.name).toBe('conversation_inspect');
    expect(guidelines).toContain('read-only');
    expect(guidelines).toContain('list first');
    expect(guidelines).toContain('hidden reasoning');
  });

  it('dispatches list, search, query, outline, read_window, and diff actions to the capability layer', async () => {
    listConversationInspectSessionsMock.mockReturnValue({ scope: 'running', totalMatching: 1, returnedCount: 1, sessions: [{ id: 'conv-2' }] });
    formatConversationInspectSessionListMock.mockReturnValue('list text');
    searchConversationInspectSessionsMock.mockReturnValue({ query: 'chrono', totalMatching: 1, returnedCount: 1, matches: [{ conversationId: 'conv-2' }] });
    formatConversationInspectSearchResultMock.mockReturnValue('search text');
    queryConversationInspectBlocksMock.mockReturnValue({ conversationId: 'conv-2', returnedBlocks: 1, blocks: [{ id: 'block-1' }] });
    formatConversationInspectQueryResultMock.mockReturnValue('query text');
    outlineConversationInspectSessionMock.mockReturnValue({ conversationId: 'conv-2', anchors: [] });
    formatConversationInspectOutlineResultMock.mockReturnValue('outline text');
    readWindowConversationInspectBlocksMock.mockReturnValue({ conversationId: 'conv-2', returnedBlocks: 1, blocks: [{ id: 'block-1' }] });
    diffConversationInspectBlocksMock.mockReturnValue({ conversationId: 'conv-2', unchanged: false, returnedBlocks: 1, blocks: [{ id: 'block-2' }] });
    formatConversationInspectDiffResultMock.mockReturnValue('diff text');

    const tool = registerConversationInspectTool();
    const ctx = createToolContext('conv-self');

    const listResult = await tool.execute('tool-1', { action: 'list', scope: 'running' }, undefined, undefined, ctx);
    const searchResult = await tool.execute('tool-2', { action: 'search', query: 'chrono' }, undefined, undefined, ctx);
    const queryResult = await tool.execute('tool-3', { action: 'query', conversationId: 'conv-2', text: 'chrono' }, undefined, undefined, ctx);
    const outlineResult = await tool.execute('tool-4', { action: 'outline', conversationId: 'conv-2' }, undefined, undefined, ctx);
    const readWindowResult = await tool.execute('tool-5', { action: 'read_window', conversationId: 'conv-2', aroundBlockId: 'block-1' }, undefined, undefined, ctx);
    const diffResult = await tool.execute('tool-6', { action: 'diff', conversationId: 'conv-2', afterBlockId: 'block-1' }, undefined, undefined, ctx);

    expect(listConversationInspectSessionsMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'running',
      currentConversationId: 'conv-self',
    }));
    expect(listResult.content[0]?.text).toBe('list text');
    expect(listResult.details).toMatchObject({ action: 'list', scope: 'running', totalMatching: 1 });

    expect(searchConversationInspectSessionsMock).toHaveBeenCalledWith(expect.objectContaining({
      query: 'chrono',
      currentConversationId: 'conv-self',
    }));
    expect(searchResult.content[0]?.text).toBe('search text');
    expect(searchResult.details).toMatchObject({ action: 'search', query: 'chrono', totalMatching: 1 });

    expect(queryConversationInspectBlocksMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-2',
      text: 'chrono',
    }));
    expect(queryResult.content[0]?.text).toBe('query text');
    expect(queryResult.details).toMatchObject({ action: 'query', conversationId: 'conv-2' });

    expect(outlineConversationInspectSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-2',
    }));
    expect(outlineResult.content[0]?.text).toBe('outline text');
    expect(outlineResult.details).toMatchObject({ action: 'outline', conversationId: 'conv-2' });

    expect(readWindowConversationInspectBlocksMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-2',
      aroundBlockId: 'block-1',
    }));
    expect(readWindowResult.content[0]?.text).toBe('query text');
    expect(readWindowResult.details).toMatchObject({ action: 'read_window', conversationId: 'conv-2' });

    expect(diffConversationInspectBlocksMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-2',
      afterBlockId: 'block-1',
    }));
    expect(diffResult.content[0]?.text).toBe('diff text');
    expect(diffResult.details).toMatchObject({ action: 'diff', conversationId: 'conv-2' });
  });
});
