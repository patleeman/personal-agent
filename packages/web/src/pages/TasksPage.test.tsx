import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, SseConnectionContext } from '../app/contexts.js';
import { TasksPage } from './TasksPage.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('TasksPage', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  const originalConsoleError = console.error;

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation((message?: unknown, ...args: unknown[]) => {
      if (typeof message === 'string' && message.includes('useLayoutEffect does nothing on the server')) {
        return;
      }

      originalConsoleError(message, ...args);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.clearAllMocks();
  });

  it('renders the automation overview without the shared settings navigation rail', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            projects: null,
            sessions: null,
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
    expect(html).toContain('Scheduled prompts, run history, and thread ownership in one place.');
    expect(html).toContain('On this page');
    expect(html).toContain('Daily report');
    expect(html).toContain('href="/automations/daily-report"');
    expect(html).not.toContain('Current');
    expect(html).not.toContain('href="/settings"');
    expect(html).not.toContain('Stable preferences and adjacent operational pages.');
  });

  it('renders a leaner empty state copy', () => {
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

    expect(html).toContain('Scheduled prompts, run history, and thread ownership in one place.');
    expect(html).toContain('No automations yet.');
    expect(html).toContain('Use New automation to create one.');
    expect(html).toContain('On this page');
    expect(html).not.toContain('Create the first scheduled workflow.');
    expect(html).not.toContain('Start with a title, a prompt, a working directory, and a schedule.');
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

    expect(html).toContain('This automation owns its run history.');
    expect(html).toContain('task-daily-report-2026-03-18');
    expect(html).toContain('Hide run details');
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
    expect(html).toContain('Select project');
    expect(html).toContain('Worktree');
    expect(html).toContain('No automations yet.');
  });

  it('uses existing conversation workspaces as project options in the create form', () => {
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

    expect(html).toContain('>alpha-worktree<');
    expect(html).toContain('>beta-worktree<');
  });
});
