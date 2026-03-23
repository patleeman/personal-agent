import { describe, expect, it } from 'vitest';
import type { MessageBlock } from './types';
import { appendPendingQueueBlocks, type PendingQueuePreviewItem } from './pendingQueueMessages';

describe('appendPendingQueueBlocks', () => {
  const queue: PendingQueuePreviewItem[] = [
    { id: 'followup-0', text: 'queued follow-up', type: 'followUp', queueIndex: 0 },
  ];

  it('returns the original messages when nothing is queued', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-23T00:00:00.000Z', text: 'hello' },
    ];

    expect(appendPendingQueueBlocks(messages, [], '2026-03-23T00:00:01.000Z')).toEqual(messages);
  });

  it('appends queued prompts to the visible transcript', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-23T00:00:00.000Z', text: 'hello' },
      { type: 'text', ts: '2026-03-23T00:00:01.000Z', text: 'hi' },
    ];

    expect(appendPendingQueueBlocks(messages, queue, '2026-03-23T00:00:02.000Z')).toEqual([
      ...messages,
      {
        type: 'user',
        id: 'queued-followUp-0',
        ts: '2026-03-23T00:00:02.000Z',
        text: 'queued follow-up',
      },
    ]);
  });

  it('does not duplicate a trailing optimistic user block that already matches the queued prompt', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-23T00:00:00.000Z', text: 'hello' },
      { type: 'text', ts: '2026-03-23T00:00:01.000Z', text: 'hi' },
      { type: 'user', ts: '2026-03-23T00:00:02.000Z', text: 'queued follow-up' },
    ];

    expect(appendPendingQueueBlocks(messages, queue, '2026-03-23T00:00:03.000Z')).toEqual(messages);
  });

  it('shows queued prompts even when the transcript is still empty', () => {
    expect(appendPendingQueueBlocks(undefined, queue, '2026-03-23T00:00:00.000Z')).toEqual([
      {
        type: 'user',
        id: 'queued-followUp-0',
        ts: '2026-03-23T00:00:00.000Z',
        text: 'queued follow-up',
      },
    ]);
  });
});
