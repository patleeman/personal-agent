import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, LiveTitlesContext, SseConnectionContext } from '../contexts.js';
import { OPEN_SESSION_IDS_STORAGE_KEY, PINNED_SESSION_IDS_STORAGE_KEY } from '../localSettings.js';
import type { DurableRunListResult, ScheduledTaskSummary, SessionMeta } from '../types.js';
import { Sidebar } from './Sidebar.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

class MemoryStorage {
  private readonly store = new Map<string, string>();

  get length() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }

  getItem(key: string) {
    return this.store.get(key) ?? null;
  }

  key(index: number) {
    return [...this.store.keys()][index] ?? null;
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
    cwdSlug: 'Users-patrickc.lee-personal-personal-agent',
    model: 'openai/gpt-5.4',
    title: 'Clarify background run link',
    messageCount: 4,
    isRunning: false,
    deferredResumes: [{
      id: 'resume-1',
      sessionFile: '/tmp/conv-123.jsonl',
      prompt: 'Continue the investigation.',
      dueAt: '2026-03-16T10:01:00.000Z',
      createdAt: '2026-03-16T10:00:00.000Z',
      attempts: 0,
      status: 'scheduled',
    }],
    ...overrides,
  };
}

function createTask(overrides: Partial<ScheduledTaskSummary> = {}): ScheduledTaskSummary {
  return {
    id: 'daily-report',
    filePath: '/tmp/daily-report.task.md',
    scheduleType: 'cron',
    running: false,
    enabled: true,
    cron: '0 9 * * *',
    prompt: 'Summarize yesterday and today.',
    ...overrides,
  };
}

function createRunsResult(): DurableRunListResult {
  return {
    scannedAt: '2026-03-16T10:00:00.000Z',
    runsRoot: '/tmp/runs',
    summary: {
      total: 1,
      recoveryActions: {},
      statuses: { running: 1 },
    },
    runs: [{
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
        createdAt: '2026-03-16T09:59:00.000Z',
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
        createdAt: '2026-03-16T09:59:00.000Z',
        updatedAt: '2026-03-16T10:00:00.000Z',
        activeAttempt: 1,
        startedAt: '2026-03-16T09:59:10.000Z',
      },
      checkpoint: {
        version: 1,
        runId: 'run-subagent-123',
        updatedAt: '2026-03-16T10:00:00.000Z',
        payload: {},
      },
      problems: [],
      recoveryAction: 'none',
    }],
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

  it('shows deferred resume timing for conversations with a pending resume', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/inbox']}>
        <SseConnectionContext.Provider value={{ status: 'offline' }}>
          <AppDataContext.Provider value={{
            activity: { entries: [], unreadCount: 0 },
            projects: null,
            sessions: [createSession()],
            tasks: null,
            runs: null,
            setActivity: () => {},
            setProjects: () => {},
            setSessions: () => {},
            setTasks: () => {},
            setRuns: () => {},
          }}>
            <LiveTitlesContext.Provider value={{ titles: new Map(), setTitle: () => {} }}>
              <Sidebar />
            </LiveTitlesContext.Provider>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Deferred ');
    expect(html).toContain('1 scheduled · next in 58s');
  });

  it('shows the active run badge on the system nav item', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/inbox']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            activity: { entries: [], unreadCount: 0 },
            projects: null,
            sessions: [createSession({ isRunning: true })],
            tasks: [createTask({ running: true })],
            runs: createRunsResult(),
            setActivity: () => {},
            setProjects: () => {},
            setSessions: () => {},
            setTasks: () => {},
            setRuns: () => {},
          }}>
            <LiveTitlesContext.Provider value={{ titles: new Map(), setTitle: () => {} }}>
              <Sidebar />
            </LiveTitlesContext.Provider>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('System</span><span class="ui-sidebar-nav-badge">3</span>');
    expect(html).toContain('3 active now · 1 conversation · 1 scheduled · 1 background.');
  });

  it('renders the new primary navigation above the conversation workspace', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/inbox']}>
        <SseConnectionContext.Provider value={{ status: 'offline' }}>
          <AppDataContext.Provider value={{
            activity: { entries: [], unreadCount: 0 },
            projects: null,
            sessions: [createSession()],
            tasks: null,
            runs: null,
            setActivity: () => {},
            setProjects: () => {},
            setSessions: () => {},
            setTasks: () => {},
            setRuns: () => {},
          }}>
            <LiveTitlesContext.Provider value={{ titles: new Map(), setTitle: () => {} }}>
              <Sidebar />
            </LiveTitlesContext.Provider>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html.indexOf('Inbox')).toBeLessThan(html.indexOf('Conversations'));
    expect(html.indexOf('Conversations')).toBeLessThan(html.indexOf('Workspace'));
    expect(html.indexOf('Workspace')).toBeLessThan(html.indexOf('Knowledge Base'));
    expect(html.indexOf('Knowledge Base')).toBeLessThan(html.indexOf('Capabilities'));
    expect(html.indexOf('Capabilities')).toBeLessThan(html.indexOf('New chat'));
    expect(html.indexOf('New chat')).toBeLessThan(html.indexOf('Pinned'));
    expect(html.indexOf('Pinned')).toBeLessThan(html.indexOf('Open conversations'));
    expect(html.indexOf('Open conversations')).toBeLessThan(html.indexOf('System'));
    expect(html.indexOf('System')).toBeLessThan(html.indexOf('Settings'));
  });

  it('nests child conversations under their parent conversation when run lineage is available', () => {
    storage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(['conv-123', 'child-1']));

    const html = renderToString(
      <MemoryRouter initialEntries={['/inbox']}>
        <SseConnectionContext.Provider value={{ status: 'offline' }}>
          <AppDataContext.Provider value={{
            activity: { entries: [], unreadCount: 0 },
            projects: null,
            sessions: [
              createSession({ id: 'conv-123', title: 'Parent conversation', file: '/tmp/conv-123.jsonl', deferredResumes: [] }),
              createSession({ id: 'child-1', title: 'Child conversation', file: '/tmp/child-1.jsonl', deferredResumes: [], sourceRunId: 'run-subagent-123' }),
            ],
            tasks: null,
            runs: createRunsResult(),
            setActivity: () => {},
            setProjects: () => {},
            setSessions: () => {},
            setTasks: () => {},
            setRuns: () => {},
          }}>
            <LiveTitlesContext.Provider value={{ titles: new Map(), setTitle: () => {} }}>
              <Sidebar />
            </LiveTitlesContext.Provider>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Parent conversation');
    expect(html).toContain('↳ Child conversation');
    expect(html).toContain('Nested under Parent conversation');
    expect(html.indexOf('Parent conversation')).toBeLessThan(html.indexOf('↳ Child conversation'));
  });
});
