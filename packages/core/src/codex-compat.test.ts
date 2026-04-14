import { describe, expect, it } from 'vitest';
import {
  buildCodexThreadFromSessionDetail,
  buildSessionDetailFromCodexThread,
  type CompatSessionDetail,
} from './codex-compat.js';

describe('codex compatibility mappers', () => {
  it('builds codex turns from session detail blocks', () => {
    const detail: CompatSessionDetail = {
      meta: {
        id: 'conversation-1',
        file: '/sessions/conversation-1.jsonl',
        timestamp: '2026-04-14T10:00:00.000Z',
        cwd: '/repo',
        cwdSlug: 'repo',
        model: 'gpt-5.4',
        title: 'Example conversation',
        messageCount: 2,
        isRunning: false,
        isLive: false,
        lastActivityAt: '2026-04-14T10:05:00.000Z',
      },
      blocks: [
        { type: 'user', id: 'u1', ts: '2026-04-14T10:00:00.000Z', text: 'Hello there' },
        { type: 'thinking', id: 't1', ts: '2026-04-14T10:00:01.000Z', text: 'Working through the request' },
        { type: 'tool_use', id: 'tool1', ts: '2026-04-14T10:00:02.000Z', tool: 'bash', input: { command: 'pwd' }, output: '/repo\n', toolCallId: 'call-1' },
        { type: 'text', id: 'a1', ts: '2026-04-14T10:00:03.000Z', text: 'Done.' },
        { type: 'user', id: 'u2', ts: '2026-04-14T10:01:00.000Z', text: 'Again' },
        { type: 'error', id: 'e1', ts: '2026-04-14T10:01:05.000Z', message: 'Boom' },
      ],
      blockOffset: 0,
      totalBlocks: 6,
      contextUsage: null,
      signature: 'sig-1',
    };

    const thread = buildCodexThreadFromSessionDetail({
      detail,
      modelProvider: 'openai-codex',
      cliVersion: '0.1.18',
    });

    expect(thread.id).toBe('conversation-1');
    expect(thread.status).toEqual({ type: 'idle' });
    expect(thread.turns).toHaveLength(2);
    expect(thread.turns[0]?.items).toEqual([
      {
        type: 'userMessage',
        id: 'u1',
        content: [{ type: 'text', text: 'Hello there', textElements: [] }],
      },
      {
        type: 'reasoning',
        id: 't1',
        summary: [],
        content: ['Working through the request'],
      },
      {
        type: 'dynamicToolCall',
        id: 'tool1',
        tool: 'bash',
        arguments: { command: 'pwd' },
        status: 'completed',
        contentItems: [{ type: 'inputText', text: '/repo\n' }],
        success: true,
        durationMs: null,
      },
      {
        type: 'agentMessage',
        id: 'a1',
        text: 'Done.',
        phase: null,
        memoryCitation: null,
      },
    ]);
    expect(thread.turns[1]?.status).toBe('failed');
    expect(thread.turns[1]?.error).toEqual({
      message: 'Boom',
      codexErrorInfo: null,
      additionalDetails: null,
    });
  });

  it('builds session detail blocks from codex thread turns', () => {
    const detail = buildSessionDetailFromCodexThread({
      thread: {
        id: 'conversation-2',
        forkedFromId: null,
        preview: 'hello',
        ephemeral: false,
        modelProvider: 'openai-codex',
        createdAt: 1713088800,
        updatedAt: 1713088860,
        status: { type: 'active', activeFlags: [] },
        path: '/sessions/conversation-2.jsonl',
        cwd: '/repo',
        cliVersion: '0.1.18',
        source: 'cli',
        agentNickname: null,
        agentRole: null,
        gitInfo: null,
        name: 'Remote workspace',
        turns: [
          {
            id: 'turn-1',
            status: 'completed',
            error: null,
            startedAt: 1713088800,
            completedAt: 1713088805,
            durationMs: 5000,
            items: [
              {
                type: 'userMessage',
                id: 'u1',
                content: [{ type: 'text', text: 'hello', textElements: [] }],
              },
              {
                type: 'agentMessage',
                id: 'a1',
                text: 'world',
                phase: null,
                memoryCitation: null,
              },
            ],
          },
        ],
      },
      model: 'gpt-5.4',
    });

    expect(detail.meta.id).toBe('conversation-2');
    expect(detail.meta.title).toBe('Remote workspace');
    expect(detail.meta.model).toBe('gpt-5.4');
    expect(detail.meta.isRunning).toBe(true);
    expect(detail.blocks).toEqual([
      { type: 'user', id: 'u1', ts: '2024-04-14T10:00:00.000Z', text: 'hello' },
      { type: 'text', id: 'a1', ts: '2024-04-14T10:00:05.000Z', text: 'world' },
    ]);
  });
});
