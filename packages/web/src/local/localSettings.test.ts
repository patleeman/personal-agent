import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ARCHIVED_SESSION_IDS_STORAGE_KEY,
  buildSidebarNavSectionStorageKey,
  OPEN_SESSION_IDS_STORAGE_KEY,
  resetStoredConversationUiState,
  resetStoredLayoutPreferences,
  SIDEBAR_WIDTH_STORAGE_KEY,
} from './localSettings';
import { KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY } from './knowledgeOpenFiles';
import { KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY } from './knowledgeTreeState';

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key) ?? null : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, value);
    },
  } as Storage;
}

const CONVERSATION_SEEN_MESSAGE_COUNT_STORAGE_KEY = 'pa:conversation-seen-message-counts';
const SESSION_COMPOSER_HISTORY_STORAGE_KEY = 'pa:conversation-composer-history:session-1';
const DRAFT_COMPOSER_HISTORY_STORAGE_KEY = 'pa:conversation-composer-history:draft';

describe('localSettings', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  it('clears conversation ui state including composer history', () => {
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['session-1']));
    localStorage.setItem(ARCHIVED_SESSION_IDS_STORAGE_KEY, JSON.stringify(['session-1']));
    localStorage.setItem(CONVERSATION_SEEN_MESSAGE_COUNT_STORAGE_KEY, JSON.stringify({ 'session-1': 3 }));
    localStorage.setItem(SESSION_COMPOSER_HISTORY_STORAGE_KEY, JSON.stringify(['draft 1']));
    localStorage.setItem(DRAFT_COMPOSER_HISTORY_STORAGE_KEY, JSON.stringify(['draft 2']));
    localStorage.setItem('pa:keep-me', 'yes');

    resetStoredConversationUiState();

    expect(localStorage.getItem(OPEN_SESSION_IDS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(ARCHIVED_SESSION_IDS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(CONVERSATION_SEEN_MESSAGE_COUNT_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(SESSION_COMPOSER_HISTORY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(DRAFT_COMPOSER_HISTORY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem('pa:keep-me')).toBe('yes');
  });

  it('clears the saved sidebar width, nav sections, and all per-page rail widths', () => {
    const conversationsSectionKey = buildSidebarNavSectionStorageKey('conversations');
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, '224');
    localStorage.setItem(KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY, JSON.stringify(['README.md']));
    localStorage.setItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY, JSON.stringify(['notes/']));
    localStorage.setItem(conversationsSectionKey, JSON.stringify(false));
    localStorage.setItem('pa:rail-width:skills', '460');
    localStorage.setItem('pa:rail-width:instructions', '520');
    localStorage.setItem('pa:rail-width:knowledge', '480');
    localStorage.setItem('pa:keep-me', 'yes');

    resetStoredLayoutPreferences();

    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(conversationsSectionKey)).toBeNull();
    expect(localStorage.getItem('pa:rail-width:skills')).toBeNull();
    expect(localStorage.getItem('pa:rail-width:instructions')).toBeNull();
    expect(localStorage.getItem('pa:rail-width:knowledge')).toBeNull();
    expect(localStorage.getItem('pa:keep-me')).toBe('yes');
  });
});
