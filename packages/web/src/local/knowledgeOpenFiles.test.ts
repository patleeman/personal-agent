import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addOpenFileId,
  KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY,
  normalizeOpenFileIds,
  readStoredOpenFileIds,
  removeOpenFileId,
  renameOpenFileIds,
  writeStoredOpenFileIds,
} from './knowledgeOpenFiles';

function createStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key) {
      return map.has(key) ? map.get(key) ?? null : null;
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, value);
    },
  } as Storage;
}

describe('knowledgeOpenFiles', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  it('normalizes stored file ids without folders or duplicates', () => {
    expect(normalizeOpenFileIds(['README.md', ' README.md ', 'notes/', 'notes/today.md', '', null])).toEqual(['README.md', 'notes/today.md']);
  });

  it('persists and restores open file ids', () => {
    writeStoredOpenFileIds(['README.md', 'notes/today.md']);

    expect(localStorage.getItem(KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY)).toBe(JSON.stringify(['README.md', 'notes/today.md']));
    expect(readStoredOpenFileIds()).toEqual(['README.md', 'notes/today.md']);
  });

  it('moves the latest open file to the front', () => {
    expect(addOpenFileId(['README.md', 'notes/today.md'], 'notes/today.md')).toEqual(['notes/today.md', 'README.md']);
  });

  it('removes renamed or deleted file ids', () => {
    expect(removeOpenFileId(['README.md', 'notes/today.md'], 'README.md')).toEqual(['notes/today.md']);
    expect(removeOpenFileId(['notes/today.md', 'notes/work/todo.md'], 'notes/')).toEqual([]);
  });

  it('updates descendant file ids when a folder moves', () => {
    expect(renameOpenFileIds(['README.md', 'notes/today.md', 'notes/work/todo.md'], 'notes/', 'wiki/')).toEqual([
      'README.md',
      'wiki/today.md',
      'wiki/work/todo.md',
    ]);
  });
});
