import { describe, expect, it } from 'vitest';
import {
  appendComposerHistory,
  buildComposerHistoryStorageKey,
  DRAFT_COMPOSER_HISTORY_SCOPE,
  MAX_COMPOSER_HISTORY_ENTRIES,
  readComposerHistory,
} from './composerHistory';
import type { StorageLike } from './local/reloadState';

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

describe('composerHistory', () => {
  it('uses the draft scope when no conversation id is provided', () => {
    expect(buildComposerHistoryStorageKey()).toBe(`pa:conversation-composer-history:${DRAFT_COMPOSER_HISTORY_SCOPE}`);
    expect(buildComposerHistoryStorageKey(' session-123 ')).toBe('pa:conversation-composer-history:session-123');
  });

  it('appends entries and normalizes line endings', () => {
    const storage = createStorage();

    expect(appendComposerHistory('session-123', 'hello\r\nworld', storage)).toEqual(['hello\nworld']);
    expect(appendComposerHistory('session-123', 'next', storage)).toEqual(['hello\nworld', 'next']);
    expect(readComposerHistory('session-123', storage)).toEqual(['hello\nworld', 'next']);
  });

  it('ignores blank and malformed stored entries', () => {
    const storage = createStorage();

    storage.setItem(buildComposerHistoryStorageKey('session-123'), JSON.stringify(['keep', '   ', null, 42, 'also keep']));

    expect(readComposerHistory('session-123', storage)).toEqual(['keep', 'also keep']);
  });

  it('keeps only the most recent history entries', () => {
    const storage = createStorage();

    for (let index = 0; index < MAX_COMPOSER_HISTORY_ENTRIES + 5; index += 1) {
      appendComposerHistory('session-123', `entry-${index}`, storage);
    }

    const history = readComposerHistory('session-123', storage);
    expect(history).toHaveLength(MAX_COMPOSER_HISTORY_ENTRIES);
    expect(history[0]).toBe('entry-5');
    expect(history.at(-1)).toBe(`entry-${MAX_COMPOSER_HISTORY_ENTRIES + 4}`);
  });
});
