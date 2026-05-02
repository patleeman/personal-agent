import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MessageBlock } from '../shared/types';
import type { PendingConversationPrompt } from './pendingConversationPrompt';
import {
  appendPendingInitialPromptBlock,
  buildConversationPendingQueueItems,
  resolveRestoredQueuedPromptComposerUpdate,
} from './pendingQueueMessages';

afterEach(() => {
  vi.useRealTimers();
});

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

  it('falls back to the current clock for malformed pending prompt timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

    expect(appendPendingInitialPromptBlock(undefined, pendingPrompt, 'not-a-date')).toEqual([
      {
        type: 'user',
        id: 'pending-initial-prompt',
        ts: '2026-03-24T00:00:00.000Z',
        text: 'first prompt still on the way',
      },
    ]);
  });

  it('falls back to the current clock for non-ISO pending prompt timestamps', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-24T00:00:00.000Z'));

    expect(appendPendingInitialPromptBlock(undefined, pendingPrompt, '1')).toEqual([
      {
        type: 'user',
        id: 'pending-initial-prompt',
        ts: '2026-03-24T00:00:00.000Z',
        text: 'first prompt still on the way',
      },
    ]);
  });

  it('does not duplicate a trailing user block that already matches the pending prompt', () => {
    const messages: MessageBlock[] = [{ type: 'user', ts: '2026-03-24T00:00:00.000Z', text: 'first prompt still on the way' }];

    expect(appendPendingInitialPromptBlock(messages, pendingPrompt, '2026-03-24T00:00:01.000Z')).toEqual(messages);
  });

  it('does not duplicate a trailing pending image block when mime casing differs', () => {
    const promptWithImage: PendingConversationPrompt = {
      text: 'first prompt still on the way',
      images: [{ mimeType: 'IMAGE/PNG', data: 'ZmFrZQ==', name: 'draft.png', previewUrl: 'blob:preview' }],
      attachmentRefs: [],
    };
    const messages: MessageBlock[] = [
      {
        type: 'user',
        ts: '2026-03-24T00:00:00.000Z',
        text: 'first prompt still on the way',
        images: [{ alt: 'draft.png', src: 'blob:preview', mimeType: 'image/png', caption: 'draft.png' }],
      },
    ];

    expect(appendPendingInitialPromptBlock(messages, promptWithImage, '2026-03-24T00:00:01.000Z')).toEqual(messages);
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

  it('falls back to pending prompt image data urls when previews are missing', () => {
    const promptWithStoredImage: PendingConversationPrompt = {
      text: '',
      images: [{ mimeType: 'image/png', data: 'ZmFrZQ==', name: 'stored.png' }],
      attachmentRefs: [],
    };

    expect(appendPendingInitialPromptBlock(undefined, promptWithStoredImage, '2026-03-24T00:00:02.000Z')).toEqual([
      {
        type: 'user',
        id: 'pending-initial-prompt',
        ts: '2026-03-24T00:00:02.000Z',
        text: '',
        images: [{ alt: 'stored.png', src: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png', caption: 'stored.png' }],
      },
    ]);
  });

  it('ignores unsafe pending prompt image preview urls', () => {
    const promptWithStoredImage: PendingConversationPrompt = {
      text: '',
      images: [
        { mimeType: 'image/png', data: 'ZmFrZQ==', name: 'stored.png', previewUrl: 'data:text/html;base64,PHNjcmlwdA==' },
        { mimeType: 'image/png', data: 'aGVsbG8=', name: 'plain.png', previewUrl: 'data:image/png,aGVsbG8=' },
        { mimeType: 'image/png', data: 'b2s=', name: 'malformed.png', previewUrl: 'data:image/png;base64,not-valid-base64!' },
      ],
      attachmentRefs: [],
    };

    expect(appendPendingInitialPromptBlock(undefined, promptWithStoredImage, '2026-03-24T00:00:02.000Z')).toEqual([
      {
        type: 'user',
        id: 'pending-initial-prompt',
        ts: '2026-03-24T00:00:02.000Z',
        text: '',
        images: [
          { alt: 'stored.png', src: 'data:image/png;base64,ZmFrZQ==', mimeType: 'image/png', caption: 'stored.png' },
          { alt: 'plain.png', src: 'data:image/png;base64,aGVsbG8=', mimeType: 'image/png', caption: 'plain.png' },
          { alt: 'malformed.png', src: 'data:image/png;base64,b2s=', mimeType: 'image/png', caption: 'malformed.png' },
        ],
      },
    ]);
  });

  it('does not hide a pending image prompt behind a different trailing image', () => {
    const promptWithImage: PendingConversationPrompt = {
      text: 'same text',
      images: [{ mimeType: 'image/png', data: 'bmV3', name: 'new.png', previewUrl: 'blob:new' }],
      attachmentRefs: [],
    };
    const messages: MessageBlock[] = [
      {
        type: 'user',
        ts: '2026-03-24T00:00:00.000Z',
        text: 'same text',
        images: [{ alt: 'old.png', src: 'blob:old', mimeType: 'image/png', caption: 'old.png' }],
      },
    ];

    expect(appendPendingInitialPromptBlock(messages, promptWithImage, '2026-03-24T00:00:02.000Z')).toEqual([
      ...messages,
      {
        type: 'user',
        id: 'pending-initial-prompt',
        ts: '2026-03-24T00:00:02.000Z',
        text: 'same text',
        images: [{ alt: 'new.png', src: 'blob:new', mimeType: 'image/png', caption: 'new.png' }],
      },
    ]);
  });

  it('builds typed conversation pending queue items from stream previews', () => {
    expect(
      buildConversationPendingQueueItems({
        steering: [{ id: 'steer-1', text: 'steer me', imageCount: 1 }],
        followUp: [{ id: 'follow-1', text: 'later', imageCount: 0, restorable: false }],
      }),
    ).toEqual([
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
    expect(
      resolveRestoredQueuedPromptComposerUpdate({
        restoredText: 'restored text',
        currentInput: 'existing draft',
        restoredFileCount: 2,
      }),
    ).toEqual({
      hasRestoredText: true,
      hasContent: true,
      nextInput: 'restored text\n\nexisting draft',
      noticeText: 'Restored queued text + 2 images to the composer.',
    });

    expect(
      resolveRestoredQueuedPromptComposerUpdate({
        restoredText: '   ',
        currentInput: 'existing draft',
        restoredFileCount: 1,
      }),
    ).toEqual({
      hasRestoredText: false,
      hasContent: true,
      nextInput: null,
      noticeText: 'Restored queued 1 image to the composer.',
    });

    expect(
      resolveRestoredQueuedPromptComposerUpdate({
        restoredText: '',
        currentInput: '',
        restoredFileCount: 0,
      }).hasContent,
    ).toBe(false);

    expect(
      resolveRestoredQueuedPromptComposerUpdate({
        restoredText: 'restored text',
        currentInput: '',
        restoredFileCount: 1.5,
      }),
    ).toEqual({
      hasRestoredText: true,
      hasContent: true,
      nextInput: 'restored text',
      noticeText: 'Restored queued text to the composer.',
    });

    expect(
      resolveRestoredQueuedPromptComposerUpdate({
        restoredText: 'restored text',
        currentInput: '',
        restoredFileCount: Number.MAX_SAFE_INTEGER,
      }).noticeText,
    ).toBe('Restored queued text to the composer.');
  });
});
