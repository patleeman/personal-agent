import type { StorageLike } from '../local/reloadState';

const COMPOSER_HISTORY_STORAGE_KEY_PREFIX = 'pa:conversation-composer-history:';
const DRAFT_COMPOSER_HISTORY_SCOPE = 'draft';
const MAX_COMPOSER_HISTORY_ENTRIES = 100;

function getComposerHistoryStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) {
    return storage;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function normalizeComposerHistoryScope(scope?: string | null): string {
  const normalized = typeof scope === 'string' ? scope.trim() : '';
  return normalized || DRAFT_COMPOSER_HISTORY_SCOPE;
}

function normalizeComposerHistoryEntry(value: string): string {
  return value.replace(/\r\n?/g, '\n');
}

function normalizeComposerHistoryEntries(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const entries: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }

    const normalized = normalizeComposerHistoryEntry(value);
    if (normalized.trim().length === 0) {
      continue;
    }

    entries.push(normalized);
  }

  return entries.slice(-MAX_COMPOSER_HISTORY_ENTRIES);
}

function buildComposerHistoryStorageKey(scope?: string | null): string {
  return `${COMPOSER_HISTORY_STORAGE_KEY_PREFIX}${normalizeComposerHistoryScope(scope)}`;
}

export function isComposerHistoryStorageKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith(COMPOSER_HISTORY_STORAGE_KEY_PREFIX);
}

export function readComposerHistory(scope?: string | null, storage?: StorageLike | null): string[] {
  const resolvedStorage = getComposerHistoryStorage(storage);
  if (!resolvedStorage) {
    return [];
  }

  try {
    const raw = resolvedStorage.getItem(buildComposerHistoryStorageKey(scope));
    if (!raw) {
      return [];
    }

    return normalizeComposerHistoryEntries(JSON.parse(raw) as unknown);
  } catch {
    return [];
  }
}

export function appendComposerHistory(scope: string | null | undefined, value: string, storage?: StorageLike | null): string[] {
  const normalized = normalizeComposerHistoryEntry(value);
  if (normalized.trim().length === 0) {
    return readComposerHistory(scope, storage);
  }

  const resolvedStorage = getComposerHistoryStorage(storage);
  const nextEntries = [...readComposerHistory(scope, resolvedStorage), normalized]
    .slice(-MAX_COMPOSER_HISTORY_ENTRIES);

  if (!resolvedStorage) {
    return nextEntries;
  }

  try {
    resolvedStorage.setItem(buildComposerHistoryStorageKey(scope), JSON.stringify(nextEntries));
  } catch {
    // Ignore storage write failures.
  }

  return nextEntries;
}
