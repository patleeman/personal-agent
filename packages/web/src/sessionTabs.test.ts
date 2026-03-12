import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OPEN_SESSION_IDS_STORAGE_KEY } from './localSettings';
import {
  closeConversationTab,
  ensureConversationTabOpen,
  readOpenSessionIds,
  reorderOpenSessionIds,
  replaceOpenConversationTabs,
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

  it('sanitizes stored open session ids', () => {
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify([' session-1 ', '', null, 'session-2', 42]));

    expect([...readOpenSessionIds()]).toEqual(['session-1', 'session-2']);
  });

  it('opens a conversation tab once even when asked repeatedly', () => {
    expect([...ensureConversationTabOpen('session-1')]).toEqual(['session-1']);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);

    expect([...ensureConversationTabOpen(' session-1 ')]).toEqual(['session-1']);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect([...readOpenSessionIds()]).toEqual(['session-1']);
  });

  it('replaces the local tab set from a durable snapshot', () => {
    expect([...replaceOpenConversationTabs([' session-2 ', 'session-1', 'session-2'])]).toEqual(['session-2', 'session-1']);
    expect([...readOpenSessionIds()]).toEqual(['session-2', 'session-1']);
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

  it('only dispatches changes when a tab actually closes', () => {
    ensureConversationTabOpen('session-1');
    dispatchEvent.mockReset();

    expect([...closeConversationTab('missing')]).toEqual(['session-1']);
    expect(dispatchEvent).not.toHaveBeenCalled();

    expect([...closeConversationTab('session-1')]).toEqual([]);
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect([...readOpenSessionIds()]).toEqual([]);
  });
});
