import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_SESSION_IDS_STORAGE_KEY, PINNED_SESSION_IDS_STORAGE_KEY } from './localSettings';
import {
  closeConversationTab,
  ensureConversationTabOpen,
  moveConversationToSection,
  pinConversationTab,
  readConversationLayout,
  readOpenSessionIds,
  readPinnedSessionIds,
  reorderOpenSessionIds,
  replaceConversationLayout,
  replaceOpenConversationTabs,
  replacePinnedConversationTabs,
  setConversationArchivedState,
  unpinConversationTab,
} from './sessionTabs';

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

describe('sessionTabs', () => {
  const dispatchEvent = vi.fn();
  const fetchMock = vi.fn(() => Promise.resolve({ ok: true }));

  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('window', { dispatchEvent });
    vi.stubGlobal('fetch', fetchMock);

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
    fetchMock.mockReset();
    fetchMock.mockImplementation(() => Promise.resolve({ ok: true }));
    vi.unstubAllGlobals();
  });

  it('sanitizes stored open and pinned session ids', () => {
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify([' session-1 ', '', null, 'session-2', 'session-3']));
    localStorage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify(['session-2', ' session-4 ', 'session-2']));

    expect(readConversationLayout()).toEqual({
      sessionIds: ['session-1', 'session-3'],
      pinnedSessionIds: ['session-2', 'session-4'],
    });
    expect(readOpenSessionIds()).toEqual(['session-1', 'session-3']);
    expect(readPinnedSessionIds()).toEqual(['session-2', 'session-4']);
  });

  it('opens a conversation tab once even when asked repeatedly', () => {
    expect([...ensureConversationTabOpen('session-1')]).toEqual(['session-1']);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    expect([...ensureConversationTabOpen(' session-1 ')]).toEqual(['session-1']);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect([...readOpenSessionIds()]).toEqual(['session-1']);
  });

  it('does not reopen a conversation that is already pinned', () => {
    replaceConversationLayout({ sessionIds: ['session-1'], pinnedSessionIds: ['session-2'] });
    dispatchEvent.mockReset();

    expect(ensureConversationTabOpen('session-2')).toEqual(['session-1']);
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(readConversationLayout()).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: ['session-2'],
    });
  });

  it('replaces the local open tab set from a durable snapshot', () => {
    expect([...replaceOpenConversationTabs([' session-2 ', 'session-1', 'session-2'])]).toEqual(['session-2', 'session-1']);
    expect([...readOpenSessionIds()]).toEqual(['session-2', 'session-1']);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('replaces the local pinned conversation set', () => {
    expect([...replacePinnedConversationTabs([' session-2 ', 'session-1', 'session-2'])]).toEqual(['session-2', 'session-1']);
    expect([...readPinnedSessionIds()]).toEqual(['session-2', 'session-1']);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('treats reordering as a meaningful tab update', () => {
    replaceOpenConversationTabs(['session-1', 'session-2', 'session-3']);
    dispatchEvent.mockReset();

    expect([...replaceOpenConversationTabs(['session-3', 'session-1', 'session-2'])]).toEqual(['session-3', 'session-1', 'session-2']);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect([...readOpenSessionIds()]).toEqual(['session-3', 'session-1', 'session-2']);
  });

  it('reorders session ids around a drop target', () => {
    expect(reorderOpenSessionIds(['session-1', 'session-2', 'session-3'], 'session-3', 'session-1', 'before')).toEqual([
      'session-3',
      'session-1',
      'session-2',
    ]);
    expect(reorderOpenSessionIds(['session-1', 'session-2', 'session-3'], 'session-1', 'session-2', 'after')).toEqual([
      'session-2',
      'session-1',
      'session-3',
    ]);
    expect(reorderOpenSessionIds(['session-1', 'session-2', 'session-3'], 'session-2', 'session-2', 'before')).toEqual([
      'session-1',
      'session-2',
      'session-3',
    ]);
  });

  it('moves conversations between the open and pinned shelves', () => {
    expect(moveConversationToSection({
      sessionIds: ['session-1', 'session-2'],
      pinnedSessionIds: ['session-3'],
    }, 'session-2', 'pinned', 'session-3', 'before')).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: ['session-2', 'session-3'],
    });

    expect(moveConversationToSection({
      sessionIds: ['session-1'],
      pinnedSessionIds: ['session-2', 'session-3'],
    }, 'session-2', 'open', 'session-1', 'after')).toEqual({
      sessionIds: ['session-1', 'session-2'],
      pinnedSessionIds: ['session-3'],
    });
  });

  it('pins a conversation by removing it from open tabs', () => {
    replaceConversationLayout({ sessionIds: ['session-1', 'session-2'], pinnedSessionIds: [] });
    dispatchEvent.mockReset();

    expect(pinConversationTab('session-2')).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: ['session-2'],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('unpins a conversation back into open tabs by default', () => {
    replaceConversationLayout({ sessionIds: ['session-1'], pinnedSessionIds: ['session-2'] });
    dispatchEvent.mockReset();

    expect(unpinConversationTab('session-2')).toEqual({
      sessionIds: ['session-1', 'session-2'],
      pinnedSessionIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('can close a pinned conversation without reopening it in open tabs', () => {
    replaceConversationLayout({ sessionIds: ['session-1'], pinnedSessionIds: ['session-2'] });
    dispatchEvent.mockReset();

    expect(unpinConversationTab('session-2', { open: false })).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('only dispatches changes when a tab actually closes', () => {
    ensureConversationTabOpen('session-1');
    dispatchEvent.mockReset();

    expect([...closeConversationTab('missing')]).toEqual(['session-1']);
    expect(dispatchEvent).not.toHaveBeenCalled();

    expect([...closeConversationTab('session-1')]).toEqual([]);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect([...readOpenSessionIds()]).toEqual([]);
  });

  it('can archive and reopen a conversation regardless of whether it was open or pinned', () => {
    replaceConversationLayout({ sessionIds: ['session-1'], pinnedSessionIds: ['session-2'] });
    dispatchEvent.mockReset();

    expect(setConversationArchivedState('session-2', true)).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    dispatchEvent.mockReset();
    expect(setConversationArchivedState('session-2', false)).toEqual({
      sessionIds: ['session-1', 'session-2'],
      pinnedSessionIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });
});
