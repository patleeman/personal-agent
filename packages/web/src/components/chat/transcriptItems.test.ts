import { describe, expect, it } from 'vitest';
import type { MessageBlock } from '../../shared/types';
import {
  buildChatRenderItems,
  isTraceConversationBlock,
  summarizeTraceCluster,
} from './transcriptItems.js';

describe('chat transcript items', () => {
  it('groups consecutive internal trace blocks into one cluster', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-12T18:00:00.000Z', text: 'Check the transcript layout' },
      { type: 'thinking', ts: '2026-03-12T18:00:01.000Z', text: 'Plan the work' },
      { type: 'tool_use', ts: '2026-03-12T18:00:02.000Z', tool: 'bash', input: { command: 'pwd' }, output: '/repo', durationMs: 1100, status: 'ok' },
      { type: 'tool_use', ts: '2026-03-12T18:00:03.000Z', tool: 'read', input: { path: 'ChatView.tsx' }, output: '...', durationMs: 900, status: 'ok' },
      { type: 'text', ts: '2026-03-12T18:00:04.000Z', text: 'Here is the result.' },
    ];

    const items = buildChatRenderItems(messages);

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ type: 'message', index: 0 });
    expect(items[1]).toMatchObject({ type: 'trace_cluster', startIndex: 1, endIndex: 3 });
    expect(items[2]).toMatchObject({ type: 'message', index: 4 });
  });

  it('keeps artifact tool blocks visible as standalone message items', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-12T18:00:00.000Z', text: 'Show me the mockup' },
      { type: 'tool_use', ts: '2026-03-12T18:00:01.000Z', tool: 'artifact', input: { action: 'save' }, output: 'Saved artifact', status: 'ok' },
      { type: 'text', ts: '2026-03-12T18:00:02.000Z', text: 'Opened the artifact.' },
    ];

    const items = buildChatRenderItems(messages);

    expect(items).toHaveLength(3);
    expect(items.every((item) => item.type === 'message')).toBe(true);
    expect(isTraceConversationBlock(messages[1]!)).toBe(false);
  });

  it('keeps terminal-style bash blocks visible as standalone message items', () => {
    const messages: MessageBlock[] = [
      { type: 'text', ts: '2026-03-12T18:00:00.000Z', text: 'Retry it directly.' },
      {
        type: 'tool_use',
        ts: '2026-03-12T18:00:01.000Z',
        tool: 'bash',
        input: { command: 'npm run release:publish' },
        output: '/bin/bash: npm: command not found',
        status: 'error',
        details: { displayMode: 'terminal', exitCode: 127 },
      },
    ];

    const items = buildChatRenderItems(messages);

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.type === 'message')).toBe(true);
    expect(isTraceConversationBlock(messages[1]!)).toBe(false);
  });

  it('keeps ask_user_question tool blocks visible as standalone message items', () => {
    const messages: MessageBlock[] = [
      { type: 'text', ts: '2026-03-12T18:00:00.000Z', text: 'I need one clarification.' },
      {
        type: 'tool_use',
        ts: '2026-03-12T18:00:01.000Z',
        tool: 'ask_user_question',
        input: { question: 'Which environment should I use?', options: ['staging', 'prod'] },
        output: 'Asked the user: Which environment should I use?',
        status: 'ok',
      },
    ];

    const items = buildChatRenderItems(messages);

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.type === 'message')).toBe(true);
    expect(isTraceConversationBlock(messages[1]!)).toBe(false);
  });

  it('summarizes trace categories, duration, and running/error state', () => {
    const summary = summarizeTraceCluster([
      { type: 'thinking', ts: '2026-03-12T18:00:00.000Z', text: 'Thinking…' },
      { type: 'tool_use', ts: '2026-03-12T18:00:01.000Z', tool: 'bash', input: {}, output: '', durationMs: 1400, status: 'ok' },
      { type: 'tool_use', ts: '2026-03-12T18:00:02.000Z', tool: 'bash', input: {}, output: '', status: 'running' },
      { type: 'error', ts: '2026-03-12T18:00:03.000Z', message: 'boom' },
    ]);

    expect(summary.stepCount).toBe(4);
    expect(summary.durationMs).toBe(1400);
    expect(summary.hasRunning).toBe(true);
    expect(summary.hasError).toBe(true);
    expect(summary.categories).toEqual([
      { key: 'thinking', kind: 'thinking', label: 'thinking', count: 1 },
      { key: 'tool:bash', kind: 'tool', label: 'bash', tool: 'bash', count: 2 },
      { key: 'error', kind: 'error', label: 'error', count: 1 },
    ]);
  });

});
