import { describe, expect, it } from 'vitest';
import {
  collectConversationRunMentions,
  createConversationLiveRunId,
  extractDurableRunIdsFromBlock,
  extractDurableRunIdsFromText,
  getConversationRunIdFromSearch,
  setConversationRunIdInSearch,
} from './conversationRuns.js';
import type { MessageBlock } from './types';

describe('conversationRuns helpers', () => {
  it('reads and writes the selected run search param', () => {
    expect(getConversationRunIdFromSearch('?run=run-code-review-2026-03-13-abcd1234')).toBe('run-code-review-2026-03-13-abcd1234');
    expect(setConversationRunIdInSearch('?artifact=demo', 'run-code-review-2026-03-13-abcd1234')).toBe('?artifact=demo&run=run-code-review-2026-03-13-abcd1234');
    expect(setConversationRunIdInSearch('?artifact=demo&run=run-code-review-2026-03-13-abcd1234', null)).toBe('?artifact=demo');
  });

  it('creates the live conversation run id with the same sanitizing rules as the daemon', () => {
    expect(createConversationLiveRunId('conv:123 / demo')).toBe('conversation-live-conv-123-demo');
  });

  it('extracts durable run ids from CLI-like text and ignores incidental file names', () => {
    const text = [
      'Run        run-code-review-2026-03-13T17-42-11-000Z-abcd1234',
      'Inspect    pa runs show run-code-review-2026-03-13T17-42-11-000Z-abcd1234',
      'Log path   /tmp/run-now.task.md',
      '{"runId":"task-nightly-review-2026-03-13T17-45-00-000Z-12345678"}',
      'conversation-live-conv-123',
    ].join('\n');

    expect(extractDurableRunIdsFromText(text)).toEqual([
      'run-code-review-2026-03-13T17-42-11-000Z-abcd1234',
      'task-nightly-review-2026-03-13T17-45-00-000Z-12345678',
      'conversation-live-conv-123',
    ]);
  });

  it('extracts run ids from tool blocks', () => {
    const block: Extract<MessageBlock, { type: 'tool_use' }> = {
      type: 'tool_use',
      ts: '2026-03-13T18:00:00.000Z',
      tool: 'bash',
      input: { command: 'pa runs logs run-code-review-2026-03-13T17-42-11-000Z-abcd1234' },
      output: 'Run        run-code-review-2026-03-13T17-42-11-000Z-abcd1234\n',
    };

    expect(extractDurableRunIdsFromBlock(block)).toEqual([
      'run-code-review-2026-03-13T17-42-11-000Z-abcd1234',
    ]);
  });

  it('collects unique run mentions across a conversation', () => {
    const messages: MessageBlock[] = [
      {
        type: 'tool_use',
        ts: '2026-03-13T18:00:00.000Z',
        tool: 'bash',
        input: { command: 'pa runs start code-review -- pa -p "review this diff"' },
        output: 'Run        run-code-review-2026-03-13T17-42-11-000Z-abcd1234\nInspect    pa runs show run-code-review-2026-03-13T17-42-11-000Z-abcd1234',
      },
      {
        type: 'text',
        ts: '2026-03-13T18:01:00.000Z',
        text: 'I checked conversation-live-conv-123 and the background run run-code-review-2026-03-13T17-42-11-000Z-abcd1234.',
      },
      {
        type: 'tool_use',
        ts: '2026-03-13T18:02:00.000Z',
        tool: 'bash',
        input: { command: 'pa runs show task-nightly-review-2026-03-13T17-45-00-000Z-12345678' },
        output: '',
      },
    ];

    expect(collectConversationRunMentions(messages)).toEqual([
      {
        runId: 'task-nightly-review-2026-03-13T17-45-00-000Z-12345678',
        firstMessageIndex: 2,
        lastMessageIndex: 2,
        firstSeenAt: '2026-03-13T18:02:00.000Z',
        lastSeenAt: '2026-03-13T18:02:00.000Z',
        mentionCount: 1,
      },
      {
        runId: 'run-code-review-2026-03-13T17-42-11-000Z-abcd1234',
        firstMessageIndex: 0,
        lastMessageIndex: 1,
        firstSeenAt: '2026-03-13T18:00:00.000Z',
        lastSeenAt: '2026-03-13T18:01:00.000Z',
        mentionCount: 2,
      },
      {
        runId: 'conversation-live-conv-123',
        firstMessageIndex: 1,
        lastMessageIndex: 1,
        firstSeenAt: '2026-03-13T18:01:00.000Z',
        lastSeenAt: '2026-03-13T18:01:00.000Z',
        mentionCount: 1,
      },
    ]);
  });
});
