import { describe, expect, it } from 'vitest';
import type { PendingConversationPrompt } from './pendingConversationPrompt';
import type { MessageBlock } from '../shared/types';
import { appendPendingInitialPromptBlock, buildConversationPendingQueueItems, resolveRestoredQueuedPromptComposerUpdate } from './pendingQueueMessages';

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

  it('builds typed conversation pending queue items from stream previews', () => {
    expect(buildConversationPendingQueueItems({
      steering: [
        { id: 'steer-1', text: 'steer me', imageCount: 1 },
      ],
      followUp: [
        { id: 'follow-1', text: 'later', imageCount: 0, restorable: false },
      ],
    })).toEqual([
      {
        id: 'steer-1',
        text: 'steer me',
        imageCount: 1,
        restorable: true,
        type: 'steer',
        queueIndex: 0,
      },
      {
        id: 'follow-1',
        text: 'later',
        imageCount: 0,
        restorable: false,
        type: 'followUp',
        queueIndex: 0,
      },
    ]);
  });

  it('resolves restored queued prompt composer updates and notices', () => {
    expect(resolveRestoredQueuedPromptComposerUpdate({
      restoredText: 'restored text',
      currentInput: 'existing draft',
      restoredFileCount: 2,
    })).toEqual({
      hasRestoredText: true,
      hasContent: true,
      nextInput: 'restored text\n\nexisting draft',
      noticeText: 'Restored queued text + 2 images to the composer.',
    });

    expect(resolveRestoredQueuedPromptComposerUpdate({
      restoredText: '   ',
      currentInput: 'existing draft',
      restoredFileCount: 1,
    })).toEqual({
      hasRestoredText: false,
      hasContent: true,
      nextInput: null,
      noticeText: 'Restored queued 1 image to the composer.',
    });

    expect(resolveRestoredQueuedPromptComposerUpdate({
      restoredText: '',
      currentInput: '',
      restoredFileCount: 0,
    }).hasContent).toBe(false);
  });
});
