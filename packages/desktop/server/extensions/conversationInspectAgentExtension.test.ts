import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createConversationInspectAgentExtension } from './conversationInspectAgentExtension.js';

const { executeConversationInspectMock } = vi.hoisted(() => ({
  executeConversationInspectMock: vi.fn(),
}));

vi.mock('../conversations/conversationInspectWorkerClient.js', () => ({
  executeConversationInspect: executeConversationInspectMock,
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

beforeEach(() => {
  executeConversationInspectMock.mockReset();
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
    });
    expect(listResult.content[0]?.text).toBe('list text');
    expect(listResult.details).toMatchObject({ action: 'list', scope: 'running', totalMatching: 1 });

    // search: includes currentConversationId from ctx
    expect(executeConversationInspectMock).toHaveBeenCalledWith('search', {
      action: 'search',
      query: 'chrono',
      currentConversationId: 'conv-self',
    });
    expect(searchResult.content[0]?.text).toBe('search text');
    expect(searchResult.details).toMatchObject({ action: 'search', query: 'chrono', totalMatching: 1 });

    // query: passes params through
    expect(executeConversationInspectMock).toHaveBeenCalledWith('query', {
      action: 'query',
      conversationId: 'conv-2',
      text: 'chrono',
    });
    expect(queryResult.content[0]?.text).toBe('query text');
    expect(queryResult.details).toMatchObject({ action: 'query', conversationId: 'conv-2' });

    // outline: passes params through
    expect(executeConversationInspectMock).toHaveBeenCalledWith('outline', {
      action: 'outline',
      conversationId: 'conv-2',
    });
    expect(outlineResult.content[0]?.text).toBe('outline text');
    expect(outlineResult.details).toMatchObject({ action: 'outline', conversationId: 'conv-2' });

    // read_window: passes params through
    expect(executeConversationInspectMock).toHaveBeenCalledWith('read_window', {
      action: 'read_window',
      conversationId: 'conv-2',
      aroundBlockId: 'block-1',
    });
    expect(readWindowResult.content[0]?.text).toBe('read_window text');
    expect(readWindowResult.details).toMatchObject({ action: 'read_window', conversationId: 'conv-2' });

    // diff: passes params through
    expect(executeConversationInspectMock).toHaveBeenCalledWith('diff', {
      action: 'diff',
      conversationId: 'conv-2',
      afterBlockId: 'block-1',
    });
    expect(diffResult.content[0]?.text).toBe('diff text');
    expect(diffResult.details).toMatchObject({ action: 'diff', conversationId: 'conv-2' });
  });

  it('forwards errors from the worker client', async () => {
    executeConversationInspectMock.mockRejectedValue(new Error('worker exploded'));

    const tool = registerConversationInspectTool();
    const ctx = createToolContext('conv-self');

    await expect(tool.execute('tool-1', { action: 'list' }, undefined, undefined, ctx)).rejects.toThrow('worker exploded');
  });
});
