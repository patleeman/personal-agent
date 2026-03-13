import { NEW_CONVERSATION_TITLE } from './conversationTitle';
import { clearStoredState, getSessionStorage, persistStoredState, readStoredState, type StorageLike } from './reloadState';
import type { SessionMeta } from './types';

export const DRAFT_CONVERSATION_ID = 'new';
export const DRAFT_CONVERSATION_ROUTE = '/conversations/new';

const DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY = 'pa:reload:conversation:draft:composer';

export function buildDraftConversationComposerStorageKey(): string {
  return DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY;
}

function normalizeDraftConversationComposer(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function readDraftConversationComposer(
  storage: StorageLike | null = getSessionStorage(),
): string {
  return readStoredState<string>({
    key: buildDraftConversationComposerStorageKey(),
    fallback: '',
    storage,
    deserialize: (raw) => normalizeDraftConversationComposer(JSON.parse(raw) as unknown),
  });
}

export function persistDraftConversationComposer(
  text: string,
  storage: StorageLike | null = getSessionStorage(),
): void {
  persistStoredState({
    key: buildDraftConversationComposerStorageKey(),
    value: text,
    storage,
    shouldPersist: (value) => value.length > 0,
  });
}

export function clearDraftConversationComposer(
  storage: StorageLike | null = getSessionStorage(),
): void {
  clearStoredState(storage, buildDraftConversationComposerStorageKey());
}

export function isDraftConversationPath(pathname: string): boolean {
  return pathname === DRAFT_CONVERSATION_ROUTE;
}

export function shouldShowDraftConversationTab(pathname: string, composerText: string): boolean {
  return isDraftConversationPath(pathname) || composerText.trim().length > 0;
}

export function buildDraftConversationSessionMeta(timestamp = new Date().toISOString()): SessionMeta {
  return {
    id: DRAFT_CONVERSATION_ID,
    file: '',
    timestamp,
    cwd: 'Draft',
    cwdSlug: 'draft',
    model: '',
    title: NEW_CONVERSATION_TITLE,
    messageCount: 0,
  };
}
