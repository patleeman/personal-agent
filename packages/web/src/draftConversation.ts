import { NEW_CONVERSATION_TITLE } from './conversationTitle';
import { clearStoredState, getSessionStorage, persistStoredState, readStoredState, type StorageLike } from './reloadState';
import type { SessionMeta } from './types';

export const DRAFT_CONVERSATION_ID = 'new';
export const DRAFT_CONVERSATION_ROUTE = '/conversations/new';

const DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY = 'pa:reload:conversation:draft:composer';
const DRAFT_CONVERSATION_CWD_STORAGE_KEY = 'pa:reload:conversation:draft:cwd';

export function buildDraftConversationComposerStorageKey(): string {
  return DRAFT_CONVERSATION_COMPOSER_STORAGE_KEY;
}

export function buildDraftConversationCwdStorageKey(): string {
  return DRAFT_CONVERSATION_CWD_STORAGE_KEY;
}

function normalizeDraftConversationComposer(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeDraftConversationCwd(value: unknown): string {
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

export function readDraftConversationCwd(
  storage: StorageLike | null = getSessionStorage(),
): string {
  return readStoredState<string>({
    key: buildDraftConversationCwdStorageKey(),
    fallback: '',
    storage,
    deserialize: (raw) => normalizeDraftConversationCwd(JSON.parse(raw) as unknown),
  });
}

export function persistDraftConversationCwd(
  cwd: string,
  storage: StorageLike | null = getSessionStorage(),
): void {
  persistStoredState({
    key: buildDraftConversationCwdStorageKey(),
    value: cwd,
    storage,
    shouldPersist: (value) => value.trim().length > 0,
  });
}

export function clearDraftConversationCwd(
  storage: StorageLike | null = getSessionStorage(),
): void {
  clearStoredState(storage, buildDraftConversationCwdStorageKey());
}

export function isDraftConversationPath(pathname: string): boolean {
  return pathname === DRAFT_CONVERSATION_ROUTE;
}

export function shouldShowDraftConversationTab(pathname: string, composerText: string, cwd: string = ''): boolean {
  return isDraftConversationPath(pathname) || composerText.trim().length > 0 || cwd.trim().length > 0;
}

export function buildDraftConversationSessionMeta(timestamp = new Date().toISOString(), cwd = ''): SessionMeta {
  return {
    id: DRAFT_CONVERSATION_ID,
    file: '',
    timestamp,
    cwd: cwd.trim() || 'Draft',
    cwdSlug: 'draft',
    model: '',
    title: NEW_CONVERSATION_TITLE,
    messageCount: 0,
  };
}
