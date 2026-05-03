import { afterEach, describe, expect, it, vi } from 'vitest';

// Provide localStorage before module-level code runs
vi.hoisted(() => {
  let store: Record<string, string> = {};
  (globalThis as any).localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
});

import { SAVED_WORKSPACE_PATHS_STORAGE_KEY } from './localSettings.js';
import { normalizeWorkspacePaths, readStoredWorkspacePaths, writeStoredWorkspacePaths } from './savedWorkspacePaths.js';

afterEach(() => {
  localStorage.clear();
});

describe('normalizeWorkspacePaths', () => {
  it('deduplicates and normalizes', () => {
    const result = normalizeWorkspacePaths(['/repo/a', '/repo/a', '/repo/b']);
    expect(result).toEqual(['/repo/a', '/repo/b']);
  });

  it('skips nullish values', () => {
    const result = normalizeWorkspacePaths(['/repo/a', null, undefined, '/repo/b']);
    expect(result).toEqual(['/repo/a', '/repo/b']);
  });
});

describe('readStoredWorkspacePaths', () => {
  it('returns empty array when no stored paths', () => {
    expect(readStoredWorkspacePaths()).toEqual([]);
  });

  it('returns parsed and normalized paths', () => {
    localStorage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify(['/repo/a', '/repo/b']));
    expect(readStoredWorkspacePaths()).toEqual(['/repo/a', '/repo/b']);
  });

  it('returns empty for invalid JSON', () => {
    localStorage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, 'not-json');
    expect(readStoredWorkspacePaths()).toEqual([]);
  });
});

describe('writeStoredWorkspacePaths', () => {
  it('stores non-empty paths', () => {
    writeStoredWorkspacePaths(['/repo/a']);
    expect(localStorage.getItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY)).toContain('/repo/a');
  });

  it('removes key when empty', () => {
    localStorage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify(['/repo/a']));
    writeStoredWorkspacePaths([]);
    expect(localStorage.getItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY)).toBeNull();
  });
});
