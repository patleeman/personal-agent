import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppDataContext, SseConnectionContext } from '../contexts.js';
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

  it('renders automations without the shared settings navigation rail', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/automations/daily-report']}>
        <SseConnectionContext.Provider value={{ status: 'open' }}>
          <AppDataContext.Provider value={{
            activity: null,
            alerts: null,
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
            setActivity: vi.fn(),
            setAlerts: vi.fn(),
            setProjects: vi.fn(),
            setSessions: vi.fn(),
            setTasks: vi.fn(),
            setRuns: vi.fn(),
          }}>
            <Routes>
              <Route path="/automations">
                <Route path=":id" element={<TasksPage />} />
              </Route>
            </Routes>
          </AppDataContext.Provider>
        </SseConnectionContext.Provider>
      </MemoryRouter>,
    );

    expect(html).toContain('Automations');
    expect(html).toContain('Daily report');
    expect(html).toContain('href="/automations/daily-report"');
    expect(html).not.toContain('href="/settings"');
    expect(html).not.toContain('Stable preferences and adjacent operational pages.');
  });
});
