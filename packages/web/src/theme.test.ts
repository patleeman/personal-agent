import { beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from './localSettings';
import { readStoredThemePreference, resolveThemePreference } from './theme';

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

describe('theme preferences', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
  });

  it('defaults to system when no browser preference is stored', () => {
    expect(readStoredThemePreference()).toBe('system');
  });

  it('reads an explicit stored theme preference', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');

    expect(readStoredThemePreference()).toBe('dark');
  });

  it('falls back to system for invalid stored values', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'sepia');

    expect(readStoredThemePreference()).toBe('system');
  });

  it('resolves system preference from the current system theme', () => {
    expect(resolveThemePreference('system', 'dark')).toBe('dark');
    expect(resolveThemePreference('system', 'light')).toBe('light');
  });
});
