import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampOpenFilesSectionHeight,
  DEFAULT_OPEN_FILES_SECTION_HEIGHT,
  KNOWLEDGE_OPEN_FILES_SECTION_HEIGHT_STORAGE_KEY,
  readStoredOpenFilesSectionHeight,
  writeStoredOpenFilesSectionHeight,
} from './knowledgeOpenFilesSectionHeight';

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

describe('knowledgeOpenFilesSectionHeight', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  it('clamps stored heights to the minimum without a fixed maximum', () => {
    expect(clampOpenFilesSectionHeight(24)).toBe(88);
    expect(clampOpenFilesSectionHeight(512)).toBe(512);
  });

  it('persists non-default heights and restores them', () => {
    writeStoredOpenFilesSectionHeight(224);

    expect(localStorage.getItem(KNOWLEDGE_OPEN_FILES_SECTION_HEIGHT_STORAGE_KEY)).toBe('224');
    expect(readStoredOpenFilesSectionHeight()).toBe(224);
  });

  it('falls back to the default height when storage is missing or invalid', () => {
    expect(readStoredOpenFilesSectionHeight()).toBe(DEFAULT_OPEN_FILES_SECTION_HEIGHT);

    localStorage.setItem(KNOWLEDGE_OPEN_FILES_SECTION_HEIGHT_STORAGE_KEY, 'not-a-number');
    expect(readStoredOpenFilesSectionHeight()).toBe(DEFAULT_OPEN_FILES_SECTION_HEIGHT);

    writeStoredOpenFilesSectionHeight(DEFAULT_OPEN_FILES_SECTION_HEIGHT);
    expect(localStorage.getItem(KNOWLEDGE_OPEN_FILES_SECTION_HEIGHT_STORAGE_KEY)).toBeNull();
  });
});
