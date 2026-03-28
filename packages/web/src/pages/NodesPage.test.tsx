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

function createProjectDetail() {
  return {
    profile: 'assistant',
    project: {
      id: 'active-project',
      createdAt: '2026-03-16T10:00:00.000Z',
      updatedAt: '2026-03-16T12:00:00.000Z',
      title: 'Active project',
      description: 'Still being worked on.',
      repoRoot: '/Users/patrick/workingdir/personal-agent',
      summary: 'In progress.',
      requirements: {
        goal: 'Ship the work.',
        acceptanceCriteria: [],
      },
      status: 'active',
      blockers: [],
      currentFocus: 'Tighten the project workspace.',
      recentProgress: [],
      plan: {
        milestones: [],
        tasks: [],
      },
    },
    taskCount: 1,
    noteCount: 0,
    fileCount: 0,
    attachmentCount: 0,
    artifactCount: 0,
    tasks: [
      {
        id: 'ship-work',
        status: 'doing',
        title: 'Ship the work',
      },
    ],
    document: {
      path: '/tmp/active-project/INDEX.md',
      updatedAt: '2026-03-16T11:30:00.000Z',
      content: '# Active project\n\nStill being worked on.',
    },
    notes: [],
    files: [],
    attachments: [],
    artifacts: [],
    linkedConversations: [],
    links: {
      outgoing: [],
      incoming: [],
      unresolved: [],
    },
    timeline: [],
  };
}

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

    expect(html).toContain('Knowledge Base');
    expect(html).toContain('Refresh');
    expect(html).not.toContain('Select a node');
    expect(html).toContain('3 nodes · 1 notes · 1 projects · 1 skills');
    expect(html).toContain('Notes');
    expect(html).toContain('Projects');
    expect(html).toContain('Skills');
    expect(html).toContain('Recently updated');
    expect(html).toMatch(/3.*visible/);
    expect(html).toContain('Search knowledge');
    expect(html).toContain('Memory index');
    expect(html).toContain('Active project');
    expect(html).toContain('Agent Browser');
  });

  it('renders the selected note in the dedicated note workspace', () => {
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

    expect(html).not.toContain('Refresh knowledge base');
    expect(html).toContain('Memory index');
    expect(html).toContain('Top-level knowledge hub.');
    expect(html).toContain('Use this note as the top-level routing document for durable memory.');
    expect(html).toContain('Back to table');
    expect(html).toContain('aria-label="Reload note"');
    expect(html).toContain('aria-label="Save note now"');
    expect(html).toContain('aria-label="Chat about note"');
    expect(html).toContain('aria-label="Delete note"');
    expect(html).toContain('Properties');
    expect(html).toContain('References');
    expect(html).toContain('Relationships');
    expect(html).toContain('overview.md');
    expect(html).not.toContain('Open dedicated page');
  });

  it('renders the selected project with the dedicated project detail page', () => {
    vi.mocked(useApi).mockImplementation((_, key) => {
      if (key === 'nodes-memory') {
        return {
          data: {
            profile: 'assistant',
            agentsMd: [],
            skills: [],
            memoryDocs: [],
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
          data: [createProjectDetail().project],
          loading: false,
          refreshing: false,
          error: null,
          refetch: vi.fn(),
        };
      }

      if (key === 'nodes-detail:project:active-project:assistant') {
        return {
          data: {
            kind: 'project',
            detail: createProjectDetail(),
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

    const html = renderPage('/nodes?kind=project&node=active-project');

    expect(html).not.toContain('Refresh knowledge base');
    expect(html).toContain('Active project');
    expect(html).toContain('aria-label="Back to table"');
    expect(html).not.toContain('>Back to table<');
    expect(html).not.toContain('>Document<');
    expect(html).toContain('Tasks');
    expect(html).toContain('Properties');
    expect(html).not.toContain('Open dedicated page');
  });

  it('renders the selected skill without the embedded knowledge browser', () => {
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
            memoryDocs: [],
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

      if (key === 'nodes-detail:skill:tool-agent-browser:assistant') {
        return {
          data: {
            kind: 'skill',
            detail: {
              skill: {
                source: 'shared',
                name: 'tool-agent-browser',
                description: 'Automate browsers and Electron apps with agent-browser.',
                path: '/tmp/tool-agent-browser/INDEX.md',
                recentSessionCount: 2,
                lastUsedAt: '2026-03-27T12:00:00.000Z',
                usedInLastSession: true,
              },
              content: '---\ntitle: Agent Browser\n---\n\n# Agent Browser\n\nAutomate browsers.',
              references: [],
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

    const html = renderPage('/nodes?kind=skill&node=tool-agent-browser');

    expect(html).not.toContain('Refresh knowledge base');
    expect(html).toContain('Back to table');
    expect(html).toContain('Agent Browser');
    expect(html).toContain('Reload');
    expect(html).toContain('Save');
    expect(html).toContain('Definition');
    expect(html).toContain('Properties');
    expect(html).not.toContain('Open dedicated page');
  });
});
