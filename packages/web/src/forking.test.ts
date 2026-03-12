import { describe, expect, it } from 'vitest';
import type { StorageLike } from './reloadState';
import type { MessageBlock } from './types';
import { buildConversationComposerStorageKey, persistForkPromptDraft, resolveForkEntryForMessage } from './forking';

function createStorage(): StorageLike & { getItem(key: string): string | null } {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

describe('resolveForkEntryForMessage', () => {
  it('maps an assistant reply to the preceding user turn fork entry', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-11T18:00:00.000Z', text: 'First prompt' },
      { type: 'text', ts: '2026-03-11T18:00:01.000Z', text: 'First reply' },
      { type: 'user', ts: '2026-03-11T18:00:02.000Z', text: 'Second prompt' },
      { type: 'text', ts: '2026-03-11T18:00:03.000Z', text: 'Second reply' },
    ];

    expect(resolveForkEntryForMessage(messages, 3, [
      { entryId: 'entry-1', text: 'First prompt' },
      { entryId: 'entry-2', text: 'Second prompt' },
    ])).toEqual({ entryId: 'entry-2', text: 'Second prompt' });
  });

  it('falls back to the latest fork entry when the transcript index runs ahead of persisted entries', () => {
    const messages: MessageBlock[] = [
      { type: 'user', ts: '2026-03-11T18:00:00.000Z', text: 'First prompt' },
      { type: 'text', ts: '2026-03-11T18:00:01.000Z', text: 'First reply' },
      { type: 'user', ts: '2026-03-11T18:00:02.000Z', text: 'Second prompt' },
    ];

    expect(resolveForkEntryForMessage(messages, 2, [
      { entryId: 'entry-1', text: 'First prompt' },
    ])).toEqual({ entryId: 'entry-1', text: 'First prompt' });
  });

  it('returns null when there is no prior user turn to fork from', () => {
    const messages: MessageBlock[] = [
      { type: 'thinking', ts: '2026-03-11T18:00:00.000Z', text: 'Working…' },
      { type: 'text', ts: '2026-03-11T18:00:01.000Z', text: 'Reply' },
    ];

    expect(resolveForkEntryForMessage(messages, 1, [
      { entryId: 'entry-1', text: 'Prompt' },
    ])).toBeNull();
  });
});

describe('buildConversationComposerStorageKey', () => {
  it('uses the conversation composer reload-state key', () => {
    expect(buildConversationComposerStorageKey('fork-123')).toBe('pa:reload:conversation:fork-123:composer');
  });
});

describe('persistForkPromptDraft', () => {
  it('stores the forked prompt for the destination conversation', () => {
    const storage = createStorage();

    persistForkPromptDraft('fork-123', 'Fork from this prompt', storage);

    expect(storage.getItem(buildConversationComposerStorageKey('fork-123'))).toBe(JSON.stringify('Fork from this prompt'));
  });

  it('clears the stored draft when the prompt is empty', () => {
    const storage = createStorage();
    const key = buildConversationComposerStorageKey('fork-123');

    storage.setItem(key, JSON.stringify('Existing draft'));
    persistForkPromptDraft('fork-123', '', storage);

    expect(storage.getItem(key)).toBeNull();
  });
});
