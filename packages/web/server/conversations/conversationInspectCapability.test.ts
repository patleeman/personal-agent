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
  formatConversationInspectSessionList,
  listConversationInspectSessions,
  queryConversationInspectBlocks,
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

    expect(() => queryConversationInspectBlocks({
      conversationId: 'conv-3',
      aroundBlockId: 'block-3',
      afterBlockId: 'block-1',
    })).toThrow('aroundBlockId cannot be combined');
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
      blocks: [
        { type: 'text', id: 'block-1', ts: '2026-04-20T10:00:00.000Z', text: 'steady state' },
      ],
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
        { type: 'tool_use', id: 'block-3', ts: '2026-04-20T10:00:02.000Z', tool: 'read', input: { path: 'foo.ts' }, output: 'patched', toolCallId: 'call-3' },
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
