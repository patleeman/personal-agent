import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodesPage } from './NodesPage.js';
import { useApi } from '../hooks';
import { AppDataContext } from '../contexts';
import { ThemeProvider } from '../theme';
import type { NodeBrowserData } from '../types';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createNodeBrowserData(): NodeBrowserData {
  return {
    profile: 'assistant',
    tagKeys: ['area', 'profile', 'status', 'type'],
    nodes: [
      {
        kind: 'note',
        kinds: ['note'],
        id: 'memory-index',
        title: 'Memory index',
        summary: 'Top-level knowledge hub.',
        status: 'active',
        updatedAt: '2026-03-28T12:00:00.000Z',
        path: '/tmp/memory-index/INDEX.md',
        tags: ['type:note', 'status:active', 'area:knowledge'],
        profiles: [],
        searchText: 'memory index top-level knowledge hub',
        note: {
          referenceCount: 2,
        },
      },
      {
        kind: 'project',
        kinds: ['project'],
        id: 'active-project',
        title: 'Active project',
        summary: 'In progress.',
        description: 'Still being worked on.',
        status: 'active',
        createdAt: '2026-03-16T10:00:00.000Z',
        updatedAt: '2026-03-16T12:00:00.000Z',
        path: '/tmp/active-project/INDEX.md',
        tags: ['type:project', 'status:active', 'profile:assistant'],
        profiles: ['assistant'],
        searchText: 'active project in progress still being worked on',
        project: {
          profile: 'assistant',
          taskCount: 1,
          openTaskCount: 1,
          doneTaskCount: 0,
        },
      },
      {
        kind: 'skill',
        kinds: ['skill'],
        id: 'agent-browser',
        title: 'Agent Browser',
        summary: 'Automate browsers and Electron apps with agent-browser.',
        status: 'active',
        updatedAt: '2026-03-27T12:00:00.000Z',
        path: '/tmp/agent-browser/INDEX.md',
        tags: ['type:skill', 'status:active', 'profile:assistant'],
        profiles: ['assistant'],
        searchText: 'agent browser automate browsers electron apps',
        skill: {
          source: 'shared',
          recentSessionCount: 2,
          lastUsedAt: '2026-03-27T12:00:00.000Z',
          usedInLastSession: true,
        },
      },
    ],
  };
}

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

function emptyApiResult(data: unknown = null) {
  return {
    data,
    loading: false,
    refreshing: false,
    error: null,
    refetch: vi.fn(),
    replaceData: vi.fn(),
  };
}

function installUseApiMock(_path: string) {
  const nodes = createNodeBrowserData();
  vi.mocked(useApi).mockImplementation((_, key) => {
    if (key == null) {
      return emptyApiResult({
        currentProfile: 'assistant',
        profiles: ['assistant'],
      });
    }

    if (key === 'nodes-browser:assistant') {
      return emptyApiResult(nodes);
    }

    if (key === 'node-browser-views') {
      return emptyApiResult({ views: [] });
    }

    if (key === 'node-detail-options') {
      return emptyApiResult(nodes);
    }

    if (key === 'node-detail:memory-index') {
      return emptyApiResult({
        node: nodes.nodes[0],
        outgoingRelationships: [],
        incomingRelationships: [],
        suggestedNodes: [],
      });
    }

    if (key === 'node-detail:active-project') {
      return emptyApiResult({
        node: nodes.nodes[1],
        outgoingRelationships: [],
        incomingRelationships: [],
        suggestedNodes: [],
      });
    }

    if (key === 'node-detail:agent-browser') {
      return emptyApiResult({
        node: nodes.nodes[2],
        outgoingRelationships: [],
        incomingRelationships: [],
        suggestedNodes: [],
      });
    }

    if (key === 'nodes-detail:note:memory-index:assistant') {
      return emptyApiResult({
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
      });
    }

    if (key === 'nodes-detail:project:active-project:assistant') {
      return emptyApiResult({
        kind: 'project',
        detail: createProjectDetail(),
      });
    }

    if (key === 'nodes-detail:skill:agent-browser:assistant') {
      return emptyApiResult({
        kind: 'skill',
        detail: {
          skill: {
            source: 'shared',
            name: 'agent-browser',
            description: 'Automate browsers and Electron apps with agent-browser.',
            path: '/tmp/agent-browser/INDEX.md',
            recentSessionCount: 2,
            lastUsedAt: '2026-03-27T12:00:00.000Z',
            usedInLastSession: true,
          },
          content: '---\ntitle: agent-browser\n---\n\n# agent-browser\n\nAutomate browsers.',
          references: [],
          links: {
            outgoing: [],
            incoming: [],
            unresolved: [],
          },
        },
      });
    }

    return emptyApiResult();
  });
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
    installUseApiMock(path);
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
              <Route path="/pages" element={<NodesPage />} />
            </Routes>
          </MemoryRouter>
        </AppDataContext.Provider>
      </ThemeProvider>,
    );
  }

  it('renders the unified browser with one new-page entrypoint and table actions', () => {
    const html = renderPage('/pages');

    expect(html).toContain('Pages');
    expect(html).toContain('Refresh');
    expect(html).toContain('New page');
    expect(html).not.toContain('Quick capture');
    expect(html).not.toContain('Save URL');
    expect(html).not.toContain('New note');
    expect(html).not.toContain('New project');
    expect(html).not.toContain('New skill');
    expect(html).toContain('3 pages · 1 notes · 1 projects · 1 skills');
    expect(html).toContain('Lucene query');
    expect(html).toContain('aria-label="Pages view"');
    expect(html).toContain('Insert field');
    expect(html).not.toContain('Fields: type, status, profile, area, parent, tag, id, title');
    expect(html).toContain('Group by');
    expect(html).toContain('Density');
    expect(html).toContain('Save view');
    expect(html).toContain('Actions');
    expect((html.match(/<table/g) ?? []).length).toBe(1);
    expect(html).toContain('Notes');
    expect(html).toContain('Projects');
    expect(html).toContain('Skills');
    expect(html).toContain('aria-label="View note"');
    expect(html).toContain('aria-label="Edit note"');
    expect(html).toContain('aria-label="Delete note"');
    expect(html).toContain('aria-label="View project"');
    expect(html).toContain('aria-label="Edit project"');
    expect(html).toContain('aria-label="Delete project"');
    expect(html).toContain('aria-label="View skill"');
    expect(html).toContain('aria-label="Edit skill"');
    expect(html).not.toContain('aria-label="Delete skill"');
    expect(html).toContain('Memory index');
    expect(html).toContain('Active project');
    expect(html).toContain('Agent Browser');
  });

  it('renders the unified new-page creation screen', () => {
    const html = renderPage('/pages?new=1');

    expect(html).not.toContain('Lucene query');
    expect(html).toContain('New page');
    expect(html).toContain('Create page');
    expect(html).toContain('aria-label="Page type"');
    expect(html).toContain('Note title');
    expect(html).toContain('What this note is for and how the agent should use it.');
  });

  it('renders the selected note in the dedicated note workspace', () => {
    const html = renderPage('/pages?kind=note&page=memory-index');

    expect(html).not.toContain('Lucene query');
    expect(html).toContain('Memory index');
    expect(html).toContain('Top-level knowledge hub.');
    expect(html).toContain('Back to pages');
    expect(html).toContain('overview.md');
    expect(html).toContain('References');
  });

  it('renders the selected project with the dedicated project detail page', () => {
    const html = renderPage('/pages?kind=project&page=active-project');

    expect(html).not.toContain('Lucene query');
    expect(html).toContain('Active project');
    expect(html).toContain('aria-label="Back to pages"');
    expect(html).toContain('Tasks');
    expect(html).toContain('Properties');
    expect(html).toContain('Page graph');
  });

  it('renders the selected skill without the embedded knowledge browser', () => {
    const html = renderPage('/pages?kind=skill&page=agent-browser');

    expect(html).not.toContain('Lucene query');
    expect(html).toContain('Back to pages');
    expect(html).toContain('agent-browser');
    expect(html).toContain('Reload');
    expect(html).toContain('Properties');
    expect(html).toContain('Page graph');
  });
});
