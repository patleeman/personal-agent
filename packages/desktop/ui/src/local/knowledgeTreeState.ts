export const KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY = 'pa:knowledge-tree-expanded-folders';

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

function normalizeFolderIds(folderIds: Iterable<string>): string[] {
  return Array.from(new Set(
    Array.from(folderIds)
      .map((folderId) => folderId.trim())
      .filter((folderId) => folderId.length > 0 && folderId.endsWith('/')),
  )).sort((a, b) => a.localeCompare(b));
}

export function readStoredExpandedFolderIds(storage?: StorageLike): Set<string> {
  const resolvedStorage = readStorage(storage);
  if (!resolvedStorage) {
    return new Set<string>();
  }

  try {
    const raw = resolvedStorage.getItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY);
    if (!raw) {
      return new Set<string>();
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return new Set<string>();
    }

    return new Set(normalizeFolderIds(parsed.filter((value): value is string => typeof value === 'string')));
  } catch {
    return new Set<string>();
  }
}

export function writeStoredExpandedFolderIds(folderIds: ReadonlySet<string>, storage?: StorageLike): void {
  const resolvedStorage = readStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  try {
    const normalized = normalizeFolderIds(folderIds);
    if (normalized.length === 0) {
      resolvedStorage.removeItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY);
      return;
    }

    resolvedStorage.setItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Ignore storage failures.
  }
}

export function addExpandedFolderId(folderIds: ReadonlySet<string>, folderId: string): Set<string> {
  return new Set(normalizeFolderIds([...folderIds, folderId]));
}

export function collapseExpandedFolderIds(folderIds: ReadonlySet<string>, folderId: string): Set<string> {
  if (!folderId.endsWith('/')) {
    return new Set(folderIds);
  }

  return new Set(
    normalizeFolderIds(folderIds).filter((storedFolderId) => storedFolderId !== folderId && !storedFolderId.startsWith(folderId)),
  );
}

export function renameExpandedFolderIds(folderIds: ReadonlySet<string>, oldFolderId: string, newFolderId: string): Set<string> {
  if (!oldFolderId.endsWith('/') || !newFolderId.endsWith('/')) {
    return new Set(folderIds);
  }

  return new Set(normalizeFolderIds(
    Array.from(folderIds, (folderId) => (
      folderId === oldFolderId || folderId.startsWith(oldFolderId)
        ? `${newFolderId}${folderId.slice(oldFolderId.length)}`
        : folderId
    )),
  ));
}
