import { isComposerHistoryStorageKey } from '../conversation/composerHistory';
import { isRailWidthStorageKey } from '../ui-state/layoutSizing';

export const THEME_STORAGE_KEY = 'pa-theme';
export const OPEN_SESSION_IDS_STORAGE_KEY = 'pa:open-session-ids';
export const PINNED_SESSION_IDS_STORAGE_KEY = 'pa:pinned-session-ids';
export const ARCHIVED_SESSION_IDS_STORAGE_KEY = 'pa:archived-session-ids';
export const SAVED_WORKSPACE_PATHS_STORAGE_KEY = 'pa:saved-workspace-paths';
const CONVERSATION_SEEN_MESSAGE_COUNT_STORAGE_KEY = 'pa:conversation-seen-message-counts';
export const SIDEBAR_WIDTH_STORAGE_KEY = 'pa:sidebar-width';
const OPEN_NOTE_IDS_STORAGE_KEY = 'pa:open-note-ids';
const PINNED_NOTE_IDS_STORAGE_KEY = 'pa:pinned-note-ids';
const OPEN_SKILL_IDS_STORAGE_KEY = 'pa:open-skill-ids';
const PINNED_SKILL_IDS_STORAGE_KEY = 'pa:pinned-skill-ids';
const OPEN_WORKSPACE_IDS_STORAGE_KEY = 'pa:open-workspace-ids';
const PINNED_WORKSPACE_IDS_STORAGE_KEY = 'pa:pinned-workspace-ids';
const OPEN_NODE_IDS_STORAGE_KEY = 'pa:open-node-ids';
const PINNED_NODE_IDS_STORAGE_KEY = 'pa:pinned-node-ids';
const SIDEBAR_NAV_SECTION_STORAGE_KEY_PREFIX = 'pa:sidebar-nav-section:';

export function buildSidebarNavSectionStorageKey(sectionId: string): string {
  return `${SIDEBAR_NAV_SECTION_STORAGE_KEY_PREFIX}${sectionId}`;
}

function isSidebarNavSectionStorageKey(key: string): boolean {
  return key.startsWith(SIDEBAR_NAV_SECTION_STORAGE_KEY_PREFIX);
}

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
  removeStoredItemsMatching((key) => isRailWidthStorageKey(key) || isSidebarNavSectionStorageKey(key));
}

export function resetStoredConversationUiState(): void {
  removeStoredItem(OPEN_SESSION_IDS_STORAGE_KEY);
  removeStoredItem(PINNED_SESSION_IDS_STORAGE_KEY);
  removeStoredItem(ARCHIVED_SESSION_IDS_STORAGE_KEY);
  removeStoredItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY);
  removeStoredItem(CONVERSATION_SEEN_MESSAGE_COUNT_STORAGE_KEY);
  removeStoredItem(OPEN_NOTE_IDS_STORAGE_KEY);
  removeStoredItem(PINNED_NOTE_IDS_STORAGE_KEY);
  removeStoredItem(OPEN_SKILL_IDS_STORAGE_KEY);
  removeStoredItem(PINNED_SKILL_IDS_STORAGE_KEY);
  removeStoredItem(OPEN_WORKSPACE_IDS_STORAGE_KEY);
  removeStoredItem(PINNED_WORKSPACE_IDS_STORAGE_KEY);
  removeStoredItem(OPEN_NODE_IDS_STORAGE_KEY);
  removeStoredItem(PINNED_NODE_IDS_STORAGE_KEY);
  removeStoredItemsMatching(isComposerHistoryStorageKey);
}
