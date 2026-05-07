// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppDataContext, LiveTitlesContext, SseConnectionContext } from '../app/contexts.js';
import {
  buildSidebarNavSectionStorageKey,
  OPEN_SESSION_IDS_STORAGE_KEY,
  PINNED_SESSION_IDS_STORAGE_KEY,
  SAVED_WORKSPACE_PATHS_STORAGE_KEY,
} from '../local/localSettings.js';
import type { SessionMeta } from '../shared/types.js';
import { Sidebar } from './Sidebar.js';

Object.assign(globalThis, { React, IS_REACT_ACT_ENVIRONMENT: true });

const apiMocks = vi.hoisted(() => ({
  openConversationTabs: vi.fn(),
  setOpenConversationTabs: vi.fn(),
  setSavedWorkspacePaths: vi.fn(),
  changeConversationCwd: vi.fn(),
  gateways: vi.fn(),
  sessions: vi.fn(),
}));

vi.mock('../client/api', () => ({
  api: apiMocks,
}));

const mountedRoots: Root[] = [];
const THREADS_SORT_BY_STORAGE_KEY = buildSidebarNavSectionStorageKey('threads-sort-by');
const THREADS_MANUAL_GROUP_ORDER_STORAGE_KEY = buildSidebarNavSectionStorageKey('threads-manual-group-order');

function createStorage() {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
  };
}

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'conv-123',
    file: '/tmp/conv-123.jsonl',
    timestamp: '2026-03-16T09:30:00.000Z',
    cwd: '/home/user/project',
    cwdSlug: 'personal-agent',
    model: 'openai/gpt-5.4',
    title: 'Clarify background run link',
    messageCount: 4,
    isRunning: false,
    ...overrides,
  };
}

function renderSidebar(sessions: SessionMeta[]) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MemoryRouter initialEntries={['/conversations/new']}>
        <SseConnectionContext.Provider value={{ status: 'offline' }}>
          <AppDataContext.Provider
            value={{
              projects: null,
              sessions,
              tasks: null,
              runs: null,
              setProjects: () => {},
              setSessions: () => {},
              setTasks: () => {},
              setRuns: () => {},
            }}
          >
            <LiveTitlesContext.Provider value={{ titles: new Map(), setTitle: () => {} }}>
              <Sidebar />
            </LiveTitlesContext.Provider>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );
  });

  mountedRoots.push(root);
  return container;
}

async function flushAsyncWork() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

class TestDataTransfer {
  effectAllowed = 'all';
  dropEffect = 'move';
  private readonly values = new Map<string, string>();

  setData(type: string, value: string) {
    this.values.set(type, value);
  }

  getData(type: string) {
    return this.values.get(type) ?? '';
  }
}

function createDragEvent(type: string, dataTransfer: TestDataTransfer, clientY: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'clientY', { value: clientY });
  return event;
}

function setDragBounds(element: Element, top = 0, height = 100) {
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: top,
      top,
      bottom: top + height,
      left: 0,
      right: 240,
      width: 240,
      height,
      toJSON: () => ({}),
    }),
  });
}

function getGroupOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-sidebar-group-key]'))
    .map((element) => element.getAttribute('data-sidebar-group-key') ?? '')
    .filter(Boolean);
}

function getScopedGroupOrder(container: HTMLElement, prefix: string): string[] {
  return getGroupOrder(container).filter((groupKey) => groupKey.startsWith(prefix));
}

function getGroup(container: HTMLElement, groupKey: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(`[data-sidebar-group-key="${groupKey}"]`);
  if (!element) {
    throw new Error(`Missing group ${groupKey}`);
  }
  return element;
}

describe('Sidebar group drag reordering', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    apiMocks.openConversationTabs.mockReset();
    apiMocks.setOpenConversationTabs.mockReset();
    apiMocks.setSavedWorkspacePaths.mockReset();
    apiMocks.changeConversationCwd.mockReset();
    apiMocks.gateways.mockReset();
    apiMocks.sessions.mockReset();
    apiMocks.setOpenConversationTabs.mockResolvedValue({
      ok: true,
      sessionIds: [],
      pinnedSessionIds: [],
      archivedSessionIds: [],
      workspacePaths: [],
    });
    apiMocks.setSavedWorkspacePaths.mockResolvedValue([]);
    apiMocks.gateways.mockResolvedValue({ providers: [], connections: [], bindings: [], events: [], chatTargets: [] });
    apiMocks.sessions.mockResolvedValue([]);
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    localStorage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
  });

  afterEach(() => {
    while (mountedRoots.length > 0) {
      const root = mountedRoots.pop();
      act(() => {
        root?.unmount();
      });
    }
    document.body.innerHTML = '';
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not persist remote cwd paths into saved local workspaces', async () => {
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-remote-alpha']));
    apiMocks.openConversationTabs.mockResolvedValue({
      sessionIds: ['conv-remote-alpha'],
      pinnedSessionIds: [],
      archivedSessionIds: [],
      workspacePaths: [],
    });

    renderSidebar([
      createSession({
        id: 'conv-remote-alpha',
        title: 'Remote alpha thread',
        cwd: '/srv/repos/alpha',
        cwdSlug: 'alpha',
        remoteHostId: 'bender',
        remoteHostLabel: 'Bender',
      }),
    ]);

    await flushAsyncWork();

    expect(localStorage.getItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY)).toBeNull();
    expect(apiMocks.setSavedWorkspacePaths).not.toHaveBeenCalled();
  });

  it('reorders local project sections and moves their threads with them', async () => {
    const alphaPath = '/tmp/alpha-worktree';
    const betaPath = '/tmp/beta-worktree';
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-alpha', 'conv-beta']));
    localStorage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify([alphaPath, betaPath]));
    apiMocks.openConversationTabs.mockResolvedValue({
      sessionIds: ['conv-alpha', 'conv-beta'],
      pinnedSessionIds: [],
      archivedSessionIds: [],
      workspacePaths: [alphaPath, betaPath],
    });
    apiMocks.setSavedWorkspacePaths.mockResolvedValue([betaPath, alphaPath]);

    const container = renderSidebar([
      createSession({ id: 'conv-alpha', title: 'Alpha thread', cwd: alphaPath, cwdSlug: 'alpha-worktree' }),
      createSession({ id: 'conv-beta', title: 'Beta thread', cwd: betaPath, cwdSlug: 'beta-worktree' }),
    ]);

    await flushAsyncWork();

    const alphaGroup = getGroup(container, alphaPath);
    const betaGroup = getGroup(container, betaPath);
    setDragBounds(alphaGroup);
    setDragBounds(betaGroup);

    const dataTransfer = new TestDataTransfer();
    await act(async () => {
      betaGroup.dispatchEvent(createDragEvent('dragstart', dataTransfer, 75));
      alphaGroup.dispatchEvent(createDragEvent('dragover', dataTransfer, 10));
      alphaGroup.dispatchEvent(createDragEvent('drop', dataTransfer, 10));
    });
    await flushAsyncWork();

    expect(getGroupOrder(container)).toEqual([betaPath, alphaPath]);
    expect(localStorage.getItem(THREADS_SORT_BY_STORAGE_KEY)).toBe('manual');
    expect(JSON.parse(localStorage.getItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY) ?? '[]')).toEqual([betaPath, alphaPath]);
    expect(JSON.parse(localStorage.getItem(OPEN_SESSION_IDS_STORAGE_KEY) ?? '[]')).toEqual(['conv-beta', 'conv-alpha']);
    expect(apiMocks.setOpenConversationTabs).toHaveBeenCalledWith(['conv-beta', 'conv-alpha'], [], []);
    expect(apiMocks.setSavedWorkspacePaths).toHaveBeenCalledWith([betaPath, alphaPath]);
  });

  it('moves a conversation to another local cwd when dropped on a project section', async () => {
    const alphaPath = '/tmp/alpha-worktree';
    const betaPath = '/tmp/beta-worktree';
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-alpha', 'conv-beta']));
    localStorage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify([alphaPath, betaPath]));
    apiMocks.openConversationTabs.mockResolvedValue({
      sessionIds: ['conv-alpha', 'conv-beta'],
      pinnedSessionIds: [],
      archivedSessionIds: [],
      workspacePaths: [alphaPath, betaPath],
    });
    apiMocks.changeConversationCwd.mockResolvedValue({
      id: 'conv-alpha-moved',
      sessionFile: '/tmp/conv-alpha-moved.jsonl',
      cwd: betaPath,
      changed: true,
    });
    apiMocks.sessions.mockResolvedValue([
      createSession({ id: 'conv-alpha-moved', title: 'Alpha thread', cwd: betaPath, cwdSlug: 'beta-worktree' }),
      createSession({ id: 'conv-beta', title: 'Beta thread', cwd: betaPath, cwdSlug: 'beta-worktree' }),
    ]);

    const container = renderSidebar([
      createSession({ id: 'conv-alpha', title: 'Alpha thread', cwd: alphaPath, cwdSlug: 'alpha-worktree' }),
      createSession({ id: 'conv-beta', title: 'Beta thread', cwd: betaPath, cwdSlug: 'beta-worktree' }),
    ]);

    await flushAsyncWork();

    const alphaRow = container.querySelector<HTMLElement>('[data-sidebar-session-id="conv-alpha"]');
    const betaGroup = getGroup(container, betaPath);
    if (!alphaRow) {
      throw new Error('Missing alpha row');
    }
    setDragBounds(alphaRow);
    setDragBounds(betaGroup);

    const dataTransfer = new TestDataTransfer();
    await act(async () => {
      alphaRow.dispatchEvent(createDragEvent('dragstart', dataTransfer, 75));
      betaGroup.dispatchEvent(createDragEvent('dragover', dataTransfer, 50));
      betaGroup.dispatchEvent(createDragEvent('drop', dataTransfer, 50));
    });
    await flushAsyncWork();

    expect(apiMocks.changeConversationCwd).toHaveBeenCalledWith('conv-alpha', betaPath, expect.any(String));
    expect(apiMocks.sessions).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(OPEN_SESSION_IDS_STORAGE_KEY) ?? '[]')).toEqual(['conv-alpha-moved', 'conv-beta']);
    expect(container.textContent).toContain('Moved conversation to beta-worktree.');
  });

  it('moves a conversation to another local cwd when dropped on a conversation in that section', async () => {
    const alphaPath = '/tmp/alpha-worktree';
    const betaPath = '/tmp/beta-worktree';
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-alpha', 'conv-beta']));
    localStorage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify([alphaPath, betaPath]));
    apiMocks.openConversationTabs.mockResolvedValue({
      sessionIds: ['conv-alpha', 'conv-beta'],
      pinnedSessionIds: [],
      archivedSessionIds: [],
      workspacePaths: [alphaPath, betaPath],
    });
    apiMocks.changeConversationCwd.mockResolvedValue({
      id: 'conv-alpha',
      sessionFile: '/tmp/conv-alpha.jsonl',
      cwd: betaPath,
      changed: true,
    });
    apiMocks.sessions.mockResolvedValue([
      createSession({ id: 'conv-alpha', title: 'Alpha thread', cwd: betaPath, cwdSlug: 'beta-worktree' }),
      createSession({ id: 'conv-beta', title: 'Beta thread', cwd: betaPath, cwdSlug: 'beta-worktree' }),
    ]);

    const container = renderSidebar([
      createSession({ id: 'conv-alpha', title: 'Alpha thread', cwd: alphaPath, cwdSlug: 'alpha-worktree' }),
      createSession({ id: 'conv-beta', title: 'Beta thread', cwd: betaPath, cwdSlug: 'beta-worktree' }),
    ]);

    await flushAsyncWork();

    const alphaRow = container.querySelector<HTMLElement>('[data-sidebar-session-id="conv-alpha"]');
    const betaRow = container.querySelector<HTMLElement>('[data-sidebar-session-id="conv-beta"]');
    if (!alphaRow || !betaRow) {
      throw new Error('Missing conversation row');
    }
    setDragBounds(alphaRow);
    setDragBounds(betaRow);

    const dataTransfer = new TestDataTransfer();
    await act(async () => {
      alphaRow.dispatchEvent(createDragEvent('dragstart', dataTransfer, 75));
      betaRow.dispatchEvent(createDragEvent('dragover', dataTransfer, 50));
      betaRow.dispatchEvent(createDragEvent('drop', dataTransfer, 50));
    });
    await flushAsyncWork();

    expect(apiMocks.changeConversationCwd).toHaveBeenCalledWith('conv-alpha', betaPath, expect.any(String));
    expect(apiMocks.sessions).toHaveBeenCalled();
    expect(container.textContent).toContain('Moved conversation to beta-worktree.');
  });

  it('stores manual group order for remote sections even when shelf order cannot express it', async () => {
    const alphaKey = 'remote:bender::/srv/repos/alpha';
    const betaKey = 'remote:bender::/srv/repos/beta';
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-remote-open']));
    localStorage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-remote-pinned']));
    apiMocks.openConversationTabs.mockResolvedValue({
      sessionIds: ['conv-remote-open'],
      pinnedSessionIds: ['conv-remote-pinned'],
      archivedSessionIds: [],
      workspacePaths: [],
    });

    const container = renderSidebar([
      createSession({
        id: 'conv-remote-pinned',
        title: 'Pinned remote alpha',
        cwd: '/srv/repos/alpha',
        cwdSlug: 'alpha',
        remoteHostId: 'bender',
        remoteHostLabel: 'Bender',
      }),
      createSession({
        id: 'conv-remote-open',
        title: 'Open remote beta',
        cwd: '/srv/repos/beta',
        cwdSlug: 'beta',
        remoteHostId: 'bender',
        remoteHostLabel: 'Bender',
      }),
    ]);

    await flushAsyncWork();

    const alphaGroup = getGroup(container, alphaKey);
    const betaGroup = getGroup(container, betaKey);
    setDragBounds(alphaGroup);
    setDragBounds(betaGroup);

    const dataTransfer = new TestDataTransfer();
    await act(async () => {
      betaGroup.dispatchEvent(createDragEvent('dragstart', dataTransfer, 75));
      alphaGroup.dispatchEvent(createDragEvent('dragover', dataTransfer, 10));
      alphaGroup.dispatchEvent(createDragEvent('drop', dataTransfer, 10));
    });
    await flushAsyncWork();

    expect(getScopedGroupOrder(container, 'remote:')).toEqual([betaKey, alphaKey]);
    expect(localStorage.getItem(THREADS_SORT_BY_STORAGE_KEY)).toBe('manual');
    expect(
      JSON.parse(localStorage.getItem(THREADS_MANUAL_GROUP_ORDER_STORAGE_KEY) ?? '[]').filter((groupKey: string) =>
        groupKey.startsWith('remote:'),
      ),
    ).toEqual([betaKey, alphaKey]);
    expect(JSON.parse(localStorage.getItem(PINNED_SESSION_IDS_STORAGE_KEY) ?? '[]')).toEqual(['conv-remote-pinned']);
    expect(JSON.parse(localStorage.getItem(OPEN_SESSION_IDS_STORAGE_KEY) ?? '[]')).toEqual(['conv-remote-open']);
  });
});
