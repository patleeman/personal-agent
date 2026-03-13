import { describe, expect, it } from 'vitest';
import type { StorageLike } from './reloadState';
import {
  buildDraftConversationComposerStorageKey,
  buildDraftConversationSessionMeta,
  clearDraftConversationComposer,
  DRAFT_CONVERSATION_ID,
  DRAFT_CONVERSATION_ROUTE,
  persistDraftConversationComposer,
  readDraftConversationComposer,
  shouldShowDraftConversationTab,
} from './draftConversation';

function createStorage(): StorageLike & { getItem(key: string): string | null } {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

describe('draftConversation', () => {
  it('uses a dedicated draft composer storage key', () => {
    expect(buildDraftConversationComposerStorageKey()).toBe('pa:reload:conversation:draft:composer');
  });

  it('persists and reads the draft composer text', () => {
    const storage = createStorage();

    persistDraftConversationComposer('Keep this unsent note', storage);

    expect(readDraftConversationComposer(storage)).toBe('Keep this unsent note');
    expect(storage.getItem(buildDraftConversationComposerStorageKey())).toBe(JSON.stringify('Keep this unsent note'));
  });

  it('clears the stored draft composer text', () => {
    const storage = createStorage();

    persistDraftConversationComposer('Temporary draft', storage);
    clearDraftConversationComposer(storage);

    expect(readDraftConversationComposer(storage)).toBe('');
    expect(storage.getItem(buildDraftConversationComposerStorageKey())).toBeNull();
  });

  it('shows the draft tab while the draft route is active or has saved text', () => {
    expect(shouldShowDraftConversationTab(DRAFT_CONVERSATION_ROUTE, '')).toBe(true);
    expect(shouldShowDraftConversationTab('/inbox', 'Saved draft')).toBe(true);
    expect(shouldShowDraftConversationTab('/inbox', '   ')).toBe(false);
  });

  it('builds a synthetic draft session meta entry', () => {
    expect(buildDraftConversationSessionMeta('2026-03-13T12:00:00.000Z')).toEqual({
      id: DRAFT_CONVERSATION_ID,
      file: '',
      timestamp: '2026-03-13T12:00:00.000Z',
      cwd: 'Draft',
      cwdSlug: 'draft',
      model: '',
      title: 'New Conversation',
      messageCount: 0,
    });
  });
});
