import { RAIL_WIDTH_STORAGE_KEYS } from './layoutSizing';

export const THEME_STORAGE_KEY = 'pa-theme';
export const OPEN_SESSION_IDS_STORAGE_KEY = 'pa:open-session-ids';
export const CONVERSATION_SEEN_MESSAGE_COUNT_STORAGE_KEY = 'pa:conversation-seen-message-counts';
export const SIDEBAR_WIDTH_STORAGE_KEY = 'pa:sidebar-width';

function removeStoredItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

export function resetStoredLayoutPreferences(): void {
  removeStoredItem(SIDEBAR_WIDTH_STORAGE_KEY);
  for (const key of Object.values(RAIL_WIDTH_STORAGE_KEYS)) {
    removeStoredItem(key);
  }
}

export function resetStoredConversationUiState(): void {
  removeStoredItem(OPEN_SESSION_IDS_STORAGE_KEY);
  removeStoredItem(CONVERSATION_SEEN_MESSAGE_COUNT_STORAGE_KEY);
}
