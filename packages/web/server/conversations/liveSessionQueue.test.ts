import { describe, expect, it } from 'vitest';
import {
  extractQueuedPromptContent,
  isVisibleQueueFallbackPreviewId,
  normalizeQueuedPromptBehavior,
  readQueueState,
  removeQueuedUserMessage,
} from './liveSessionQueue.js';

describe('liveSessionQueue', () => {
  it('normalizes prompt behavior only when a prompt must be queued', () => {
    expect(normalizeQueuedPromptBehavior(undefined, { isStreaming: false, hasHiddenTurnQueued: false })).toBeUndefined();
    expect(normalizeQueuedPromptBehavior(undefined, { isStreaming: true, hasHiddenTurnQueued: false })).toBe('followUp');
    expect(normalizeQueuedPromptBehavior('steer', { isStreaming: true, hasHiddenTurnQueued: false })).toBe('steer');
    expect(normalizeQueuedPromptBehavior(undefined, { isStreaming: false, hasHiddenTurnQueued: true })).toBe('followUp');
  });

  it('builds previews from internal queued user messages and keeps image-only prompts restorable', () => {
    const imageMessage = {
      role: 'user',
      content: [{ type: 'image', data: 'abc', mimeType: 'image/png', name: 'shot.png' }],
    };
    const textMessage = {
      role: 'user',
      content: [{ type: 'text', text: 'Follow up please' }],
    };
    const session = {
      getSteeringMessages: () => [''],
      getFollowUpMessages: () => ['Follow up please'],
      agent: {
        steeringQueue: [imageMessage],
        followUpQueue: { messages: [{ role: 'assistant', content: [] }, textMessage] },
      },
    };

    const state = readQueueState(session as never);

    expect(state.steering).toEqual([{ id: expect.stringMatching(/^steer-queued-/), text: '', imageCount: 1 }]);
    expect(state.followUp).toEqual([{ id: expect.stringMatching(/^followUp-queued-/), text: 'Follow up please', imageCount: 0 }]);
    expect(Object.keys(imageMessage)).not.toContain('__personalAgentQueuedPromptId');
  });

  it('removes queued user messages by preview id without counting assistant messages', () => {
    const queue = [
      { role: 'assistant', content: [] },
      { role: 'user', content: [], __personalAgentQueuedPromptId: 'first' },
      { role: 'user', content: [], __personalAgentQueuedPromptId: 'second' },
    ];

    const removed = removeQueuedUserMessage(queue, { index: 0, previewId: 'second' });

    expect(removed?.userQueueIndex).toBe(1);
    expect(removed?.message.__personalAgentQueuedPromptId).toBe('second');
    expect(queue.map((message) => message.__personalAgentQueuedPromptId)).toEqual([undefined, 'first']);
  });

  it('extracts queued prompt text and image attachments', () => {
    const extracted = extractQueuedPromptContent({
      role: 'user',
      content: [
        { type: 'text', text: 'Hello ' },
        { type: 'text', text: 'world' },
        { type: 'image', data: 'abc', mimeType: 'image/jpeg', name: 'photo.jpg' },
      ],
    }, 'fallback');

    expect(extracted).toEqual({
      text: 'Hello world',
      images: [{ type: 'image', data: 'abc', mimeType: 'image/jpeg', name: 'photo.jpg' }],
    });
    expect(extractQueuedPromptContent(undefined, 'fallback').text).toBe('fallback');
    expect(isVisibleQueueFallbackPreviewId('steer', 'steer-visible-0')).toBe(true);
  });
});
