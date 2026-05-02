import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMocks = vi.hoisted(() => ({
  openConversationTabs: vi.fn(),
  setOpenConversationTabs: vi.fn(),
}));

vi.mock('../client/api', () => ({
  api: apiMocks,
}));

import {
  ARCHIVED_SESSION_IDS_STORAGE_KEY,
  OPEN_SESSION_IDS_STORAGE_KEY,
  PINNED_SESSION_IDS_STORAGE_KEY,
} from '../local/localSettings';
import {
  closeConversationTab,
  ensureConversationTabOpen,
  moveConversationTab,
  pinConversationTab,
  readArchivedSessionIds,
  readConversationLayout,
  readOpenSessionIds,
  readPinnedSessionIds,
  reopenMostRecentlyArchivedConversation,
  replaceConversationLayout,
  setConversationArchivedState,
  shiftConversationTab,
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

  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    vi.stubGlobal('window', { dispatchEvent });
    apiMocks.openConversationTabs.mockReset();
    apiMocks.setOpenConversationTabs.mockReset();
    apiMocks.setOpenConversationTabs.mockResolvedValue({ ok: true });

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

  it('sanitizes stored open, pinned, and archived session ids', () => {
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify([' session-1 ', '', null, 'session-2', 'session-3']));
    localStorage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify(['session-2', ' session-4 ', 'session-2']));
    localStorage.setItem(ARCHIVED_SESSION_IDS_STORAGE_KEY, JSON.stringify(['session-3', 'session-4', ' session-5 ', 'session-5']));

    expect(readConversationLayout()).toEqual({
      sessionIds: ['session-1', 'session-3'],
      pinnedSessionIds: ['session-2', 'session-4'],
      archivedSessionIds: ['session-5'],
    });
    expect(readOpenSessionIds()).toEqual(['session-1', 'session-3']);
    expect(readPinnedSessionIds()).toEqual(['session-2', 'session-4']);
    expect(readArchivedSessionIds()).toEqual(['session-5']);
  });

  it('opens a conversation tab once even when asked repeatedly', () => {
    expect([...ensureConversationTabOpen('session-1')]).toEqual(['session-1']);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    expect([...ensureConversationTabOpen(' session-1 ')]).toEqual(['session-1']);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect([...readOpenSessionIds()]).toEqual(['session-1']);
    expect([...readArchivedSessionIds()]).toEqual([]);
  });

  it('does not reopen a conversation that is already pinned', () => {
    replaceConversationLayout({ sessionIds: ['session-1'], pinnedSessionIds: ['session-2'] });
    dispatchEvent.mockReset();

    expect(ensureConversationTabOpen('session-2')).toEqual(['session-1']);
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(readConversationLayout()).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: ['session-2'],
      archivedSessionIds: [],
    });
  });

  it('moves conversations between the open and pinned shelves while preserving archived overrides', () => {
    replaceConversationLayout({
      sessionIds: ['session-1', 'session-2'],
      pinnedSessionIds: ['session-3'],
      archivedSessionIds: ['session-4'],
    });
    dispatchEvent.mockReset();

    expect(moveConversationTab('session-2', 'pinned', 'session-3', 'before')).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: ['session-2', 'session-3'],
      archivedSessionIds: ['session-4'],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    dispatchEvent.mockReset();
    expect(moveConversationTab('session-2', 'open', 'session-1', 'after')).toEqual({
      sessionIds: ['session-1', 'session-2'],
      pinnedSessionIds: ['session-3'],
      archivedSessionIds: ['session-4'],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('shifts an open conversation left or right within its shelf', () => {
    replaceConversationLayout({ sessionIds: ['session-1', 'session-2', 'session-3'], pinnedSessionIds: [] });
    dispatchEvent.mockReset();

    expect(shiftConversationTab('session-2', -1)).toEqual({
      sessionIds: ['session-2', 'session-1', 'session-3'],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    dispatchEvent.mockReset();
    expect(shiftConversationTab('session-2', 1)).toEqual({
      sessionIds: ['session-1', 'session-2', 'session-3'],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('shifts a pinned conversation within the pinned shelf only', () => {
    replaceConversationLayout({ sessionIds: ['session-3'], pinnedSessionIds: ['session-1', 'session-2'] });
    dispatchEvent.mockReset();

    expect(shiftConversationTab('session-2', -1)).toEqual({
      sessionIds: ['session-3'],
      pinnedSessionIds: ['session-2', 'session-1'],
      archivedSessionIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    dispatchEvent.mockReset();
    expect(shiftConversationTab('session-2', -1)).toEqual({
      sessionIds: ['session-3'],
      pinnedSessionIds: ['session-2', 'session-1'],
      archivedSessionIds: [],
    });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('ignores shift requests that would move past a shelf edge', () => {
    replaceConversationLayout({ sessionIds: ['session-1', 'session-2'], pinnedSessionIds: [] });
    dispatchEvent.mockReset();

    expect(shiftConversationTab('session-1', -1)).toEqual({
      sessionIds: ['session-1', 'session-2'],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it('pins a conversation by removing it from open tabs', () => {
    replaceConversationLayout({ sessionIds: ['session-1', 'session-2'], pinnedSessionIds: [] });
    dispatchEvent.mockReset();

    expect(pinConversationTab('session-2')).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: ['session-2'],
      archivedSessionIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('pins a conversation to the front of the pinned shelf', () => {
    replaceConversationLayout({ sessionIds: ['session-1', 'session-2'], pinnedSessionIds: ['session-3'] });
    dispatchEvent.mockReset();

    expect(pinConversationTab('session-2')).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: ['session-2', 'session-3'],
      archivedSessionIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('unpins a conversation back into open tabs by default', () => {
    replaceConversationLayout({ sessionIds: ['session-1'], pinnedSessionIds: ['session-2'] });
    dispatchEvent.mockReset();

    expect(unpinConversationTab('session-2')).toEqual({
      sessionIds: ['session-1', 'session-2'],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('can close a pinned conversation without reopening it in open tabs', () => {
    replaceConversationLayout({ sessionIds: ['session-1'], pinnedSessionIds: ['session-2'] });
    dispatchEvent.mockReset();

    expect(unpinConversationTab('session-2', { open: false })).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: [],
      archivedSessionIds: ['session-2'],
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
    expect(readConversationLayout()).toEqual({
      sessionIds: [],
      pinnedSessionIds: [],
      archivedSessionIds: ['session-1'],
    });
  });

  it('can archive and reopen a conversation regardless of whether it was open or pinned', () => {
    replaceConversationLayout({ sessionIds: ['session-1'], pinnedSessionIds: ['session-2'] });
    dispatchEvent.mockReset();

    expect(setConversationArchivedState('session-2', true)).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: [],
      archivedSessionIds: ['session-2'],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    dispatchEvent.mockReset();
    expect(setConversationArchivedState('session-2', false)).toEqual({
      sessionIds: ['session-1', 'session-2'],
      pinnedSessionIds: [],
      archivedSessionIds: [],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('can explicitly archive a conversation that is not currently in the workspace', () => {
    replaceConversationLayout({ sessionIds: ['session-1'], pinnedSessionIds: [] });
    dispatchEvent.mockReset();

    expect(setConversationArchivedState('session-3', true)).toEqual({
      sessionIds: ['session-1'],
      pinnedSessionIds: [],
      archivedSessionIds: ['session-3'],
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('reopens the most recently archived conversation first', () => {
    replaceConversationLayout({
      sessionIds: ['session-1'],
      pinnedSessionIds: [],
      archivedSessionIds: ['session-2', 'session-3'],
    });
    dispatchEvent.mockReset();

    expect(reopenMostRecentlyArchivedConversation()).toEqual({
      reopenedSessionId: 'session-3',
      layout: {
        sessionIds: ['session-1', 'session-3'],
        pinnedSessionIds: [],
        archivedSessionIds: ['session-2'],
      },
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    dispatchEvent.mockReset();
    expect(reopenMostRecentlyArchivedConversation()).toEqual({
      reopenedSessionId: 'session-2',
      layout: {
        sessionIds: ['session-1', 'session-3', 'session-2'],
        pinnedSessionIds: [],
        archivedSessionIds: [],
      },
    });
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is no archived conversation to reopen', () => {
    replaceConversationLayout({ sessionIds: ['session-1'], pinnedSessionIds: [] });
    dispatchEvent.mockReset();

    expect(reopenMostRecentlyArchivedConversation()).toEqual({
      reopenedSessionId: null,
      layout: {
        sessionIds: ['session-1'],
        pinnedSessionIds: [],
        archivedSessionIds: [],
      },
    });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });

});
