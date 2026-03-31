import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, LiveTitlesContext, SseConnectionContext } from '../contexts.js';
import {
  OPEN_NOTE_IDS_STORAGE_KEY,
  OPEN_PROJECT_IDS_STORAGE_KEY,
  OPEN_SESSION_IDS_STORAGE_KEY,
  OPEN_SKILL_IDS_STORAGE_KEY,
  OPEN_WORKSPACE_IDS_STORAGE_KEY,
  PINNED_NOTE_IDS_STORAGE_KEY,
  PINNED_SESSION_IDS_STORAGE_KEY,
} from '../localSettings.js';
import type { DurableRunListResult, DurableRunRecord, SessionMeta } from '../types.js';
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

function createSubagentRun(overrides: Partial<DurableRunRecord> = {}): DurableRunRecord {
  return {
    runId: 'run-subagent-123',
    paths: {
      root: '/tmp/runs/run-subagent-123',
      manifestPath: '/tmp/runs/run-subagent-123/manifest.json',
      statusPath: '/tmp/runs/run-subagent-123/status.json',
      checkpointPath: '/tmp/runs/run-subagent-123/checkpoint.json',
      eventsPath: '/tmp/runs/run-subagent-123/events.jsonl',
      outputLogPath: '/tmp/runs/run-subagent-123/output.log',
      resultPath: '/tmp/runs/run-subagent-123/result.json',
    },
    manifest: {
      version: 1,
      id: 'run-subagent-123',
      kind: 'background-run',
      resumePolicy: 'manual',
      createdAt: '2026-03-16T09:30:00.000Z',
      spec: {
        taskSlug: 'subagent',
      },
      source: {
        type: 'tool',
        id: 'conv-123',
      },
    },
    status: {
      version: 1,
      runId: 'run-subagent-123',
      status: 'running',
      createdAt: '2026-03-16T09:30:00.000Z',
      updatedAt: '2026-03-16T09:31:00.000Z',
      activeAttempt: 1,
      startedAt: '2026-03-16T09:30:10.000Z',
    },
    checkpoint: {
      version: 1,
      runId: 'run-subagent-123',
      updatedAt: '2026-03-16T09:31:00.000Z',
      payload: {},
    },
    problems: [],
    recoveryAction: 'none',
    ...overrides,
  };
}

function createRunList(runs: DurableRunRecord[]): DurableRunListResult {
  return {
    scannedAt: '2026-03-16T09:31:00.000Z',
    runsRoot: '/tmp/runs',
    summary: {
      total: runs.length,
      recoveryActions: {},
      statuses: {},
    },
    runs,
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
    pathname = '/inbox',
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
            activity: { entries: [], unreadCount: 0 },
            alerts: { entries: [], activeCount: 0 },
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
            setActivity: () => {},
            setAlerts: () => {},
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
    const html = renderSidebar('/inbox');

    expect(html.indexOf('Inbox')).toBeLessThan(html.indexOf('Conversations'));
    expect(html.indexOf('Conversations')).toBeLessThan(html.indexOf('Knowledge Base'));
    expect(html.indexOf('Knowledge Base')).toBeLessThan(html.indexOf('Workspace'));
    expect(html).toContain('Open Conversations');
    expect(html).not.toContain('Pinned Conversations');
    expect(html).not.toContain('Alerts');
    expect(html).toContain('Settings');
    expect(html).not.toContain('Runs');
    expect(html).toContain('Knowledge Base');
    expect(html).not.toContain('Capabilities');
    expect(html).not.toContain('Needs review');
    expect(html).not.toContain('Archived');
  });

  it('keeps pinned conversations in the open conversations section and shows a pinned indicator', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify([]));
    storage.setItem(PINNED_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-123']));
    storage.setItem(PINNED_NOTE_IDS_STORAGE_KEY, JSON.stringify(['note-index']));

    const html = renderSidebar('/inbox');

    expect(html).toContain('Open Conversations');
    expect(html).not.toContain('Pinned Conversations');
    expect(html).toContain('Clarify background run link');
    expect((html.match(/aria-label="Pinned"/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('keeps live title overrides scoped to the matching conversation id', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-123', 'conv-456']));

    const html = renderSidebar('/inbox', {
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

  it('keeps open conversation rows draggable so sidebar reordering still works', () => {
    const html = renderSidebar('/inbox');

    expect(html).toContain('draggable="true"');
    expect(html).toContain('Drag to reorder or move between pinned and open conversations');
  });

  it('indents subagent conversations under their parent conversation', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-123', 'child-1']));

    const html = renderSidebar('/inbox', {
      sessions: [
        createSession({ id: 'conv-123', title: 'Parent conversation' }),
        createSession({
          id: 'child-1',
          file: '/tmp/child-1.jsonl',
          title: 'Child subagent conversation',
          sourceRunId: 'run-subagent-123',
        }),
      ],
      runs: createRunList([createSubagentRun()]),
    });

    expect(html.indexOf('Parent conversation')).toBeLessThan(html.indexOf('Child subagent conversation'));
    expect(html).toContain('Nested under Parent conversation');
    expect(html).toContain('padding-left:14px');
  });

  it('renders grouped open shelves for nodes and workspaces', () => {
    storage.setItem(OPEN_NOTE_IDS_STORAGE_KEY, JSON.stringify(['note-index']));
    storage.setItem(OPEN_PROJECT_IDS_STORAGE_KEY, JSON.stringify(['active-project']));
    storage.setItem(OPEN_SKILL_IDS_STORAGE_KEY, JSON.stringify(['agent-browser']));
    storage.setItem(OPEN_WORKSPACE_IDS_STORAGE_KEY, JSON.stringify(['/tmp/repo']));

    const html = renderSidebar('/inbox');

    expect(html).toContain('Open Nodes');
    expect(html).toContain('note-index');
    expect(html).toContain('Active project');
    expect(html).toContain('Agent Browser');
    expect(html).toContain('Open Workspaces');
    expect(html).toContain('repo');
  });

  it('shows a draft note row in the sidebar while creating a new note', () => {
    const html = renderSidebar('/notes?new=1');

    expect(html).toContain('Open Nodes');
    expect(html).toContain('new note');
    expect(html).toContain('Draft note');
    expect(html).toContain('href="/notes?new=1"');
  });

  it('keeps the workspace nav simple on workspace routes', () => {
    const html = renderSidebar('/workspace/changes?cwd=/tmp/repo');

    expect(html).toContain('href="/workspace/files"');
    expect(html).not.toContain('ui-sidebar-subnav-item');
    expect(html).not.toContain('Files');
    expect(html).not.toContain('Changes');
  });

  it('treats settings-related routes as part of Settings in the main sidebar', () => {
    const html = renderSidebar('/runs/conversation-live-conv-123');

    expect(html).toContain('href="/settings"');
    expect(html).toContain('ui-sidebar-nav-item-active');
    expect(html).not.toContain('>Runs<');
  });
});
