export const KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY = 'pa:knowledge-open-file-ids';

const MAX_OPEN_FILE_IDS = 20;

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

export function normalizeOpenFileIds(values: Iterable<unknown>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.endsWith('/') || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ids.push(normalized);
  }

  return ids;
}

export function readStoredOpenFileIds(storage?: StorageLike): string[] {
  const resolvedStorage = readStorage(storage);
  if (!resolvedStorage) {
    return [];
  }

  try {
    const raw = resolvedStorage.getItem(KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeOpenFileIds(parsed) : [];
  } catch {
    return [];
  }
}

export function writeStoredOpenFileIds(openFileIds: readonly string[], storage?: StorageLike): void {
  const resolvedStorage = readStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  try {
    const normalized = normalizeOpenFileIds(openFileIds);
    if (normalized.length > 0) {
      resolvedStorage.setItem(KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY, JSON.stringify(normalized));
      return;
    }

    resolvedStorage.removeItem(KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

export function addOpenFileId(openFileIds: readonly string[], fileId: string, maxOpenFileIds: number = MAX_OPEN_FILE_IDS): string[] {
  const normalizedId = fileId.trim();
  if (!normalizedId || normalizedId.endsWith('/')) {
    return normalizeOpenFileIds(openFileIds);
  }

  return normalizeOpenFileIds([normalizedId, ...openFileIds.filter((openFileId) => openFileId !== normalizedId)]).slice(0, maxOpenFileIds);
}

export function removeOpenFileId(openFileIds: readonly string[], id: string): string[] {
  if (!id.trim()) {
    return normalizeOpenFileIds(openFileIds);
  }

  if (id.endsWith('/')) {
    return normalizeOpenFileIds(openFileIds).filter((openFileId) => !openFileId.startsWith(id));
  }

  return normalizeOpenFileIds(openFileIds).filter((openFileId) => openFileId !== id);
}

export function renameOpenFileIds(openFileIds: readonly string[], oldId: string, newId: string): string[] {
  const normalized = normalizeOpenFileIds(openFileIds);
  if (!oldId.trim() || !newId.trim()) {
    return normalized;
  }

  if (oldId.endsWith('/') && newId.endsWith('/')) {
    return normalizeOpenFileIds(normalized.map((openFileId) => (
      openFileId.startsWith(oldId)
        ? `${newId}${openFileId.slice(oldId.length)}`
        : openFileId
    )));
  }

  return normalizeOpenFileIds(normalized.map((openFileId) => (openFileId === oldId ? newId : openFileId)));
}
