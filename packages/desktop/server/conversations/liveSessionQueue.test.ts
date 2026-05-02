import { describe, expect, it } from 'vitest';
import {
  extractQueuedPromptContent,
  isVisibleQueueFallbackPreviewId,
  normalizeQueuedPromptBehavior,
  readQueueState,
  removeQueuedUserMessage,
} from './liveSessionQueue.js';
import { restoreLiveSessionQueuedMessage } from './liveSessionQueueOperations.js';

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

  it('drops malformed queued prompt image attachments when restoring content', () => {
    const extracted = extractQueuedPromptContent({
      role: 'user',
      content: [
        { type: 'image', data: 'abc', mimeType: ' image/png ', name: ' shot.png ' },
        { type: 'image', data: '', mimeType: 'image/png' },
        { type: 'image', data: '   ', mimeType: 'image/png' },
        { type: 'image', data: 'not-valid-base64!', mimeType: 'image/png' },
        { type: 'image', data: 'missing-mime', mimeType: '' },
        { type: 'image', data: 'aGVsbG8=', mimeType: 'text/plain' },
      ],
    }, 'fallback');

    expect(extracted).toEqual({
      text: 'fallback',
      images: [{ type: 'image', data: 'abc', mimeType: 'image/png', name: 'shot.png' }],
    });
  });

  it('falls back to visible queued text when internal queued text is blank', () => {
    const extracted = extractQueuedPromptContent({
      role: 'user',
      content: [{ type: 'text', text: '   ' }],
    }, 'visible fallback');

    expect(extracted).toEqual({ text: 'visible fallback', images: [] });
  });

  it('matches internal queued prompts against trimmed visible queue text', () => {
    const previews = readQueueState({
      getSteeringMessages: () => ['Trim me'],
      getFollowUpMessages: () => [],
      agent: {
        steeringQueue: [{
          role: 'user',
          content: [
            { type: 'text', text: '  Trim me  ' },
            { type: 'image', data: 'abc', mimeType: 'image/png' },
          ],
        }],
      },
    } as never);

    expect(previews.steering).toEqual([{
      id: expect.stringMatching(/^steer-queued-/),
      text: 'Trim me',
      imageCount: 1,
    }]);
  });

  it('restores by preview id without removing the wrong visible queued prompt when the index is stale', async () => {
    const steeringMessages = ['first queued prompt', 'second queued prompt'];
    const steeringQueue = [
      { role: 'user', content: [{ type: 'text', text: 'first queued prompt' }], __personalAgentQueuedPromptId: 'first' },
      { role: 'user', content: [{ type: 'text', text: 'second queued prompt' }], __personalAgentQueuedPromptId: 'second' },
    ];

    const restored = await restoreLiveSessionQueuedMessage({
      session: {
        agent: { steeringQueue, followUpQueue: [] },
        getSteeringMessages: () => steeringMessages,
        getFollowUpMessages: () => [],
        clearQueue: () => ({ steering: [], followUp: [] }),
        steer: async () => undefined,
        followUp: async () => undefined,
      },
    }, 'steer', 0, 'second');

    expect(restored.text).toBe('second queued prompt');
    expect(steeringMessages).toEqual(['first queued prompt']);
    expect(steeringQueue.map((message) => message.__personalAgentQueuedPromptId)).toEqual(['first']);
  });

  it('rejects unsafe queued prompt restore indexes', async () => {
    await expect(restoreLiveSessionQueuedMessage({
      session: {
        agent: { steeringQueue: [], followUpQueue: [] },
        getSteeringMessages: () => [],
        getFollowUpMessages: () => [],
        clearQueue: () => ({ steering: [], followUp: [] }),
        steer: async () => undefined,
        followUp: async () => undefined,
      },
    }, 'steer', Number.MAX_SAFE_INTEGER + 1)).rejects.toThrow('Queued message index must be a non-negative integer');
  });

  it('restores visible-only queued prompts by preview id when the index is stale', async () => {
    const steeringMessages = ['first queued prompt', 'second queued prompt'];
    const steer = async (text: string) => {
      steeringMessages.push(text);
    };

    const restored = await restoreLiveSessionQueuedMessage({
      session: {
        agent: {},
        getSteeringMessages: () => steeringMessages,
        getFollowUpMessages: () => [],
        clearQueue: () => ({ steering: steeringMessages.splice(0), followUp: [] }),
        steer,
        followUp: async () => undefined,
      },
    }, 'steer', 0, 'steer-visible-1');

    expect(restored.text).toBe('second queued prompt');
    expect(steeringMessages).toEqual(['first queued prompt']);
  });
});
