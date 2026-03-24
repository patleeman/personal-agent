import { describe, expect, it } from 'vitest';
import type { PendingConversationPrompt } from './pendingConversationPrompt';
import type { MessageBlock } from './types';
import { appendPendingInitialPromptBlock, appendPendingQueueBlocks, type PendingQueuePreviewItem } from './pendingQueueMessages';

describe('appendPendingInitialPromptBlock', () => {
  const pendingPrompt: PendingConversationPrompt = {
    text: 'first prompt still on the way',
    images: [],
    attachmentRefs: [],
  };

  it('appends a pending initial prompt to an empty transcript', () => {
    expect(appendPendingInitialPromptBlock(undefined, pendingPrompt, '2026-03-24T00:00:00.000Z')).toEqual([
      {
        type: 'user',
        id: 'pending-initial-prompt',
        ts: '2026-03-24T00:00:00.000Z',
        text: 'first prompt still on the way',
      },
    ]);
  });

  it('does not duplicate a trailing user block that already matches the pending prompt', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-24T00:00:00.000Z', text: 'first prompt still on the way' },
    ];

    expect(appendPendingInitialPromptBlock(messages, pendingPrompt, '2026-03-24T00:00:01.000Z')).toEqual(messages);
  });

  it('preserves pending prompt image previews', () => {
    const promptWithImage: PendingConversationPrompt = {
      text: '',
      images: [{ mimeType: 'image/png', data: 'ZmFrZQ==', name: 'draft.png', previewUrl: 'blob:preview' }],
      attachmentRefs: [],
    };

    expect(appendPendingInitialPromptBlock(undefined, promptWithImage, '2026-03-24T00:00:02.000Z')).toEqual([
      {
        type: 'user',
        id: 'pending-initial-prompt',
        ts: '2026-03-24T00:00:02.000Z',
        text: '',
        images: [{ alt: 'draft.png', src: 'blob:preview', mimeType: 'image/png', caption: 'draft.png' }],
      },
    ]);
  });
});

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
