import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, SseConnectionContext } from '../app/contexts.js';
import { sortAutomationRows, TasksPage } from './TasksPage.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
  } satisfies Storage;
}

describe('TasksPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    vi.stubGlobal('localStorage', createStorage());
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders a clean current automation list on the overview page', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            projects: null,
            sessions: [{
              id: 'automation.daily-report',
              file: '/tmp/automation.daily-report.jsonl',
              timestamp: '2026-03-18T00:00:00.000Z',
              lastActivityAt: '2026-03-18T00:05:00.000Z',
              cwd: '/repo/project',
              cwdSlug: 'repo-project',
              model: 'openai/gpt-5.4',
              title: 'Automation: Daily report',
              messageCount: 12,
              automationTaskId: 'daily-report',
              automationTitle: 'Daily report',
            }],
            runs: null,
            tasks: [{
              id: 'daily-report',
              title: 'Daily report',
              scheduleType: 'cron',
              running: false,
              enabled: true,
              cron: '0 9 * * 1-5',
              prompt: 'Send the daily report.',
              model: 'openai/gpt-5.4',
              cwd: '/repo/project',
              threadConversationId: 'automation.daily-report',
              threadTitle: 'Automation: Daily report',
              lastStatus: 'success',
              lastRunAt: '2026-03-18T00:00:00.000Z',
            }],
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/automations" element={<TasksPage />} />
            </Routes>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Automations');
    expect(html).toContain('Current');
    expect(html).toContain('Daily report');
    expect(html).toContain('href="/automations/daily-report"');
    expect(html).toContain('Weekdays at 09:00');
    expect(html).not.toContain('href="/conversations/automation.daily-report"');
    expect(html).not.toContain('Jobs');
    expect(html).not.toContain('Threads');
    expect(html).not.toContain('Automation jobs');
    expect(html).not.toContain('Automation threads');
    expect(html).not.toContain('On this page');
    expect(html).not.toContain('href="/settings"');
    expect(html).not.toContain('Stable preferences and adjacent operational pages.');
  });

  it('does not render a separate thread row for thread-backed automations', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            projects: null,
            sessions: [{
              id: 'automation.daily-report',
              file: '/tmp/automation.daily-report.jsonl',
              timestamp: '2026-03-18T00:00:00.000Z',
              lastActivityAt: '2026-03-18T00:05:00.000Z',
              cwd: '/repo/project',
              cwdSlug: 'repo-project',
              model: 'openai/gpt-5.4',
              title: 'Automation: Daily report',
              messageCount: 12,
              automationTaskId: 'daily-report',
              automationTitle: 'Daily report',
            }],
            runs: null,
            tasks: [{
              id: 'daily-report',
              title: 'Daily report',
              scheduleType: 'cron',
              running: false,
              enabled: true,
              cron: '0 9 * * 1-5',
              prompt: 'Send the daily report.',
              model: 'openai/gpt-5.4',
              cwd: '/repo/project',
              threadConversationId: 'automation.daily-report',
              threadTitle: 'Automation: Daily report',
              lastStatus: 'success',
              lastRunAt: '2026-03-18T00:00:00.000Z',
            }],
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/automations" element={<TasksPage />} />
            </Routes>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Daily report');
    expect(html).not.toContain('Automation: Daily report');
    expect(html).not.toContain('href="/conversations/automation.daily-report"');
  });

  it('renders a lean empty state', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            projects: null,
            sessions: null,
            runs: null,
            tasks: [],
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/automations" element={<TasksPage />} />
            </Routes>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Current');
    expect(html).toContain('No automations yet.');
    expect(html).not.toContain('Jobs');
    expect(html).not.toContain('Threads');
    expect(html).not.toContain('No automation jobs yet.');
    expect(html).toContain('+ New automation');
    expect(html).not.toContain('Create one to start recurring work.');
    expect(html).not.toContain('Automation jobs');
    expect(html).not.toContain('Automation threads');
    expect(html).not.toContain('On this page');
    expect(html).not.toContain('Create the first scheduled workflow.');
    expect(html).not.toContain('Start with a title, a prompt, a working directory, and a schedule.');
  });

  it('marks failed automations as needing attention', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            projects: null,
            sessions: [],
            runs: null,
            tasks: [{
              id: 'broken-report',
              title: 'Broken report',
              scheduleType: 'cron',
              running: false,
              enabled: true,
              cron: '0 9 * * *',
              prompt: 'Send the report.',
              lastStatus: 'failed',
              lastRunAt: '2026-03-18T00:00:00.000Z',
            }],
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/automations" element={<TasksPage />} />
            </Routes>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('1 enabled · 1 need review');
    expect(html).toContain('Needs attention');
    expect(html).not.toContain('Active');
  });

  it('shows recent runs on the automation detail page', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations/daily-report?run=task-daily-report-2026-03-18']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            projects: null,
            sessions: [],
            runs: {
              scannedAt: '2026-03-18T00:05:00.000Z',
              runsRoot: '/tmp/runs',
              summary: { total: 1, recoveryActions: {}, statuses: { completed: 1 } },
              runs: [{
                runId: 'task-daily-report-2026-03-18',
                paths: {
                  root: '/tmp/runs/task-daily-report-2026-03-18',
                  manifestPath: '/tmp/runs/task-daily-report-2026-03-18/manifest.json',
                  statusPath: '/tmp/runs/task-daily-report-2026-03-18/status.json',
                  checkpointPath: '/tmp/runs/task-daily-report-2026-03-18/checkpoint.json',
                  eventsPath: '/tmp/runs/task-daily-report-2026-03-18/events.jsonl',
                  outputLogPath: '/tmp/runs/task-daily-report-2026-03-18/output.log',
                  resultPath: '/tmp/runs/task-daily-report-2026-03-18/result.json',
                },
                manifest: {
                  version: 1,
                  id: 'task-daily-report-2026-03-18',
                  kind: 'scheduled-task',
                  resumePolicy: 'rerun',
                  createdAt: '2026-03-18T00:00:00.000Z',
                  spec: { taskId: 'daily-report' },
                  source: { type: 'scheduled-task', id: 'daily-report' },
                },
                status: {
                  version: 1,
                  runId: 'task-daily-report-2026-03-18',
                  status: 'completed',
                  createdAt: '2026-03-18T00:00:00.000Z',
                  updatedAt: '2026-03-18T00:05:00.000Z',
                  activeAttempt: 1,
                  startedAt: '2026-03-18T00:00:00.000Z',
                  completedAt: '2026-03-18T00:05:00.000Z',
                },
                checkpoint: {
                  version: 1,
                  runId: 'task-daily-report-2026-03-18',
                  updatedAt: '2026-03-18T00:05:00.000Z',
                  step: 'completed',
                  payload: { taskId: 'daily-report' },
                },
                problems: [],
                recoveryAction: 'none',
              }],
            },
            tasks: [{
              id: 'daily-report',
              title: 'Daily report',
              scheduleType: 'cron',
              running: false,
              enabled: true,
              cron: '0 9 * * 1-5',
              prompt: 'Send the daily report.',
              model: 'openai/gpt-5.4',
              lastStatus: 'success',
              lastRunAt: '2026-03-18T00:05:00.000Z',
            }],
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/automations/:id" element={<TasksPage />} />
            </Routes>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Runs');
    expect(html).toContain('task-daily-report-2026-03-18');
    expect(html).not.toContain('Hide run details');
  });

  it('does not repeat the prompt summary above the full prompt body on the detail page', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations/morning-briefing']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            projects: null,
            sessions: [],
            runs: null,
            tasks: [{
              id: 'morning-briefing',
              title: 'Morning Briefing',
              scheduleType: 'cron',
              running: false,
              enabled: true,
              cron: '0 8 * * 1-5',
              prompt: 'Check calendar for important meetings.\n\nSummarize important email.',
              model: 'openai/gpt-5.4',
              lastStatus: 'success',
            }],
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/automations/:id" element={<TasksPage />} />
            </Routes>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Morning Briefing');
    expect(html).toContain('Prompt');
    expect(html).toContain('Check calendar for important meetings.');
    expect(html).toContain('Summarize important email.');
    expect(html).not.toContain('Check calendar for important meetings. Summarize important email.');
  });

  it('renders the create automation form in a modal when requested', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations?new=1']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            projects: null,
            sessions: null,
            runs: null,
            tasks: [],
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/automations" element={<TasksPage />} />
            </Routes>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('aria-label="Create automation"');
    expect(html).toContain('Automation title');
    expect(html).toContain('Worktree');
    expect(html).toContain('Chat');
    expect(html).toContain('No automations yet.');
  });

  it('keeps project options hidden until worktree mode is enabled', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations?new=1']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            projects: null,
            sessions: [{
              id: 'conv-1',
              file: '/tmp/conv-1.jsonl',
              timestamp: '2026-03-18T00:00:00.000Z',
              cwd: '/tmp/alpha-worktree',
              cwdSlug: 'alpha-worktree',
              model: 'openai/gpt-5.4',
              title: 'Alpha thread',
              messageCount: 12,
            }, {
              id: 'conv-2',
              file: '/tmp/conv-2.jsonl',
              timestamp: '2026-03-18T01:00:00.000Z',
              cwd: '/tmp/beta-worktree',
              cwdSlug: 'beta-worktree',
              model: 'openai/gpt-5.4',
              title: 'Beta thread',
              messageCount: 3,
            }],
            runs: null,
            tasks: [],
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/automations" element={<TasksPage />} />
            </Routes>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Worktree');
    expect(html).toContain('Chat');
    expect(html).not.toContain('>alpha-worktree<');
    expect(html).not.toContain('>beta-worktree<');
  });
});

describe('sortAutomationRows', () => {
  it('sorts malformed last run timestamps after valid timestamps', () => {
    expect(sortAutomationRows([
      {
        id: 'bad-time',
        title: 'Bad time',
        scheduleType: 'cron',
        running: false,
        enabled: true,
        cron: '0 9 * * *',
        prompt: 'bad',
        lastRunAt: 'not-a-date',
      },
      {
        id: 'good-time',
        title: 'Good time',
        scheduleType: 'cron',
        running: false,
        enabled: true,
        cron: '0 9 * * *',
        prompt: 'good',
        lastRunAt: '2026-03-18T00:00:00.000Z',
      },
    ]).map((task) => task.id)).toEqual(['good-time', 'bad-time']);
  });

  it('sorts non-ISO last run timestamps after valid timestamps', () => {
    expect(sortAutomationRows([
      {
        id: 'bad-time',
        title: 'Bad time',
        scheduleType: 'cron',
        running: false,
        enabled: true,
        cron: '0 9 * * *',
        prompt: 'bad',
        lastRunAt: '9999',
      },
      {
        id: 'good-time',
        title: 'Good time',
        scheduleType: 'cron',
        running: false,
        enabled: true,
        cron: '0 9 * * *',
        prompt: 'good',
        lastRunAt: '2026-03-18T00:00:00.000Z',
      },
    ]).map((task) => task.id)).toEqual(['good-time', 'bad-time']);
  });
});
