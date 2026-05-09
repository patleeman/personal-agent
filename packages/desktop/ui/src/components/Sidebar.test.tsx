import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppDataContext, LiveTitlesContext, SseConnectionContext } from '../app/contexts.js';
import {
  buildSidebarNavSectionStorageKey,
  OPEN_SESSION_IDS_STORAGE_KEY,
  PINNED_SESSION_IDS_STORAGE_KEY,
  SAVED_WORKSPACE_PATHS_STORAGE_KEY,
} from '../local/localSettings.js';
import type { DurableRunListResult, ScheduledTaskSummary, SessionMeta } from '../shared/types';
import { Sidebar } from './Sidebar.js';

const OPEN_NOTE_IDS_STORAGE_KEY = 'pa:open-note-ids';
const OPEN_SKILL_IDS_STORAGE_KEY = 'pa:open-skill-ids';
const PINNED_NOTE_IDS_STORAGE_KEY = 'pa:pinned-note-ids';

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
    cwd: '/home/user/project',
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
      tasks?: ScheduledTaskSummary[];
      liveTitles?: Map<string, string>;
      runs?: DurableRunListResult;
    },
  ) {
    return renderToString(
      <MemoryRouter initialEntries={[pathname]}>
        <SseConnectionContext.Provider value={{ status: 'offline' }}>
          <AppDataContext.Provider
            value={{
              projects: [
                {
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
                },
              ],
              sessions: options?.sessions ?? [createSession()],
              tasks: options?.tasks ?? null,
              runs: options?.runs ?? null,
              setProjects: () => {},
              setSessions: () => {},
              setTasks: () => {},
              setRuns: () => {},
            }}
          >
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

    expect(html.indexOf('Chat')).toBeLessThan(html.indexOf('Threads'));
    expect(html).not.toContain('Open Conversations');
    expect(html).not.toContain('Pinned Conversations');
    expect(html).not.toContain('Alerts');
    expect(html).not.toContain('Notifications');
    expect(html).not.toContain('Runs');
    expect(html).not.toContain('Vault');
    expect(html).toContain('Threads');
    expect(html).toContain('aria-label="Organize and sort threads"');
    expect(html).toContain('aria-label="Find threads and archived conversations"');
    expect(html).toContain('aria-label="Add workspace"');
    expect(html).not.toContain('Conversations');
    expect(html).not.toContain('Docs');
    expect(html).not.toContain('Capabilities');
    expect(html).not.toContain('Needs review');
    expect(html).not.toContain('Archived');
  });

  it('can hide Knowledge from the left nav for workbench layouts', () => {
    const html = renderSidebar('/conversations/new', { hideKnowledgeNav: true });

    expect(html).toContain('Chat');
    expect(html).not.toContain('href="/knowledge"');
  });

  it('keeps pinned conversations in the main conversation list with a subtle pin indicator', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    storage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-123']));
    storage.setItem(PINNED_NOTE_IDS_STORAGE_KEY, JSON.stringify(['note-index']));

    const html = renderSidebar('/conversations/new');

    expect(html).not.toContain('Pinned Conversations');
    expect(html).toContain('Clarify background run link');
    expect(html).toContain('aria-label="Pinned chat"');
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

  it('renders an open conversation only once when the hydrated session data catches up', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-dup-guard']));

    const html = renderSidebar('/conversations/conv-dup-guard', {
      sessions: [createSession({ id: 'conv-dup-guard', title: 'Sidebar duplicate guard validation' })],
    });

    expect((html.match(/href="\/conversations\/conv-dup-guard"/g) ?? []).length).toBe(1);
    expect((html.match(/Sidebar duplicate guard validation/g) ?? []).length).toBe(1);
  });

  it('renders the conversation timestamp in the trailing inline slot by default', () => {
    const html = renderSidebar('/conversations/new', {
      sessions: [createSession({ title: 'Single-line timestamp row' })],
    });

    expect(html).toContain('Single-line timestamp row');
    expect(html).toContain('ui-sidebar-session-time');
    expect(html).toContain('30m');
    expect(html).toContain('pr-[4.5rem]');
    expect(html).toContain('right-2.5');
  });

  it('filters automation-owned threads without labeling idle rows as active automation', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-auto', 'conv-human']));
    storage.setItem(buildSidebarNavSectionStorageKey('threads-filter'), 'automation');

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({ id: 'conv-auto', title: 'Daily release brief' }),
        createSession({ id: 'conv-human', title: 'Human thread' }),
      ],
      tasks: [
        {
          id: 'daily-release-brief',
          title: 'Daily release brief',
          scheduleType: 'cron',
          running: false,
          enabled: true,
          prompt: 'Summarize releases.',
          threadConversationId: 'conv-auto',
        },
      ],
    });

    expect(html).toContain('Daily release brief');
    expect(html).not.toContain('>auto<');
    expect(html).not.toContain('Human thread');
    expect(html).not.toContain('No automation threads yet.');
  });

  it('shows an automation-specific empty state when the automation filter has no matches', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-human']));
    storage.setItem(buildSidebarNavSectionStorageKey('threads-filter'), 'automation');

    const html = renderSidebar('/conversations/new', {
      sessions: [createSession({ id: 'conv-human', title: 'Human thread' })],
      tasks: [],
    });

    expect(html).toContain('No automation threads yet.');
    expect(html).not.toContain('Human thread');
  });

  it('renders running state for automation-owned threads even when the conversation is not a live local session', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-auto']));

    const html = renderSidebar('/conversations/new', {
      sessions: [createSession({ id: 'conv-auto', title: 'Morning briefing thread', isRunning: false })],
      tasks: [
        {
          id: 'morning-briefing',
          title: 'Morning briefing',
          scheduleType: 'cron',
          running: true,
          enabled: true,
          prompt: 'Assemble the morning briefing.',
          threadConversationId: 'conv-auto',
        },
      ],
    });

    expect(html).toContain('aria-label="Running conversation"');
    expect(html).toContain('M12 6v6l4 2m5-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z');
    expect(html).toContain('Morning briefing thread');
  });

  it('groups open conversations by working directory with collapsible headers and quick-start actions', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-a1', 'conv-b1', 'conv-a2']));

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({ id: 'conv-a1', title: 'First alpha conversation', cwd: '/tmp/alpha-worktree', cwdSlug: 'alpha-worktree' }),
        createSession({
          id: 'conv-b1',
          title: 'Only beta conversation',
          cwd: '/tmp/beta-worktree',
          cwdSlug: 'beta-worktree',
          file: '/tmp/conv-b1.jsonl',
        }),
        createSession({
          id: 'conv-a2',
          title: 'Second alpha conversation',
          cwd: '/tmp/alpha-worktree',
          cwdSlug: 'alpha-worktree',
          file: '/tmp/conv-a2.jsonl',
        }),
      ],
    });

    expect((html.match(/alpha-worktree/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect((html.match(/beta-worktree/g) ?? []).length).toBeGreaterThanOrEqual(1);
    expect(html).toContain('title="/tmp/alpha-worktree"');
    expect(html).toContain('title="Workspace actions for /tmp/alpha-worktree"');
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
    storage.setItem(buildSidebarNavSectionStorageKey('threads-collapsed-cwd-groups'), JSON.stringify(['/home/user/project']));

    const html = renderSidebar('/conversations/new');

    expect(html).toContain('aria-label="Expand project"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Clarify background run link');
  });

  it('shows saved workspaces even when they have no threads yet', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    storage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    storage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify(['/tmp/alpha-worktree']));

    const html = renderSidebar('/conversations/new', { sessions: [] });

    expect(html).toContain('alpha-worktree');
    expect(html).toContain('title="New conversation in /tmp/alpha-worktree"');
    expect(html).toContain('No threads yet.');
    expect(html).not.toContain('No open conversations yet.');
  });

  it('disambiguates saved workspaces that share the same basename', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    storage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    storage.setItem(
      SAVED_WORKSPACE_PATHS_STORAGE_KEY,
      JSON.stringify(['/home/user/personal/personal-agent', '/home/user/documents/personal-agent']),
    );

    const html = renderSidebar('/conversations/new', { sessions: [] });

    expect(html).toContain('personal/personal-agent');
    expect(html).toContain('documents/personal-agent');
    expect(html).not.toContain('aria-label="Collapse personal-agent"');
  });

  it('coalesces saved workspaces and threads that only differ by trailing slashes', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-alpha']));
    storage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify(['/tmp/alpha-worktree/']));

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({
          id: 'conv-alpha',
          title: 'Alpha thread',
          cwd: '/tmp/alpha-worktree',
          cwdSlug: 'alpha-worktree',
        }),
      ],
    });

    expect(html.match(/aria-label="Collapse alpha-worktree"/g) ?? []).toHaveLength(1);
  });

  it('renders saved custom cwd group labels when present', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-123']));
    storage.setItem(
      buildSidebarNavSectionStorageKey('threads-cwd-group-label-overrides'),
      JSON.stringify({ '/home/user/project': 'Desktop' }),
    );

    const html = renderSidebar('/conversations/new');

    expect(html).toContain('Desktop');
    expect(html).not.toContain('aria-label="Collapse personal-agent"');
    expect(html).toContain('aria-label="Collapse Desktop"');
  });

  it('keeps workspace groups in the saved workspace order even when thread activity changes', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-alpha', 'conv-beta']));
    storage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify(['/tmp/beta-worktree', '/tmp/alpha-worktree']));
    storage.setItem(buildSidebarNavSectionStorageKey('threads-sort-by'), 'updated');

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({
          id: 'conv-alpha',
          title: 'Alpha thread',
          cwd: '/tmp/alpha-worktree',
          cwdSlug: 'alpha-worktree',
          lastActivityAt: '2026-03-16T09:55:00.000Z',
        }),
        createSession({
          id: 'conv-beta',
          title: 'Beta thread',
          cwd: '/tmp/beta-worktree',
          cwdSlug: 'beta-worktree',
          lastActivityAt: '2026-03-16T09:35:00.000Z',
        }),
      ],
    });

    expect(html.indexOf('beta-worktree')).toBeLessThan(html.indexOf('alpha-worktree'));
    expect(html.indexOf('beta-worktree')).toBeLessThan(html.indexOf('Beta thread'));
    expect(html.indexOf('alpha-worktree')).toBeLessThan(html.indexOf('Alpha thread'));
  });

  it('brings pinned conversations and their workspace to the top of the project list', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-beta']));
    storage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-alpha']));
    storage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify(['/tmp/beta-worktree', '/tmp/alpha-worktree']));
    storage.setItem(buildSidebarNavSectionStorageKey('threads-sort-by'), 'updated');

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({
          id: 'conv-alpha',
          title: 'Pinned alpha thread',
          cwd: '/tmp/alpha-worktree',
          cwdSlug: 'alpha-worktree',
          lastActivityAt: '2026-03-16T09:05:00.000Z',
        }),
        createSession({
          id: 'conv-beta',
          title: 'Beta thread',
          cwd: '/tmp/beta-worktree',
          cwdSlug: 'beta-worktree',
          lastActivityAt: '2026-03-16T09:55:00.000Z',
        }),
      ],
    });

    expect(html.indexOf('alpha-worktree')).toBeLessThan(html.indexOf('beta-worktree'));
    expect(html.indexOf('Pinned alpha thread')).toBeLessThan(html.indexOf('beta-worktree'));
    expect(html.indexOf('Pinned alpha thread')).toBeLessThan(html.indexOf('Beta thread'));
  });

  it('can render a flat chronological thread list sorted by the saved sort mode', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-older', 'conv-newer']));
    storage.setItem(buildSidebarNavSectionStorageKey('threads-organize'), 'chronological');
    storage.setItem(buildSidebarNavSectionStorageKey('threads-sort-by'), 'updated');

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({
          id: 'conv-older',
          title: 'Older thread',
          cwd: '/tmp/alpha-worktree',
          cwdSlug: 'alpha-worktree',
          lastActivityAt: '2026-03-16T09:35:00.000Z',
        }),
        createSession({
          id: 'conv-newer',
          title: 'Newer thread',
          cwd: '/tmp/beta-worktree',
          cwdSlug: 'beta-worktree',
          lastActivityAt: '2026-03-16T09:55:00.000Z',
        }),
      ],
    });

    expect(html).not.toContain('aria-label="Collapse alpha-worktree"');
    expect(html).not.toContain('aria-label="Collapse beta-worktree"');
    expect(html.indexOf('Newer thread')).toBeLessThan(html.indexOf('Older thread'));
  });

  it('sorts malformed thread activity timestamps after valid chronological items', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-valid', 'conv-malformed']));
    storage.setItem(buildSidebarNavSectionStorageKey('threads-organize'), 'chronological');
    storage.setItem(buildSidebarNavSectionStorageKey('threads-sort-by'), 'updated');

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({
          id: 'conv-malformed',
          title: 'Malformed activity thread',
          lastActivityAt: '9999',
        }),
        createSession({
          id: 'conv-valid',
          title: 'Valid activity thread',
          lastActivityAt: '2026-03-16T09:55:00.000Z',
        }),
      ],
    });

    expect(html.indexOf('Valid activity thread')).toBeLessThan(html.indexOf('Malformed activity thread'));
  });

  it('defaults to sorting threads by created time when no sort preference is saved', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-earlier', 'conv-later']));
    storage.setItem(buildSidebarNavSectionStorageKey('threads-organize'), 'chronological');

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({
          id: 'conv-earlier',
          title: 'Earlier created thread',
          timestamp: '2026-03-16T09:05:00.000Z',
          lastActivityAt: '2026-03-16T09:59:00.000Z',
        }),
        createSession({
          id: 'conv-later',
          title: 'Later created thread',
          timestamp: '2026-03-16T09:45:00.000Z',
          lastActivityAt: '2026-03-16T09:10:00.000Z',
        }),
      ],
    });

    expect(html.indexOf('Later created thread')).toBeLessThan(html.indexOf('Earlier created thread'));
  });

  it('can sort threads by created time when that preference is saved', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-earlier', 'conv-later']));
    storage.setItem(buildSidebarNavSectionStorageKey('threads-organize'), 'chronological');
    storage.setItem(buildSidebarNavSectionStorageKey('threads-sort-by'), 'created');

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({
          id: 'conv-earlier',
          title: 'Earlier created thread',
          timestamp: '2026-03-16T09:05:00.000Z',
          lastActivityAt: '2026-03-16T09:59:00.000Z',
        }),
        createSession({
          id: 'conv-later',
          title: 'Later created thread',
          timestamp: '2026-03-16T09:45:00.000Z',
          lastActivityAt: '2026-03-16T09:10:00.000Z',
        }),
      ],
    });

    expect(html.indexOf('Later created thread')).toBeLessThan(html.indexOf('Earlier created thread'));
  });

  it('can render a flat thread list in explicit pinned and open order when manual order is selected', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-second', 'conv-third']));
    storage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-first']));
    storage.setItem(buildSidebarNavSectionStorageKey('threads-organize'), 'chronological');
    storage.setItem(buildSidebarNavSectionStorageKey('threads-sort-by'), 'manual');

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({
          id: 'conv-first',
          title: 'Pinned first thread',
          cwd: '/tmp/alpha-worktree',
          cwdSlug: 'alpha-worktree',
          lastActivityAt: '2026-03-16T09:05:00.000Z',
        }),
        createSession({
          id: 'conv-second',
          title: 'Second thread',
          cwd: '/tmp/beta-worktree',
          cwdSlug: 'beta-worktree',
          lastActivityAt: '2026-03-16T09:55:00.000Z',
        }),
        createSession({
          id: 'conv-third',
          title: 'Third thread',
          cwd: '/tmp/gamma-worktree',
          cwdSlug: 'gamma-worktree',
          lastActivityAt: '2026-03-16T09:15:00.000Z',
        }),
      ],
    });

    expect(html).not.toContain('aria-label="Collapse alpha-worktree"');
    expect(html.indexOf('Pinned first thread')).toBeLessThan(html.indexOf('Second thread'));
    expect(html.indexOf('Second thread')).toBeLessThan(html.indexOf('Third thread'));
  });

  it('can keep project groups while honoring manual thread order within each project', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-alpha-2', 'conv-beta-1', 'conv-alpha-1']));
    storage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify(['/tmp/alpha-worktree', '/tmp/beta-worktree']));
    storage.setItem(buildSidebarNavSectionStorageKey('threads-organize'), 'project');
    storage.setItem(buildSidebarNavSectionStorageKey('threads-sort-by'), 'manual');

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({
          id: 'conv-alpha-1',
          title: 'Alpha first thread',
          cwd: '/tmp/alpha-worktree',
          cwdSlug: 'alpha-worktree',
          lastActivityAt: '2026-03-16T09:05:00.000Z',
        }),
        createSession({
          id: 'conv-beta-1',
          title: 'Beta thread',
          cwd: '/tmp/beta-worktree',
          cwdSlug: 'beta-worktree',
          lastActivityAt: '2026-03-16T09:55:00.000Z',
        }),
        createSession({
          id: 'conv-alpha-2',
          title: 'Alpha second thread',
          cwd: '/tmp/alpha-worktree',
          cwdSlug: 'alpha-worktree',
          lastActivityAt: '2026-03-16T09:15:00.000Z',
        }),
      ],
    });

    expect(html.indexOf('alpha-worktree')).toBeLessThan(html.indexOf('beta-worktree'));
    expect(html.indexOf('Alpha second thread')).toBeLessThan(html.indexOf('Alpha first thread'));
    expect(html.indexOf('Alpha first thread')).toBeLessThan(html.indexOf('Beta thread'));
  });

  it('maps the legacy manual organize preference to chronological manual order', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-legacy-1', 'conv-legacy-2']));
    storage.setItem(buildSidebarNavSectionStorageKey('threads-organize'), 'manual');
    storage.setItem(buildSidebarNavSectionStorageKey('threads-sort-by'), 'updated');

    const html = renderSidebar('/conversations/new', {
      sessions: [
        createSession({
          id: 'conv-legacy-1',
          title: 'Legacy first thread',
          cwd: '/tmp/alpha-worktree',
          cwdSlug: 'alpha-worktree',
          lastActivityAt: '2026-03-16T09:05:00.000Z',
        }),
        createSession({
          id: 'conv-legacy-2',
          title: 'Legacy second thread',
          cwd: '/tmp/beta-worktree',
          cwdSlug: 'beta-worktree',
          lastActivityAt: '2026-03-16T09:55:00.000Z',
        }),
      ],
    });

    expect(html).not.toContain('aria-label="Collapse alpha-worktree"');
    expect(html.indexOf('Legacy first thread')).toBeLessThan(html.indexOf('Legacy second thread'));
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

  it('highlights Chat on the new conversation route', () => {
    const html = renderSidebar('/conversations/new');

    expect(html).toContain('Chat');
    expect(html).toContain('ui-sidebar-nav-item-active');
    expect(html).not.toContain('ui-sidebar-session-row-active');
  });

  it('keeps knowledge files out of the core sidebar', () => {
    const html = renderSidebar('/knowledge?file=AGENTS.md');

    expect(html).not.toContain('Open Files');
    expect(html).not.toContain('aria-label="Open file AGENTS.md"');
    expect(html).toContain('Threads');
  });

  it('keeps Chat neutral on conversation routes while the selected thread owns the active chrome', () => {
    const html = renderSidebar('/conversations/conv-123');

    expect(html).toContain('Chat');
    expect(html).not.toContain('ui-sidebar-nav-item-active');
    expect(html).toContain('ui-sidebar-session-row-active');
    expect(html).toContain('ui-sidebar-session-time');
    expect(html).toContain('30m');
    expect(html).not.toContain('aria-label="Conversation actions: Clarify background run link"');
    expect(html).not.toContain('aria-label="Pin"');
    expect(html).not.toContain('>Conversations<');
  });

  it('renders the settings nav section at the bottom with extension-contributed items', () => {
    const html = renderSidebar('/settings');
    expect(html).toContain('Threads');
    expect(html).toContain('<div class="border-t border-border-subtle px-2 py-2 space-y-0.5">');
  });
});
