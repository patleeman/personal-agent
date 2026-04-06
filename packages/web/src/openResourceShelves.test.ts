import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OPEN_NODE_IDS_STORAGE_KEY,
  OPEN_NOTE_IDS_STORAGE_KEY,
  OPEN_SKILL_IDS_STORAGE_KEY,
  OPEN_WORKSPACE_IDS_STORAGE_KEY,
  PINNED_NODE_IDS_STORAGE_KEY,
  PINNED_NOTE_IDS_STORAGE_KEY,
  PINNED_SKILL_IDS_STORAGE_KEY,
  PINNED_WORKSPACE_IDS_STORAGE_KEY,
} from './localSettings';
import {
  buildOpenNodeShelfId,
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
    case 'node':
      return { open: OPEN_NODE_IDS_STORAGE_KEY, pinned: PINNED_NODE_IDS_STORAGE_KEY };
    case 'note':
      return { open: OPEN_NOTE_IDS_STORAGE_KEY, pinned: PINNED_NOTE_IDS_STORAGE_KEY };
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
    expect(ensureOpenResourceShelfItem('note', ' note-1 ')).toEqual({
      openIds: ['note-1'],
      pinnedIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    expect(ensureOpenResourceShelfItem('note', 'note-1')).toEqual({
      openIds: ['note-1'],
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
    replaceOpenResourceShelf('note', { openIds: ['note-a'], pinnedIds: ['note-b'] });
    dispatchEvent.mockReset();

    expect(closeOpenResourceShelfItem('note', 'note-b')).toEqual({
      openIds: ['note-a'],
      pinnedIds: ['note-b'],
    });
    expect(dispatchEvent).not.toHaveBeenCalled();

    expect(closeOpenResourceShelfItem('note', 'note-a')).toEqual({
      openIds: [],
      pinnedIds: ['note-b'],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('merges legacy note and skill shelves into the consolidated node shelf', () => {
    localStorage.setItem(OPEN_NOTE_IDS_STORAGE_KEY, JSON.stringify(['note-a']));
    localStorage.setItem(PINNED_SKILL_IDS_STORAGE_KEY, JSON.stringify(['skill-a']));
    localStorage.setItem(OPEN_NODE_IDS_STORAGE_KEY, JSON.stringify([buildOpenNodeShelfId('skill', 'skill-b')]));

    expect(readOpenResourceShelf('node')).toEqual({
      openIds: [buildOpenNodeShelfId('note', 'note-a'), buildOpenNodeShelfId('skill', 'skill-b')],
      pinnedIds: [buildOpenNodeShelfId('skill', 'skill-a')],
    });
  });
});
