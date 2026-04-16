import { describe, expect, it, vi } from 'vitest';
import type { StorageLike } from '../reloadState';
import { buildConversationComposerStorageKey } from '../forking';
import {
  buildPendingConversationPromptDispatchingStorageKey,
  buildPendingConversationPromptStorageKey,
  clearPendingConversationPrompt,
  consumePendingConversationPrompt,
  isPendingConversationPromptDispatching,
  persistPendingConversationPrompt,
  readPendingConversationPrompt,
  setPendingConversationPromptDispatching,
} from './pendingConversationPrompt';

function createStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) ?? null : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

describe('pendingConversationPrompt helpers', () => {
  it('builds a stable storage key per session', () => {
    expect(buildPendingConversationPromptStorageKey('session-123'))
      .toBe('pa:reload:conversation:session-123:pending-prompt');
  });

  it('persists and restores pending prompts', () => {
    const storage = createStorage();

    persistPendingConversationPrompt('session-123', {
      text: 'hello world',
      behavior: 'followUp',
      images: [{ mimeType: 'image/png', data: 'abc', name: 'diagram.png' }],
      attachmentRefs: [{ attachmentId: 'diagram-1' }],
      contextMessages: [{ customType: 'related_threads_context', content: 'Summaries from selected threads.' }],
      relatedConversationIds: ['conv-1', ' conv-2 ', 'conv-1'],
    }, storage);

    expect(readPendingConversationPrompt('session-123', storage)).toEqual({
      text: 'hello world',
      behavior: 'followUp',
      images: [{ mimeType: 'image/png', data: 'abc', name: 'diagram.png' }],
      attachmentRefs: [{ attachmentId: 'diagram-1' }],
      contextMessages: [{ customType: 'related_threads_context', content: 'Summaries from selected threads.' }],
      relatedConversationIds: ['conv-1', 'conv-2'],
    });
  });

  it('keeps prompts available in memory even when storage is unavailable', () => {
    persistPendingConversationPrompt('session-in-memory', {
      text: 'hello world',
      images: [],
      attachmentRefs: [],
    }, null);

    expect(readPendingConversationPrompt('session-in-memory', null)).toEqual({
      text: 'hello world',
      images: [],
      attachmentRefs: [],
    });

    clearPendingConversationPrompt('session-in-memory', null);
    expect(readPendingConversationPrompt('session-in-memory', null)).toBeNull();
  });

  it('consumes pending prompts at most once', () => {
    const storage = createStorage();
    const composerKey = buildConversationComposerStorageKey('session-123');

    persistPendingConversationPrompt('session-123', {
      text: 'hello world',
      behavior: 'steer',
      images: [],
      attachmentRefs: [],
    }, storage);
    storage.setItem(composerKey, JSON.stringify('hello world'));

    expect(consumePendingConversationPrompt('session-123', storage)).toEqual({
      text: 'hello world',
      behavior: 'steer',
      images: [],
      attachmentRefs: [],
    });
    expect(storage.getItem(composerKey)).toBeNull();
    expect(consumePendingConversationPrompt('session-123', storage)).toBeNull();
    expect(readPendingConversationPrompt('session-123', storage)).toBeNull();
  });

  it('clears pending prompts explicitly', () => {
    const storage = createStorage();

    persistPendingConversationPrompt('session-123', {
      text: 'hello world',
      images: [],
      attachmentRefs: [],
    }, storage);
    clearPendingConversationPrompt('session-123', storage);

    expect(readPendingConversationPrompt('session-123', storage)).toBeNull();
  });

  it('removes empty prompts instead of keeping stale storage', () => {
    const storage = createStorage();

    persistPendingConversationPrompt('session-123', {
      text: 'hello world',
      images: [],
      attachmentRefs: [],
    }, storage);
    persistPendingConversationPrompt('session-123', {
      text: '',
      images: [],
      attachmentRefs: [],
    }, storage);

    expect(readPendingConversationPrompt('session-123', storage)).toBeNull();
  });

  it('keeps related-thread staging metadata even before the prompt starts', () => {
    const storage = createStorage();

    persistPendingConversationPrompt('session-123', {
      text: '',
      images: [],
      attachmentRefs: [],
      relatedConversationIds: ['conv-1'],
    }, storage);

    expect(readPendingConversationPrompt('session-123', storage)).toEqual({
      text: '',
      images: [],
      attachmentRefs: [],
      relatedConversationIds: ['conv-1'],
    });
  });

  it('tracks background initial-prompt dispatch state per session', () => {
    const storage = createStorage();

    expect(isPendingConversationPromptDispatching('session-123', storage)).toBe(false);

    setPendingConversationPromptDispatching('session-123', true, storage);
    expect(isPendingConversationPromptDispatching('session-123', storage)).toBe(true);

    setPendingConversationPromptDispatching('session-123', false, storage);
    expect(isPendingConversationPromptDispatching('session-123', storage)).toBe(false);
  });

  it('reuses recently persisted dispatching state across navigation but drops stale entries', () => {
    const storage = createStorage();
    const nowSpy = vi.spyOn(Date, 'now');
    const key = buildPendingConversationPromptDispatchingStorageKey('session-123');

    nowSpy.mockReturnValue(1_000);
    setPendingConversationPromptDispatching('session-123', true, storage);
    setPendingConversationPromptDispatching('session-123', false, null);

    nowSpy.mockReturnValue(30_000);
    expect(isPendingConversationPromptDispatching('session-123', storage)).toBe(true);

    storage.setItem(key, '1000');
    nowSpy.mockReturnValue(200_000);
    expect(isPendingConversationPromptDispatching('session-123', storage)).toBe(false);

    nowSpy.mockRestore();
  });
});
