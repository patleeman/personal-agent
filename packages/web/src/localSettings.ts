import { isComposerHistoryStorageKey } from './composerHistory';
import { isRailWidthStorageKey } from './layoutSizing';

export const THEME_STORAGE_KEY = 'pa-theme';
export const OPEN_SESSION_IDS_STORAGE_KEY = 'pa:open-session-ids';
export const PINNED_SESSION_IDS_STORAGE_KEY = 'pa:pinned-session-ids';
export const ARCHIVED_SESSION_IDS_STORAGE_KEY = 'pa:archived-session-ids';
export const CONVERSATION_SEEN_MESSAGE_COUNT_STORAGE_KEY = 'pa:conversation-seen-message-counts';
export const SIDEBAR_WIDTH_STORAGE_KEY = 'pa:sidebar-width';

function removeStoredItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function removeStoredItemsMatching(predicate: (key: string) => boolean): void {
  try {
    const keysToRemove: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key && predicate(key)) {
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures.
  }
}

export function resetStoredLayoutPreferences(): void {
  removeStoredItem(SIDEBAR_WIDTH_STORAGE_KEY);
  removeStoredItemsMatching(isRailWidthStorageKey);
}

export function resetStoredConversationUiState(): void {
  removeStoredItem(OPEN_SESSION_IDS_STORAGE_KEY);
  removeStoredItem(PINNED_SESSION_IDS_STORAGE_KEY);
  removeStoredItem(ARCHIVED_SESSION_IDS_STORAGE_KEY);
  removeStoredItem(CONVERSATION_SEEN_MESSAGE_COUNT_STORAGE_KEY);
  removeStoredItemsMatching(isComposerHistoryStorageKey);
}
