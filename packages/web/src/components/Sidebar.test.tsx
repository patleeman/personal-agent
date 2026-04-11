import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, LiveTitlesContext, SseConnectionContext } from '../contexts.js';
import {
  OPEN_NOTE_IDS_STORAGE_KEY,
  OPEN_SESSION_IDS_STORAGE_KEY,
  OPEN_SKILL_IDS_STORAGE_KEY,
  PINNED_NOTE_IDS_STORAGE_KEY,
  PINNED_SESSION_IDS_STORAGE_KEY,
  buildSidebarNavSectionStorageKey,
} from '../localSettings.js';
import type { DurableRunListResult, SessionMeta } from '../types.js';
import { Sidebar } from './Sidebar.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

class MemoryStorage {
  private readonly store = new Map<string, string>();

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  removeItem(key: string) {
    this.store.delete(key);
  }

  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

function createSession(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id: 'conv-123',
    file: '/tmp/conv-123.jsonl',
    timestamp: '2026-03-16T09:30:00.000Z',
    cwd: '/Users/patrickc.lee/personal/personal-agent',
    cwdSlug: 'personal-agent',
    model: 'openai/gpt-5.4',
    title: 'Clarify background run link',
    messageCount: 4,
    isRunning: false,
    ...overrides,
  };
}

describe('Sidebar', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;
  const storage = new MemoryStorage();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T10:00:02.000Z'));
    storage.clear();
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-123']));
    storage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: storage,
    });

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  function renderSidebar(
    pathname = '/conversations/new',
    options?: {
      sessions?: SessionMeta[];
      liveTitles?: Map<string, string>;
      runs?: DurableRunListResult;
    },
  ) {
    return renderToString(
      <MemoryRouter initialEntries={[pathname]}>
        <SseConnectionContext.Provider value={{ status: 'offline' }}>
          <AppDataContext.Provider value={{
            projects: [{
              id: 'active-project',
              title: 'Active project',
              summary: 'In progress.',
              description: 'Still being worked on.',
              createdAt: '2026-03-16T10:00:00.000Z',
              updatedAt: '2026-03-16T12:00:00.000Z',
              requirements: { goal: 'Ship the work.', acceptanceCriteria: [] },
              status: 'in_progress',
              blockers: [],
              recentProgress: [],
              plan: { milestones: [], tasks: [] },
              profile: 'assistant',
            }],
            sessions: options?.sessions ?? [createSession()],
            tasks: null,
            runs: options?.runs ?? null,
            setProjects: () => {},
            setSessions: () => {},
            setTasks: () => {},
            setRuns: () => {},
          }}>
            <LiveTitlesContext.Provider value={{ titles: options?.liveTitles ?? new Map(), setTitle: () => {} }}>
              <Sidebar />
            </LiveTitlesContext.Provider>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );
  }

  it('renders a flat primary nav for core workspaces', () => {
    const html = renderSidebar('/conversations/new');

    expect(html.indexOf('Chat')).toBeLessThan(html.indexOf('Automations'));
    expect(html.indexOf('Automations')).toBeLessThan(html.indexOf('Threads'));
    expect(html.indexOf('Threads')).toBeLessThan(html.indexOf('Settings'));
    expect(html).not.toContain('Open Conversations');
    expect(html).not.toContain('Pinned Conversations');
    expect(html).not.toContain('Alerts');
    expect(html).not.toContain('Notifications');
    expect(html).toContain('Settings');
    expect(html).not.toContain('Runs');
    expect(html).not.toContain('Vault');
    expect(html).toContain('Automations');
    expect(html).toContain('Threads');
    expect(html).not.toContain('Conversations');
    expect(html).not.toContain('Docs');
    expect(html).not.toContain('Capabilities');
    expect(html).not.toContain('Needs review');
    expect(html).not.toContain('Archived');
  });

  it('keeps pinned conversations in the main conversation list without separate pin chrome', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    storage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-123']));
    storage.setItem(PINNED_NOTE_IDS_STORAGE_KEY, JSON.stringify(['note-index']));

    const html = renderSidebar('/conversations/new');

    expect(html).not.toContain('Pinned Conversations');
    expect(html).toContain('Clarify background run link');
    expect(html).not.toContain('aria-label="Pinned"');
    expect(html).not.toContain('aria-label="Pin"');
  });

  it('renders compact left-edge indicators for running and review states', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-running', 'conv-review']));

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({ id: 'conv-running', title: 'Active conversation', isRunning: true }),
        createSession({ id: 'conv-review', title: 'Unread follow-up', file: '/tmp/conv-review.jsonl', needsAttention: true }),
      ],
    });

    expect(html).toContain('aria-label="Running conversation"');
    expect(html).toContain('aria-label="Conversation needs review"');
    expect(html).toContain('animate-spin');
    expect(html).not.toContain('>running<');
    expect(html).not.toContain('>needs review<');
  });

  it('keeps live title overrides scoped to the matching conversation id', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-123', 'conv-456']));

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({ id: 'conv-123', title: 'First conversation' }),
        createSession({ id: 'conv-456', title: 'Second conversation' }),
      ],
      liveTitles: new Map([
        ['conv-123', 'Fresh live title A'],
        ['conv-456', 'Fresh live title B'],
      ]),
    });

    expect(html).toContain('Fresh live title A');
    expect(html).toContain('Fresh live title B');
    expect(html).not.toContain('First conversation');
    expect(html).not.toContain('Second conversation');
    expect((html.match(/Fresh live title A/g) ?? []).length).toBe(1);
    expect((html.match(/Fresh live title B/g) ?? []).length).toBe(1);
  });

  it('renders the conversation timestamp in the trailing inline slot by default', () => {
    const html = renderSidebar('/conversations/new', {
      sessions: [createSession({ title: 'Single-line timestamp row' })],
    });

    expect(html).toContain('Single-line timestamp row');
    expect(html).toContain('ui-sidebar-session-time');
    expect(html).toContain('30m ago');
  });

  it('groups open conversations by working directory with collapsible headers and quick-start actions', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-a1', 'conv-b1', 'conv-a2']));

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({ id: 'conv-a1', title: 'First alpha conversation', cwd: '/tmp/alpha-worktree', cwdSlug: 'alpha-worktree' }),
        createSession({ id: 'conv-b1', title: 'Only beta conversation', cwd: '/tmp/beta-worktree', cwdSlug: 'beta-worktree', file: '/tmp/conv-b1.jsonl' }),
        createSession({ id: 'conv-a2', title: 'Second alpha conversation', cwd: '/tmp/alpha-worktree', cwdSlug: 'alpha-worktree', file: '/tmp/conv-a2.jsonl' }),
      ],
    });

    expect((html.match(/alpha-worktree/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((html.match(/beta-worktree/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('title="/tmp/alpha-worktree"');
    expect(html).toContain('title="New conversation in /tmp/alpha-worktree"');
    expect(html).toContain('aria-label="Collapse alpha-worktree"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('>2</span>');
    expect(html.indexOf('alpha-worktree')).toBeLessThan(html.indexOf('First alpha conversation'));
    expect(html.indexOf('First alpha conversation')).toBeLessThan(html.indexOf('Second alpha conversation'));
    expect(html.indexOf('Second alpha conversation')).toBeLessThan(html.indexOf('beta-worktree'));
  });

  it('hides conversation rows for collapsed cwd groups', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-123']));
    storage.setItem(
      buildSidebarNavSectionStorageKey('threads-collapsed-cwd-groups'),
      JSON.stringify(['/Users/patrickc.lee/personal/personal-agent']),
    );

    const html = renderSidebar('/conversations/new');

    expect(html).toContain('aria-label="Expand personal-agent"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Clarify background run link');
  });

  it('keeps open conversation rows draggable so sidebar reordering still works', () => {
    const html = renderSidebar('/conversations/new');

    expect(html).toContain('draggable="true"');
    expect(html).toContain('Drag to reorder conversations');
    expect(html).not.toContain('move between pinned and open conversations');
  });

  it('keeps child conversations flat in the explicit tab order', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['child-1', 'conv-123']));

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({ id: 'conv-123', title: 'Parent conversation' }),
        createSession({
          id: 'child-1',
          file: '/tmp/child-1.jsonl',
          title: 'Child subagent conversation',
          parentSessionId: 'conv-123',
        }),
      ],
    });

    expect(html.indexOf('Child subagent conversation')).toBeLessThan(html.indexOf('Parent conversation'));
    expect(html).not.toContain('Nested under Parent conversation');
    expect(html).not.toContain('padding-left:14px');
  });

  it('keeps the sidebar focused on chat and system surfaces', () => {
    storage.setItem(OPEN_NOTE_IDS_STORAGE_KEY, JSON.stringify(['note-index']));
    storage.setItem(OPEN_SKILL_IDS_STORAGE_KEY, JSON.stringify(['agent-browser']));

    const html = renderSidebar('/conversations/new');

    expect(html).not.toContain('Open Docs');
    expect(html).not.toContain('Draft doc');
    expect(html).not.toContain('Open Workspaces');
    expect(html).not.toContain('Vault');
  });

  it('marks Chat as the active nav on conversation routes and keeps row actions hidden until hover', () => {
    const html = renderSidebar('/conversations/conv-123');

    expect(html).toContain('Chat');
    expect(html).toContain('ui-sidebar-nav-item-active');
    expect(html).toContain('ui-sidebar-session-time');
    expect(html).toContain('30m ago');
    expect(html).not.toContain('aria-label="Conversation actions: Clarify background run link"');
    expect(html).not.toContain('aria-label="Pin"');
    expect(html).not.toContain('>Conversations<');
  });

  it('treats settings routes as part of Settings in the main sidebar', () => {
    const html = renderSidebar('/system');

    expect(html).toContain('href="/settings"');
    expect(html).toContain('ui-sidebar-nav-item-active');
    expect(html).not.toContain('>Runs<');
  });
});
