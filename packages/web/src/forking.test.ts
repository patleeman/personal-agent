import { describe, expect, it } from 'vitest';
import type { StorageLike } from './local/reloadState';
import type { MessageBlock } from './types';
import { buildConversationComposerStorageKey, clearConversationComposerDraft, persistForkPromptDraft, resolveBranchEntryIdForMessage, resolveForkEntryForMessage, resolveSessionEntryIdFromBlockId } from './forking';

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

describe('resolveSessionEntryIdFromBlockId', () => {
  it('strips rendered block suffixes back to the source session entry id', () => {
    expect(resolveSessionEntryIdFromBlockId('entry-123-x4')).toBe('entry-123');
    expect(resolveSessionEntryIdFromBlockId('entry-123-t4')).toBe('entry-123');
    expect(resolveSessionEntryIdFromBlockId('entry-123-e4')).toBe('entry-123');
  });

  it('returns the input unchanged when it is already a session entry id', () => {
    expect(resolveSessionEntryIdFromBlockId('entry-123')).toBe('entry-123');
  });
});

describe('resolveBranchEntryIdForMessage', () => {
  it('returns the direct entry id when the rendered block already has one', () => {
    expect(resolveBranchEntryIdForMessage(
      { type: 'text', id: 'assistant-123-x4', ts: '2026-03-29T12:00:00.000Z', text: 'Reply' },
      7,
      {
        blockOffset: 0,
        blocks: [],
      },
    )).toBe('assistant-123');
  });

  it('recovers the entry id from persisted session detail when the live block is missing one', () => {
    expect(resolveBranchEntryIdForMessage(
      { type: 'text', ts: '2026-03-29T12:00:00.000Z', text: 'Latest reply' },
      5,
      {
        blockOffset: 3,
        blocks: [
          { type: 'thinking', id: 'assistant-123-t3', ts: '2026-03-29T11:59:58.000Z', text: 'Thinking…' },
          { type: 'tool_use', id: 'assistant-123-c4', ts: '2026-03-29T11:59:59.000Z', tool: 'bash', input: {}, output: '[]', toolCallId: 'tool-1' },
          { type: 'text', id: 'assistant-123-x5', ts: '2026-03-29T12:00:01.000Z', text: 'Latest reply' },
        ],
      },
    )).toBe('assistant-123');
  });

  it('falls back to a nearby matching persisted block when the expected index is off', () => {
    expect(resolveBranchEntryIdForMessage(
      { type: 'text', ts: '2026-03-29T12:00:00.000Z', text: 'Latest reply' },
      5,
      {
        blockOffset: 3,
        blocks: [
          { type: 'thinking', id: 'assistant-123-t3', ts: '2026-03-29T11:59:58.000Z', text: 'Thinking…' },
          { type: 'text', id: 'assistant-999-x4', ts: '2026-03-29T11:59:59.000Z', text: 'Something else' },
          { type: 'text', id: 'assistant-123-x5', ts: '2026-03-29T12:00:01.000Z', text: 'Latest reply' },
        ],
      },
    )).toBe('assistant-123');
  });
});

describe('buildConversationComposerStorageKey', () => {
  it('uses the conversation composer reload-state key', () => {
    expect(buildConversationComposerStorageKey('fork-123')).toBe('pa:reload:conversation:fork-123:composer');
  });
});

describe('clearConversationComposerDraft', () => {
  it('removes the stored composer draft for a conversation', () => {
    const storage = createStorage();
    const key = buildConversationComposerStorageKey('session-123');

    storage.setItem(key, JSON.stringify('Existing draft'));
    clearConversationComposerDraft('session-123', storage);

    expect(storage.getItem(key)).toBeNull();
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
