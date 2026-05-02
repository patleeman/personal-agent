import { normalizeOpenFileIds } from './knowledgeOpenFiles';

export const KNOWLEDGE_RECENTLY_CLOSED_FILE_IDS_STORAGE_KEY = 'pa:knowledge-recently-closed-file-ids';

const MAX_RECENTLY_CLOSED_FILE_IDS = 20;

type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

function readStorage(storage?: StorageLike): StorageLike | null {
  if (storage) {
    return storage;
  }

  if (typeof localStorage === 'undefined') {
    return null;
  }

  return localStorage;
}

export function readStoredRecentlyClosedFileIds(storage?: StorageLike): string[] {
  const resolvedStorage = readStorage(storage);
  if (!resolvedStorage) {
    return [];
  }

  try {
    const raw = resolvedStorage.getItem(KNOWLEDGE_RECENTLY_CLOSED_FILE_IDS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeOpenFileIds(parsed) : [];
  } catch {
    return [];
  }
}

export function writeStoredRecentlyClosedFileIds(fileIds: readonly string[], storage?: StorageLike): void {
  const resolvedStorage = readStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  try {
    const normalized = normalizeOpenFileIds(fileIds);
    if (normalized.length > 0) {
      resolvedStorage.setItem(KNOWLEDGE_RECENTLY_CLOSED_FILE_IDS_STORAGE_KEY, JSON.stringify(normalized));
      return;
    }

    resolvedStorage.removeItem(KNOWLEDGE_RECENTLY_CLOSED_FILE_IDS_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function recordRecentlyClosedFileId(
  recentlyClosedFileIds: readonly string[],
  fileId: string,
  maxRecentlyClosedFileIds: number = MAX_RECENTLY_CLOSED_FILE_IDS,
): string[] {
  const limit =
    Number.isSafeInteger(maxRecentlyClosedFileIds) && maxRecentlyClosedFileIds > 0
      ? Math.min(MAX_RECENTLY_CLOSED_FILE_IDS, maxRecentlyClosedFileIds)
      : MAX_RECENTLY_CLOSED_FILE_IDS;
  const normalizedId = fileId.trim();
  if (!normalizedId || normalizedId.endsWith('/')) {
    return normalizeOpenFileIds(recentlyClosedFileIds).slice(0, limit);
  }

  return normalizeOpenFileIds([
    normalizedId,
    ...recentlyClosedFileIds.filter((recentlyClosedId) => recentlyClosedId !== normalizedId),
  ]).slice(0, limit);
}
