import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodesPage } from './NodesPage.js';
import { useApi } from '../hooks';
import { AppDataContext } from '../contexts';
import { ThemeProvider } from '../theme';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('NodesPage', () => {
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

  function renderPage(path: string) {
    return renderToString(
      <ThemeProvider>
        <AppDataContext.Provider value={{
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
        }}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/nodes" element={<NodesPage />} />
            </Routes>
          </MemoryRouter>
        </AppDataContext.Provider>
      </ThemeProvider>,
    );
  }

  it('renders a unified browser with notes, projects, and skills together', () => {
    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key === 'nodes-memory') {
        return {
          data: {
            profile: 'assistant',
            agentsMd: [],
            skills: [{
              source: 'shared',
              name: 'tool-agent-browser',
              description: 'Automate browsers and Electron apps with agent-browser.',
              path: '/tmp/tool-agent-browser/INDEX.md',
              recentSessionCount: 2,
              lastUsedAt: '2026-03-27T12:00:00.000Z',
              usedInLastSession: true,
            }],
            memoryDocs: [{
              id: 'memory-index',
              title: 'Memory index',
              summary: 'Top-level knowledge hub.',
              path: '/tmp/memory-index/INDEX.md',
              updated: '2026-03-28T12:00:00.000Z',
              referenceCount: 2,
            }],
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (key == null) {
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
      }

      if (key === 'nodes-projects:assistant') {
        return {
          data: [{
            id: 'active-project',
            title: 'Active project',
            summary: 'In progress.',
            description: 'Still being worked on.',
            createdAt: '2026-03-16T10:00:00.000Z',
            updatedAt: '2026-03-16T12:00:00.000Z',
            requirements: { goal: 'Ship the work.', acceptanceCriteria: [] },
            status: 'active',
            blockers: [],
            recentProgress: [],
            plan: { milestones: [], tasks: [] },
            profile: 'assistant',
          }],
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: null,
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    const html = renderPage('/nodes');

    expect(html).toContain('Browse nodes');
    expect(html).toContain('Notes, projects, and skills in one place');
    expect(html).toContain('All (3)');
    expect(html).toContain('Notes (1)');
    expect(html).toContain('Projects (1)');
    expect(html).toContain('Skills (1)');
    expect(html).toContain('Memory index');
    expect(html).toContain('Active project');
    expect(html).toContain('Agent Browser');
    expect(html).toContain('Select a node');
  });

  it('renders the selected note in the shared inspector', () => {
    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key === 'nodes-memory') {
        return {
          data: {
            profile: 'assistant',
            agentsMd: [],
            skills: [],
            memoryDocs: [{
              id: 'memory-index',
              title: 'Memory index',
              summary: 'Top-level knowledge hub.',
              description: 'Use this note as the top-level routing document for durable memory.',
              path: '/tmp/memory-index/INDEX.md',
              updated: '2026-03-28T12:00:00.000Z',
              referenceCount: 2,
            }],
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (key == null) {
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
      }

      if (key === 'nodes-projects:assistant') {
        return {
          data: [],
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (key === 'nodes-detail:note:memory-index:assistant') {
        return {
          data: {
            kind: 'note',
            detail: {
              memory: {
                id: 'memory-index',
                title: 'Memory index',
                summary: 'Top-level knowledge hub.',
                description: 'Use this note as the top-level routing document for durable memory.',
                path: '/tmp/memory-index/INDEX.md',
                updated: '2026-03-28T12:00:00.000Z',
                referenceCount: 2,
              },
              content: '# Memory index\n\nTop-level knowledge hub.',
              references: [{
                title: 'Overview',
                summary: 'More context.',
                relativePath: 'references/overview.md',
                path: '/tmp/memory-index/references/overview.md',
              }],
              links: {
                outgoing: [],
                incoming: [],
                unresolved: [],
              },
            },
          },
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      return {
        data: null,
        loading: false,
        refreshing: false,
        error: null,
        refetch: vi.fn(),
      };
    });

    const html = renderPage('/nodes?kind=note&node=memory-index');

    expect(html).toContain('Memory index');
    expect(html).toContain('Top-level knowledge hub.');
    expect(html).toContain('For the agent');
    expect(html).toContain('Use this note as the top-level routing document for durable memory.');
    expect(html).toContain('Open dedicated page');
    expect(html).toContain('References');
    expect(html).toContain('overview.md');
  });
});
