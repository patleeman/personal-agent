export const KNOWLEDGE_OPEN_FILES_SECTION_HEIGHT_STORAGE_KEY = 'pa:knowledge-open-files-section-height';
export const DEFAULT_OPEN_FILES_SECTION_HEIGHT = 260;
export const MIN_OPEN_FILES_SECTION_HEIGHT = 88;

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

export function clampOpenFilesSectionHeight(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_OPEN_FILES_SECTION_HEIGHT;
  }

  return Math.max(MIN_OPEN_FILES_SECTION_HEIGHT, Math.round(value));
}

export function readStoredOpenFilesSectionHeight(storage?: StorageLike): number {
  const resolvedStorage = readStorage(storage);
  if (!resolvedStorage) {
    return DEFAULT_OPEN_FILES_SECTION_HEIGHT;
  }

  try {
    const raw = resolvedStorage.getItem(KNOWLEDGE_OPEN_FILES_SECTION_HEIGHT_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_OPEN_FILES_SECTION_HEIGHT;
    }

    return clampOpenFilesSectionHeight(Number.parseInt(raw, 10));
  } catch {
    return DEFAULT_OPEN_FILES_SECTION_HEIGHT;
  }
}

export function writeStoredOpenFilesSectionHeight(height: number, storage?: StorageLike): void {
  const resolvedStorage = readStorage(storage);
  if (!resolvedStorage) {
    return;
  }

  try {
    const normalized = clampOpenFilesSectionHeight(height);
    if (normalized === DEFAULT_OPEN_FILES_SECTION_HEIGHT) {
      resolvedStorage.removeItem(KNOWLEDGE_OPEN_FILES_SECTION_HEIGHT_STORAGE_KEY);
      return;
    }

    resolvedStorage.setItem(KNOWLEDGE_OPEN_FILES_SECTION_HEIGHT_STORAGE_KEY, String(normalized));
  } catch {
    // Ignore storage failures.
  }
}
