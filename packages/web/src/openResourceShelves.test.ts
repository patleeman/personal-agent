import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OPEN_NOTE_IDS_STORAGE_KEY,
  OPEN_PROJECT_IDS_STORAGE_KEY,
  OPEN_SKILL_IDS_STORAGE_KEY,
  OPEN_WORKSPACE_IDS_STORAGE_KEY,
  PINNED_NOTE_IDS_STORAGE_KEY,
  PINNED_PROJECT_IDS_STORAGE_KEY,
  PINNED_SKILL_IDS_STORAGE_KEY,
  PINNED_WORKSPACE_IDS_STORAGE_KEY,
} from './localSettings';
import {
  closeOpenResourceShelfItem,
  ensureOpenResourceShelfItem,
  pinOpenResourceShelfItem,
  readOpenResourceShelf,
  replaceOpenResourceShelf,
  unpinOpenResourceShelfItem,
  type OpenResourceKind,
} from './openResourceShelves';

interface MockStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

function createStorage(): MockStorage {
  const map = new Map<string, string>();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) ?? null : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

function keysFor(kind: OpenResourceKind): { open: string; pinned: string } {
  switch (kind) {
    case 'note':
      return { open: OPEN_NOTE_IDS_STORAGE_KEY, pinned: PINNED_NOTE_IDS_STORAGE_KEY };
    case 'project':
      return { open: OPEN_PROJECT_IDS_STORAGE_KEY, pinned: PINNED_PROJECT_IDS_STORAGE_KEY };
    case 'skill':
      return { open: OPEN_SKILL_IDS_STORAGE_KEY, pinned: PINNED_SKILL_IDS_STORAGE_KEY };
    case 'workspace':
      return { open: OPEN_WORKSPACE_IDS_STORAGE_KEY, pinned: PINNED_WORKSPACE_IDS_STORAGE_KEY };
  }
}

describe('openResourceShelves', () => {
  const dispatchEvent = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('window', { dispatchEvent });

    if (typeof CustomEvent === 'undefined') {
      vi.stubGlobal('CustomEvent', class CustomEvent<T = unknown> {
        type: string;
        detail: T | null;

        constructor(type: string, init?: CustomEventInit<T>) {
          this.type = type;
          this.detail = init?.detail ?? null;
        }
      });
    }
  });

  afterEach(() => {
    dispatchEvent.mockReset();
    vi.unstubAllGlobals();
  });

  it('sanitizes stored shelf ids', () => {
    const keys = keysFor('note');
    localStorage.setItem(keys.open, JSON.stringify([' note-1 ', '', null, 'note-2', 'note-3']));
    localStorage.setItem(keys.pinned, JSON.stringify(['note-2', ' note-4 ', 'note-2']));

    expect(readOpenResourceShelf('note')).toEqual({
      openIds: ['note-1', 'note-3'],
      pinnedIds: ['note-2', 'note-4'],
    });
  });

  it('opens an item once per shelf', () => {
    expect(ensureOpenResourceShelfItem('project', ' project-1 ')).toEqual({
      openIds: ['project-1'],
      pinnedIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    expect(ensureOpenResourceShelfItem('project', 'project-1')).toEqual({
      openIds: ['project-1'],
      pinnedIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('pins an item by removing it from open ids', () => {
    replaceOpenResourceShelf('skill', { openIds: ['skill-a', 'skill-b'] });
    dispatchEvent.mockReset();

    expect(pinOpenResourceShelfItem('skill', 'skill-b')).toEqual({
      openIds: ['skill-a'],
      pinnedIds: ['skill-b'],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('unpins an item back into open ids by default', () => {
    replaceOpenResourceShelf('workspace', { pinnedIds: ['/tmp/project'] });
    dispatchEvent.mockReset();

    expect(unpinOpenResourceShelfItem('workspace', '/tmp/project')).toEqual({
      openIds: ['/tmp/project'],
      pinnedIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('can close a pinned item without reopening it', () => {
    replaceOpenResourceShelf('note', { pinnedIds: ['note-a'] });
    dispatchEvent.mockReset();

    expect(unpinOpenResourceShelfItem('note', 'note-a', { open: false })).toEqual({
      openIds: [],
      pinnedIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('closes only open items', () => {
    replaceOpenResourceShelf('project', { openIds: ['project-a'], pinnedIds: ['project-b'] });
    dispatchEvent.mockReset();

    expect(closeOpenResourceShelfItem('project', 'project-b')).toEqual({
      openIds: ['project-a'],
      pinnedIds: ['project-b'],
    });
    expect(dispatchEvent).not.toHaveBeenCalled();

    expect(closeOpenResourceShelfItem('project', 'project-a')).toEqual({
      openIds: [],
      pinnedIds: ['project-b'],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });
});
