import { describe, expect, it } from 'vitest';
import type { PendingConversationPrompt } from './pendingConversationPrompt';
import type { MessageBlock } from '../types';
import { appendPendingInitialPromptBlock } from './pendingQueueMessages';

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
