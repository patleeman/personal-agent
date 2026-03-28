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

  function mockCommonAppData() {
    vi.mocked(useAppData).mockReturnValue({
      activity: null,
      alerts: null,
      projects: null,
      sessions: null,
      tasks: null,
      runs: null,
      setActivity: vi.fn(),
      setAlerts: vi.fn(),
      setProjects: vi.fn(),
      setSessions: vi.fn(),
      setTasks: vi.fn(),
      setRuns: vi.fn(),
    });
  }

  it('renders invalid project warnings above the large project table', () => {
    mockCommonAppData();

    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key === 'projects:assistant') {
        return {
          data: [],
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (key === 'project-diagnostics:assistant') {
        return {
          data: {
            profile: 'assistant',
            invalidProjects: [
              {
                projectId: 'broken-project',
                path: '/tmp/broken-project/state.yaml',
                error: 'Project.recentProgress[0] must be a string.',
              },
            ],
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: {
          currentProfile: 'assistant',
          profiles: ['assistant', 'datadog'],
        },
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      };
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
    expect(html).toContain('Browse durable projects, then open one into the main workspace and the left sidebar shelf.');
  });

  it('renders the full-page new-project form from URL state', () => {
    mockCommonAppData();

    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key === 'projects:assistant') {
        return {
          data: [],
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (key === 'project-diagnostics:assistant') {
        return {
          data: {
            profile: 'assistant',
            invalidProjects: [],
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: {
          currentProfile: 'assistant',
          profiles: ['assistant'],
        },
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/projects?viewProfile=assistant&new=1']}>
        <Routes>
          <Route path="/projects" element={<ProjectsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('New project');
    expect(html).toContain('Create a durable project with a title, summary, repo root, and an optional starting document.');
    expect(html).toContain('Create project');
    expect(html).toContain('Back to projects');
  });

  it('replaces the list page with the selected project detail view', () => {
    mockCommonAppData();

    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key === 'project-workspace:active-project:assistant') {
        return {
          data: {
            profile: 'assistant',
            project: {
              id: 'active-project',
              title: 'Active project',
              description: 'Still being worked on.',
              summary: 'In progress.',
              repoRoot: '/tmp/project',
              createdAt: '2026-03-16T10:00:00.000Z',
              updatedAt: '2026-03-16T12:00:00.000Z',
              status: 'active',
              currentFocus: 'Ship the work.',
              blockers: [],
              recentProgress: [],
              requirements: { goal: 'Ship the work.', acceptanceCriteria: [] },
              plan: { milestones: [], tasks: [] },
            },
            document: null,
            tasks: [],
            notes: [],
            files: [],
            attachments: [],
            artifacts: [],
            links: { outgoing: [], incoming: [], unresolved: [] },
            linkedConversations: [],
            timeline: [],
            noteCount: 0,
            taskCount: 0,
            fileCount: 0,
            attachmentCount: 0,
            artifactCount: 0,
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (key === 'project-diagnostics:assistant') {
        return {
          data: {
            profile: 'assistant',
            invalidProjects: [],
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (key === 'projects:assistant') {
        return {
          data: [
            {
              id: 'active-project',
              createdAt: '2026-03-16T10:00:00.000Z',
              updatedAt: '2026-03-16T12:00:00.000Z',
              title: 'Active project',
              description: 'Still being worked on.',
              summary: 'In progress.',
              requirements: { goal: 'Ship the work.', acceptanceCriteria: [] },
              status: 'active',
              blockers: [],
              recentProgress: [],
              currentFocus: 'Ship the work.',
              plan: { milestones: [], tasks: [] },
              profile: 'assistant',
            },
          ],
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: {
          currentProfile: 'assistant',
          profiles: ['assistant'],
        },
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/projects/active-project?viewProfile=assistant']}>
        <Routes>
          <Route path="/projects/:id" element={<ProjectsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Active project');
    expect(html).toContain('Start conversation');
    expect(html).toContain('Activity');
    expect(html).not.toContain('Search projects');
    expect(html).not.toContain('Browse durable projects, then open one into the main workspace and the left sidebar shelf.');
  });
});
