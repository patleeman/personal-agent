import { describe, expect, it } from 'vitest';
import type { StorageLike } from './reloadState';
import { buildConversationComposerStorageKey } from './forking';
import {
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
    }, storage);

    expect(readPendingConversationPrompt('session-123', storage)).toEqual({
      text: 'hello world',
      behavior: 'followUp',
      images: [{ mimeType: 'image/png', data: 'abc', name: 'diagram.png' }],
      attachmentRefs: [{ attachmentId: 'diagram-1' }],
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

  it('tracks background initial-prompt dispatch state per session', () => {
    const storage = createStorage();

    expect(isPendingConversationPromptDispatching('session-123')).toBe(false);

    setPendingConversationPromptDispatching('session-123', true, storage);
    expect(isPendingConversationPromptDispatching('session-123')).toBe(true);

    setPendingConversationPromptDispatching('session-123', false, storage);
    expect(isPendingConversationPromptDispatching('session-123')).toBe(false);
  });
});
