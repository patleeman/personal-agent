import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addExpandedFolderId,
  collapseExpandedFolderIds,
  KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY,
  readStoredExpandedFolderIds,
  renameExpandedFolderIds,
  writeStoredExpandedFolderIds,
} from './knowledgeTreeState';

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
      return map.has(key) ? (map.get(key) ?? null) : null;
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

describe('knowledgeTreeState', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  it('persists normalized expanded folder ids', () => {
    writeStoredExpandedFolderIds(new Set(['notes/work/', 'notes/', 'notes/', 'README.md']));

    expect(localStorage.getItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY)).toBe(JSON.stringify(['notes/', 'notes/work/']));
    expect([...readStoredExpandedFolderIds()]).toEqual(['notes/', 'notes/work/']);
  });

  it('drops invalid stored payloads without throwing', () => {
    localStorage.setItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY, '{not json');
    expect([...readStoredExpandedFolderIds()]).toEqual([]);

    localStorage.setItem(KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY, JSON.stringify(['notes/', '', 'README.md', 'projects/']));
    expect([...readStoredExpandedFolderIds()]).toEqual(['notes/', 'projects/']);
  });

  it('removes collapsed folders and their descendants', () => {
    const next = collapseExpandedFolderIds(new Set(['notes/', 'notes/work/', 'projects/']), 'notes/');
    expect([...next]).toEqual(['projects/']);
  });

  it('updates descendant ids when an expanded folder is renamed', () => {
    const next = renameExpandedFolderIds(new Set(['notes/', 'notes/work/', 'projects/']), 'notes/', 'wiki/');
    expect([...next]).toEqual(['projects/', 'wiki/', 'wiki/work/']);
  });

  it('adds expanded folders without duplicating entries', () => {
    const next = addExpandedFolderId(new Set(['notes/']), 'notes/work/');
    expect([...next]).toEqual(['notes/', 'notes/work/']);
  });
});
