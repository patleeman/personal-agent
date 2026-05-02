import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listConversationSessionsSnapshotMock,
  readConversationSessionMetaMock,
  readConversationSessionSignatureMock,
  resolveConversationSessionFileMock,
  readSessionBlocksByFileMock,
} = vi.hoisted(() => ({
  listConversationSessionsSnapshotMock: vi.fn(),
  readConversationSessionMetaMock: vi.fn(),
  readConversationSessionSignatureMock: vi.fn(),
  resolveConversationSessionFileMock: vi.fn(),
  readSessionBlocksByFileMock: vi.fn(),
}));

vi.mock('./conversationService.js', () => ({
  listConversationSessionsSnapshot: listConversationSessionsSnapshotMock,
  readConversationSessionMeta: readConversationSessionMetaMock,
  readConversationSessionSignature: readConversationSessionSignatureMock,
  resolveConversationSessionFile: resolveConversationSessionFileMock,
}));

vi.mock('./sessions.js', () => ({
  readSessionBlocksByFile: readSessionBlocksByFileMock,
}));

import {
  diffConversationInspectBlocks,
  formatConversationInspectDiffResult,
  formatConversationInspectQueryResult,
  formatConversationInspectSearchResult,
  formatConversationInspectSessionList,
  listConversationInspectSessions,
  queryConversationInspectBlocks,
  searchConversationInspectSessions,
} from './conversationInspectCapability.js';

beforeEach(() => {
  listConversationSessionsSnapshotMock.mockReset();
  readConversationSessionMetaMock.mockReset();
  readConversationSessionSignatureMock.mockReset();
  resolveConversationSessionFileMock.mockReset();
  readSessionBlocksByFileMock.mockReset();
});

describe('conversationInspectCapability', () => {
  it('lists conversations with running/live filtering and excludes the current thread by default', () => {
    listConversationSessionsSnapshotMock.mockReturnValue([
      {
        id: 'conv-self',
        title: 'Current thread',
        cwd: '/repo',
        file: '/sessions/conv-self.jsonl',
        timestamp: '2026-04-20T09:59:00.000Z',
        lastActivityAt: '2026-04-20T10:00:00.000Z',
        isLive: true,
        isRunning: true,
        messageCount: 12,
      },
      {
        id: 'conv-running',
        title: 'Other running thread',
        cwd: '/repo',
        file: '/sessions/conv-running.jsonl',
        timestamp: '2026-04-20T09:58:00.000Z',
        lastActivityAt: '2026-04-20T09:59:30.000Z',
        isLive: true,
        isRunning: true,
        messageCount: 8,
      },
      {
        id: 'conv-archived',
        title: 'Old thread',
        cwd: '/repo/old',
        file: '/sessions/conv-archived.jsonl',
        timestamp: '2026-04-20T08:00:00.000Z',
        lastActivityAt: '2026-04-20T08:00:00.000Z',
        isLive: false,
        isRunning: false,
        messageCount: 40,
      },
    ]);

    const result = listConversationInspectSessions({
      scope: 'running',
      currentConversationId: 'conv-self',
    });

    expect(result).toMatchObject({
      scope: 'running',
      totalMatching: 1,
      returnedCount: 1,
    });
    expect(result.sessions).toEqual([
      expect.objectContaining({
        id: 'conv-running',
        title: 'Other running thread',
        isLive: true,
        isRunning: true,
        isCurrent: false,
      }),
    ]);
    expect(formatConversationInspectSessionList(result)).toContain('conv-running [running]');
  });

  it('searches visible transcript blocks across conversations and returns match snippets', () => {
    listConversationSessionsSnapshotMock.mockReturnValue([
      {
        id: 'conv-self',
        title: 'Current thread',
        cwd: '/repo',
        file: '/sessions/conv-self.jsonl',
        timestamp: '2026-04-20T10:00:00.000Z',
        lastActivityAt: '2026-04-20T10:00:00.000Z',
        isLive: true,
        isRunning: true,
        messageCount: 10,
      },
      {
        id: 'conv-search',
        title: 'Deploy RCA',
        cwd: '/repo',
        file: '/sessions/conv-search.jsonl',
        timestamp: '2026-04-20T09:59:00.000Z',
        lastActivityAt: '2026-04-20T09:59:30.000Z',
        isLive: true,
        isRunning: true,
        messageCount: 8,
      },
      {
        id: 'conv-other',
        title: 'Unrelated',
        cwd: '/repo/other',
        file: '/sessions/conv-other.jsonl',
        timestamp: '2026-04-20T09:00:00.000Z',
        lastActivityAt: '2026-04-20T09:00:00.000Z',
        isLive: false,
        isRunning: false,
        messageCount: 4,
      },
    ]);
    readSessionBlocksByFileMock.mockImplementation((filePath: string) => {
      if (filePath === '/sessions/conv-search.jsonl') {
        return {
          blocks: [
            { type: 'user', id: 'user-1', ts: '2026-04-20T10:00:00.000Z', text: 'Check the bloodhound scheduler.' },
            {
              type: 'tool_use',
              id: 'tool-1',
              ts: '2026-04-20T10:00:10.000Z',
              tool: 'bash',
              input: { command: 'grep chrono logs.txt' },
              output: 'Chrono execution is stuck in high lag.',
              toolCallId: 'call-1',
            },
          ],
        };
      }

      return {
        blocks: [{ type: 'text', id: 'assistant-1', ts: '2026-04-20T09:00:00.000Z', text: 'Nothing interesting here.' }],
      };
    });

    const result = searchConversationInspectSessions({
      query: 'chrono',
      currentConversationId: 'conv-self',
    });

    expect(result).toMatchObject({
      query: 'chrono',
      scope: 'all',
      totalMatching: 1,
      returnedCount: 1,
    });
    expect(result.matches).toEqual([
      expect.objectContaining({
        conversationId: 'conv-search',
        title: 'Deploy RCA',
        blockId: 'tool-1',
        blockType: 'tool_use',
        blockIndex: 1,
      }),
    ]);
    expect(result.matches[0]?.snippet.toLowerCase()).toContain('chrono');
    expect(formatConversationInspectSearchResult(result)).toContain('conv-search [running]');
    expect(formatConversationInspectSearchResult(result)).toContain('tool-1 (tool_use)');
  });

  it('supports all-terms search with inline context windows', () => {
    listConversationSessionsSnapshotMock.mockReturnValue([
      {
        id: 'conv-search',
        title: 'UI cleanup',
        cwd: '/repo',
        file: '/sessions/conv-search.jsonl',
        timestamp: '2026-04-20T09:59:00.000Z',
        lastActivityAt: '2026-04-20T09:59:30.000Z',
        isLive: true,
        isRunning: false,
        messageCount: 3,
      },
    ]);
    readSessionBlocksByFileMock.mockReturnValue({
      blocks: [
        { type: 'user', id: 'user-1', ts: '2026-04-20T10:00:00.000Z', text: 'Fix the details page.' },
        { type: 'text', id: 'assistant-1', ts: '2026-04-20T10:00:01.000Z', text: 'I will inspect SessionDetail first.' },
        {
          type: 'tool_use',
          id: 'tool-1',
          ts: '2026-04-20T10:00:02.000Z',
          tool: 'bash',
          input: { command: 'eslint ModelInfo' },
          output: 'SessionDetail imports ModelInfo.',
          toolCallId: 'call-1',
        },
      ],
    });

    const result = searchConversationInspectSessions({
      query: 'eslint ModelInfo SessionDetail',
      searchMode: 'allTerms',
      includeAroundMatches: true,
      window: 1,
    });

    expect(result).toMatchObject({
      query: 'eslint ModelInfo SessionDetail',
      mode: 'allTerms',
      returnedCount: 1,
    });
    expect(result.matches[0]?.blockId).toBe('tool-1');
    expect(result.matches[0]?.contextBlocks?.map((block) => block.id)).toEqual(['assistant-1', 'tool-1']);
    expect(formatConversationInspectSearchResult(result)).toContain('mode=allTerms');
    expect(formatConversationInspectSearchResult(result)).toContain('assistant-1 · text');
  });

  it('can stop transcript search after enough matches for interactive UI queries', () => {
    listConversationSessionsSnapshotMock.mockReturnValue([
      {
        id: 'conv-one',
        title: 'First thread',
        cwd: '/repo',
        file: '/sessions/conv-one.jsonl',
        timestamp: '2026-04-20T10:00:00.000Z',
        isLive: true,
        isRunning: false,
        messageCount: 1,
      },
      {
        id: 'conv-two',
        title: 'Second thread',
        cwd: '/repo',
        file: '/sessions/conv-two.jsonl',
        timestamp: '2026-04-20T09:00:00.000Z',
        isLive: false,
        isRunning: false,
        messageCount: 1,
      },
    ]);
    readSessionBlocksByFileMock.mockReturnValue({
      blocks: [{ type: 'text', id: 'assistant-1', ts: '2026-04-20T10:00:00.000Z', text: 'needle' }],
    });

    const result = searchConversationInspectSessions({ query: 'needle', limit: 1, stopAfterLimit: true });

    expect(result.returnedCount).toBe(1);
    expect(result.totalMatching).toBe(1);
    expect(result.matches[0]?.conversationId).toBe('conv-one');
    expect(readSessionBlocksByFileMock).toHaveBeenCalledTimes(1);
  });

  it('centers all-terms search snippets around the first matched term when the phrase is not contiguous', () => {
    listConversationSessionsSnapshotMock.mockReturnValue([
      {
        id: 'conv-search',
        title: 'Long retrieval thread',
        cwd: '/repo',
        file: '/sessions/conv-search.jsonl',
        timestamp: '2026-04-20T09:59:00.000Z',
        lastActivityAt: '2026-04-20T09:59:30.000Z',
        isLive: true,
        isRunning: false,
        messageCount: 1,
      },
    ]);
    readSessionBlocksByFileMock.mockReturnValue({
      blocks: [
        {
          type: 'text',
          id: 'assistant-1',
          ts: '2026-04-20T10:00:01.000Z',
          text: `${'intro '.repeat(40)}alpha middle beta conclusion`,
        },
      ],
    });

    const result = searchConversationInspectSessions({
      query: 'alpha beta',
      searchMode: 'allTerms',
      maxSnippetCharacters: 48,
    });

    expect(result.matches[0]?.snippet).toContain('alpha');
    expect(result.matches[0]?.snippet).toContain('beta');
  });

  it('matches phrase searches across normalized transcript whitespace', () => {
    listConversationSessionsSnapshotMock.mockReturnValue([
      {
        id: 'conv-search',
        title: 'Wrapped transcript thread',
        cwd: '/repo',
        file: '/sessions/conv-search.jsonl',
        timestamp: '2026-04-20T09:59:00.000Z',
        lastActivityAt: '2026-04-20T09:59:30.000Z',
        isLive: true,
        isRunning: false,
        messageCount: 1,
      },
    ]);
    readSessionBlocksByFileMock.mockReturnValue({
      blocks: [{ type: 'text', id: 'assistant-1', ts: '2026-04-20T10:00:01.000Z', text: 'The deploy\n\nsummary is ready.' }],
    });

    const result = searchConversationInspectSessions({ query: 'deploy summary' });

    expect(result.returnedCount).toBe(1);
    expect(result.matches[0]?.blockId).toBe('assistant-1');
    expect(result.matches[0]?.snippet).toContain('deploy summary');
  });

  it('queries transcript blocks with type/tool/text filters', () => {
    readConversationSessionMetaMock.mockReturnValue({
      id: 'conv-2',
      title: 'Deploy RCA',
      cwd: '/repo',
      file: '/sessions/conv-2.jsonl',
    });
    resolveConversationSessionFileMock.mockReturnValue('/sessions/conv-2.jsonl');
    readConversationSessionSignatureMock.mockReturnValue('123:456');
    readSessionBlocksByFileMock.mockReturnValue({
      signature: '123:456',
      blocks: [
        { type: 'user', id: 'user-1', ts: '2026-04-20T10:00:00.000Z', text: 'Check the bloodhound scheduler.' },
        {
          type: 'tool_use',
          id: 'tool-1',
          ts: '2026-04-20T10:00:10.000Z',
          tool: 'bash',
          input: { command: 'grep chrono logs.txt' },
          output: 'Chrono execution is stuck in high lag.',
          toolCallId: 'call-1',
        },
        { type: 'text', id: 'assistant-1', ts: '2026-04-20T10:00:20.000Z', text: 'The scheduler is lagging.' },
        { type: 'error', id: 'error-1', ts: '2026-04-20T10:00:30.000Z', tool: 'bash', message: 'non-zero exit status' },
      ],
    });

    const result = queryConversationInspectBlocks({
      conversationId: 'conv-2',
      types: ['tool_use'],
      tools: ['bash'],
      text: 'chrono',
      limit: 10,
    });

    expect(result).toMatchObject({
      conversationId: 'conv-2',
      title: 'Deploy RCA',
      cwd: '/repo',
      signature: '123:456',
      totalBlocks: 4,
      matchingBlocks: 1,
      returnedBlocks: 1,
      firstReturnedBlockId: 'tool-1',
      lastReturnedBlockId: 'tool-1',
    });
    expect(result.blocks).toEqual([
      expect.objectContaining({
        id: 'tool-1',
        index: 1,
        type: 'tool_use',
        tool: 'bash',
        output: 'Chrono execution is stuck in high lag.',
      }),
    ]);
    expect(formatConversationInspectQueryResult(result)).toContain('tool-1 · tool_use:bash');
    expect(formatConversationInspectQueryResult(result)).toContain('Chrono execution is stuck in high lag.');
  });

  it('defaults unsafe transcript query limits instead of clamping them', () => {
    readConversationSessionMetaMock.mockReturnValue({
      id: 'conv-unsafe-limit',
      title: 'Unsafe limit thread',
      cwd: '/repo',
      file: '/sessions/conv-unsafe-limit.jsonl',
    });
    resolveConversationSessionFileMock.mockReturnValue('/sessions/conv-unsafe-limit.jsonl');
    readConversationSessionSignatureMock.mockReturnValue('unsafe:1');
    readSessionBlocksByFileMock.mockReturnValue({
      signature: 'unsafe:1',
      blocks: Array.from({ length: 21 }, (_, index) => ({
        type: 'text',
        id: `assistant-${index}`,
        ts: `2026-04-20T10:00:${String(index).padStart(2, '0')}.000Z`,
        text: `reply ${index}`,
      })),
    });

    const result = queryConversationInspectBlocks({
      conversationId: 'conv-unsafe-limit',
      limit: Number.MAX_SAFE_INTEGER + 1,
    });

    expect(result.returnedBlocks).toBe(20);
    expect(result.blocks).toHaveLength(20);
  });

  it('queries by conversational role and reports valid enum values for bad filters', () => {
    readConversationSessionMetaMock.mockReturnValue({
      id: 'conv-roles',
      title: 'Role thread',
      cwd: '/repo',
      file: '/sessions/conv-roles.jsonl',
    });
    resolveConversationSessionFileMock.mockReturnValue('/sessions/conv-roles.jsonl');
    readConversationSessionSignatureMock.mockReturnValue('roles:1');
    readSessionBlocksByFileMock.mockReturnValue({
      signature: 'roles:1',
      blocks: [
        { type: 'user', id: 'user-1', ts: '2026-04-20T10:00:00.000Z', text: 'hello' },
        { type: 'text', id: 'assistant-1', ts: '2026-04-20T10:00:01.000Z', text: 'hi' },
        { type: 'tool_use', id: 'tool-1', ts: '2026-04-20T10:00:02.000Z', tool: 'bash', input: {}, output: 'ok', toolCallId: 'call-1' },
      ],
    });

    const result = queryConversationInspectBlocks({
      conversationId: 'conv-roles',
      roles: ['user', 'assistant'],
      limit: 1.5,
    });

    expect(result.blocks.map((block) => block.id)).toEqual(['user-1', 'assistant-1']);
    expect(() =>
      queryConversationInspectBlocks({
        conversationId: 'conv-roles',
        types: ['assistant'],
      }),
    ).toThrow('Valid values: user, text, context, summary, tool_use, image, error');
    expect(() =>
      queryConversationInspectBlocks({
        conversationId: 'conv-roles',
        roles: ['bot'],
      }),
    ).toThrow('Valid values: user, assistant, tool, context, summary, image, error');
  });

  it('supports aroundBlockId windows and rejects conflicting range inputs', () => {
    readConversationSessionMetaMock.mockReturnValue({
      id: 'conv-3',
      title: 'Windowed thread',
      cwd: '/repo',
      file: '/sessions/conv-3.jsonl',
    });
    resolveConversationSessionFileMock.mockReturnValue('/sessions/conv-3.jsonl');
    readConversationSessionSignatureMock.mockReturnValue('999:1');
    readSessionBlocksByFileMock.mockReturnValue({
      signature: '999:1',
      blocks: [
        { type: 'user', id: 'block-1', ts: '2026-04-20T10:00:00.000Z', text: 'one' },
        { type: 'text', id: 'block-2', ts: '2026-04-20T10:00:01.000Z', text: 'two' },
        { type: 'text', id: 'block-3', ts: '2026-04-20T10:00:02.000Z', text: 'three' },
        { type: 'text', id: 'block-4', ts: '2026-04-20T10:00:03.000Z', text: 'four' },
      ],
    });

    const windowed = queryConversationInspectBlocks({
      conversationId: 'conv-3',
      aroundBlockId: 'block-3',
      window: 1,
      limit: 10,
    });

    expect(windowed.blocks.map((block) => block.id)).toEqual(['block-2', 'block-3', 'block-4']);

    expect(() =>
      queryConversationInspectBlocks({
        conversationId: 'conv-3',
        aroundBlockId: 'block-3',
        afterBlockId: 'block-1',
      }),
    ).toThrow('aroundBlockId cannot be combined');
  });

  it('short-circuits diff reads when the signature is unchanged', () => {
    readConversationSessionMetaMock.mockReturnValue({
      id: 'conv-4',
      title: 'Stable thread',
      cwd: '/repo',
      file: '/sessions/conv-4.jsonl',
    });
    resolveConversationSessionFileMock.mockReturnValue('/sessions/conv-4.jsonl');
    readConversationSessionSignatureMock.mockReturnValue('sig-1');
    readSessionBlocksByFileMock.mockReturnValue({
      signature: 'sig-1',
      blocks: [{ type: 'text', id: 'block-1', ts: '2026-04-20T10:00:00.000Z', text: 'steady state' }],
    });

    const result = diffConversationInspectBlocks({
      conversationId: 'conv-4',
      knownSignature: 'sig-1',
      afterBlockId: 'block-1',
    });

    expect(result).toMatchObject({
      conversationId: 'conv-4',
      unchanged: true,
      returnedBlocks: 0,
      signature: 'sig-1',
    });
    expect(formatConversationInspectDiffResult(result)).toContain('unchanged');
  });

  it('returns only blocks after afterBlockId for diffs', () => {
    readConversationSessionMetaMock.mockReturnValue({
      id: 'conv-5',
      title: 'Changing thread',
      cwd: '/repo',
      file: '/sessions/conv-5.jsonl',
    });
    resolveConversationSessionFileMock.mockReturnValue('/sessions/conv-5.jsonl');
    readConversationSessionSignatureMock.mockReturnValue('sig-2');
    readSessionBlocksByFileMock.mockReturnValue({
      signature: 'sig-2',
      blocks: [
        { type: 'user', id: 'block-1', ts: '2026-04-20T10:00:00.000Z', text: 'start' },
        { type: 'text', id: 'block-2', ts: '2026-04-20T10:00:01.000Z', text: 'middle' },
        {
          type: 'tool_use',
          id: 'block-3',
          ts: '2026-04-20T10:00:02.000Z',
          tool: 'read',
          input: { path: 'foo.ts' },
          output: 'patched',
          toolCallId: 'call-3',
        },
        { type: 'text', id: 'block-4', ts: '2026-04-20T10:00:03.000Z', text: 'done' },
      ],
    });

    const result = diffConversationInspectBlocks({
      conversationId: 'conv-5',
      knownSignature: 'sig-1',
      afterBlockId: 'block-2',
      limit: 10,
    });

    expect(result).toMatchObject({
      conversationId: 'conv-5',
      unchanged: false,
      matchingBlocks: 2,
      returnedBlocks: 2,
      firstReturnedBlockId: 'block-3',
      lastReturnedBlockId: 'block-4',
    });
    expect(result.blocks.map((block) => block.id)).toEqual(['block-3', 'block-4']);
    expect(formatConversationInspectDiffResult(result)).toContain('diff blocks: 2/2 matched');
  });
});
