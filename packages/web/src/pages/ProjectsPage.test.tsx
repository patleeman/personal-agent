import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectsPage } from './ProjectsPage.js';
import { useApi } from '../hooks';
import { useAppData } from '../contexts';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

vi.mock('../contexts', () => ({
  useAppData: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('ProjectsPage', () => {
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

  it('renders invalid project warnings from diagnostics without hiding the page', () => {
    vi.mocked(useAppData).mockReturnValue({
      activity: null,
      projects: null,
      sessions: null,
      tasks: null,
      setActivity: vi.fn(),
      setProjects: vi.fn(),
      setSessions: vi.fn(),
      setTasks: vi.fn(),
    });

    vi.mocked(useApi)
      .mockReturnValueOnce({
        data: [],
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      })
      .mockReturnValueOnce({
        data: {
          profile: 'assistant',
          invalidProjects: [
            {
              projectId: 'broken-project',
              path: '/tmp/broken-project/PROJECT.yaml',
              error: 'Project.recentProgress[0] must be a string.',
            },
          ],
        },
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      });

    const html = renderToString(
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<ProjectsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('project file could not be loaded');
    expect(html).toContain('broken-project');
    expect(html).toContain('Project.recentProgress[0] must be a string.');
    expect(html).toContain('npm run validate:projects -- --profile assistant');
  });
});
