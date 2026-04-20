import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createConversationInspectAgentExtension } from './conversationInspectAgentExtension.js';

const {
  listConversationInspectSessionsMock,
  formatConversationInspectSessionListMock,
  queryConversationInspectBlocksMock,
  formatConversationInspectQueryResultMock,
  diffConversationInspectBlocksMock,
  formatConversationInspectDiffResultMock,
} = vi.hoisted(() => ({
  listConversationInspectSessionsMock: vi.fn(),
  formatConversationInspectSessionListMock: vi.fn(),
  queryConversationInspectBlocksMock: vi.fn(),
  formatConversationInspectQueryResultMock: vi.fn(),
  diffConversationInspectBlocksMock: vi.fn(),
  formatConversationInspectDiffResultMock: vi.fn(),
}));

vi.mock('../conversations/conversationInspectCapability.js', () => ({
  CONVERSATION_INSPECT_ACTION_VALUES: ['list', 'query', 'diff'],
  CONVERSATION_INSPECT_BLOCK_TYPE_VALUES: ['user', 'text', 'context', 'summary', 'tool_use', 'image', 'error'],
  CONVERSATION_INSPECT_ORDER_VALUES: ['asc', 'desc'],
  CONVERSATION_INSPECT_SCOPE_VALUES: ['all', 'live', 'running', 'archived'],
  listConversationInspectSessions: listConversationInspectSessionsMock,
  formatConversationInspectSessionList: formatConversationInspectSessionListMock,
  queryConversationInspectBlocks: queryConversationInspectBlocksMock,
  formatConversationInspectQueryResult: formatConversationInspectQueryResultMock,
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
  queryConversationInspectBlocksMock.mockReset();
  formatConversationInspectQueryResultMock.mockReset();
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

  it('dispatches list, query, and diff actions to the capability layer', async () => {
    listConversationInspectSessionsMock.mockReturnValue({ scope: 'running', totalMatching: 1, returnedCount: 1, sessions: [{ id: 'conv-2' }] });
    formatConversationInspectSessionListMock.mockReturnValue('list text');
    queryConversationInspectBlocksMock.mockReturnValue({ conversationId: 'conv-2', returnedBlocks: 1, blocks: [{ id: 'block-1' }] });
    formatConversationInspectQueryResultMock.mockReturnValue('query text');
    diffConversationInspectBlocksMock.mockReturnValue({ conversationId: 'conv-2', unchanged: false, returnedBlocks: 1, blocks: [{ id: 'block-2' }] });
    formatConversationInspectDiffResultMock.mockReturnValue('diff text');

    const tool = registerConversationInspectTool();
    const ctx = createToolContext('conv-self');

    const listResult = await tool.execute('tool-1', { action: 'list', scope: 'running' }, undefined, undefined, ctx);
    const queryResult = await tool.execute('tool-2', { action: 'query', conversationId: 'conv-2', text: 'chrono' }, undefined, undefined, ctx);
    const diffResult = await tool.execute('tool-3', { action: 'diff', conversationId: 'conv-2', afterBlockId: 'block-1' }, undefined, undefined, ctx);

    expect(listConversationInspectSessionsMock).toHaveBeenCalledWith(expect.objectContaining({
      scope: 'running',
      currentConversationId: 'conv-self',
    }));
    expect(listResult.content[0]?.text).toBe('list text');
    expect(listResult.details).toMatchObject({ action: 'list', scope: 'running', totalMatching: 1 });

    expect(queryConversationInspectBlocksMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-2',
      text: 'chrono',
    }));
    expect(queryResult.content[0]?.text).toBe('query text');
    expect(queryResult.details).toMatchObject({ action: 'query', conversationId: 'conv-2' });

    expect(diffConversationInspectBlocksMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-2',
      afterBlockId: 'block-1',
    }));
    expect(diffResult.content[0]?.text).toBe('diff text');
    expect(diffResult.details).toMatchObject({ action: 'diff', conversationId: 'conv-2' });
  });
});
