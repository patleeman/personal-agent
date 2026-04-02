import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApi } from '../hooks.js';
import { CompanionKnowledgePage } from './CompanionKnowledgePage.js';
import { CompanionMemoriesPage } from './CompanionMemoriesPage.js';
import { CompanionProjectsPage } from './CompanionProjectsPage.js';
import { CompanionSkillsPage } from './CompanionSkillsPage.js';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function renderWithRouter(node: React.ReactNode) {
  return renderToString(<MemoryRouter>{node}</MemoryRouter>);
}

describe('companion resource pages', () => {
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

  it('renders the companion pages browser with lucene-style query guidance and grouped results', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        profile: 'assistant',
        tagKeys: ['type', 'status', 'area'],
        nodes: [
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
            tags: ['type:project', 'status:active', 'area:architecture'],
            profiles: ['assistant'],
            searchText: 'active project in progress assistant architecture',
            project: { profile: 'assistant', openTaskCount: 3, doneTaskCount: 1 },
          },
          {
            kind: 'note',
            kinds: ['note'],
            id: 'memory-index',
            title: 'Memory index',
            summary: 'Top-level knowledge hub.',
            status: 'active',
            createdAt: '2026-03-17T10:00:00.000Z',
            updatedAt: '2026-03-17T12:00:00.000Z',
            path: '/tmp/memory-index/INDEX.md',
            tags: ['type:note', 'status:active', 'area:notes'],
            profiles: ['assistant'],
            searchText: 'memory index knowledge hub notes',
            note: { referenceCount: 2, area: 'notes' },
          },
          {
            kind: 'skill',
            kinds: ['skill'],
            id: 'agent-browser',
            title: 'Agent Browser',
            summary: 'Automate browsers and Electron apps with agent-browser.',
            status: 'active',
            createdAt: '2026-03-17T09:00:00.000Z',
            updatedAt: '2026-03-17T12:00:00.000Z',
            path: '/tmp/agent-browser/INDEX.md',
            tags: ['type:skill', 'status:active'],
            profiles: ['shared'],
            searchText: 'agent browser automate browsers electron apps',
            skill: { source: 'shared', recentSessionCount: 1, lastUsedAt: '2026-03-17T12:00:00.000Z', usedInLastSession: true },
          },
        ],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/app/pages?q=type:project%20AND%20status:active']}>
        <CompanionKnowledgePage />
      </MemoryRouter>,
    );

    expect(html).toContain('Browse all durable pages from your phone.');
    expect(html).toContain('Lucene query');
    expect(html).toContain('type:project AND status:active');
    expect(html).toContain('Projects');
    expect(html).toContain('Active project');
    expect(html).toContain('/app/projects/active-project');
    expect(html).not.toContain('/app/notes/memory-index');
    expect(html).not.toContain('/app/skills/agent-browser');
  });

  it('renders linked active and archived projects in the companion project browser', () => {
    vi.mocked(useApi).mockReturnValue({
      data: [
        {
          id: 'active-project',
          createdAt: '2026-03-16T10:00:00.000Z',
          updatedAt: '2026-03-16T12:00:00.000Z',
          title: 'Active project',
          description: 'Still being worked on.',
          summary: 'In progress.',
          requirements: { goal: 'Ship the work.', acceptanceCriteria: [] },
          status: 'in_progress',
          blockers: [],
          currentFocus: 'Keep shipping.',
          recentProgress: [],
          plan: { milestones: [], tasks: [] },
        },
        {
          id: 'archived-project',
          createdAt: '2026-03-10T10:00:00.000Z',
          updatedAt: '2026-03-12T12:00:00.000Z',
          archivedAt: '2026-03-15T08:00:00.000Z',
          title: 'Archived project',
          description: 'Finished work.',
          summary: 'Done.',
          requirements: { goal: 'Keep the record.', acceptanceCriteria: [] },
          status: 'completed',
          blockers: [],
          recentProgress: [],
          completionSummary: 'Shipped.',
          plan: { milestones: [], tasks: [] },
        },
      ],
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderWithRouter(<CompanionProjectsPage />);

    expect(html).toContain('Active');
    expect(html).toContain('Archived');
    expect(html).toContain('Active project');
    expect(html).toContain('Archived project');
    expect(html).toContain('@active-project');
    expect(html).toContain('/app/projects/active-project');
  });

  it('renders linked active and archived note nodes in the companion notes browser', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        profile: 'assistant',
        agentsMd: [],
        skills: [],
        memoryDocs: [
          {
            id: 'memory-index',
            title: 'Memory index',
            summary: 'Top-level knowledge hub.',
            tags: ['notes', 'index'],
            path: '/tmp/memory-index/INDEX.md',
            type: 'index',
            status: 'active',
            role: 'hub',
            area: 'notes',
            related: ['personal-agent'],
            referenceCount: 2,
            updated: '2026-03-17T12:00:00.000Z',
          },
          {
            id: 'old-memory',
            title: 'Old memory',
            summary: 'Deprecated but kept for reference.',
            tags: ['archive'],
            path: '/tmp/old-memory/INDEX.md',
            status: 'archived',
            referenceCount: 1,
            updated: '2026-03-15T08:00:00.000Z',
          },
        ],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderWithRouter(<CompanionMemoriesPage />);

    expect(html).toContain('Memory index');
    expect(html).toContain('Old memory');
    expect(html).not.toContain('2 references');
    expect(html).toContain('@memory-index');
    expect(html).toContain('Archived');
    expect(html).toContain('/app/notes/memory-index');
  });

  it('renders linked humanized skills with recent-usage labels in the companion skill browser', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        profile: 'assistant',
        agentsMd: [],
        memoryDocs: [],
        skills: [
          {
            name: 'agent-browser',
            description: 'Automate browsers and Electron apps with agent-browser.',
            source: 'shared',
            path: '/tmp/agent-browser/INDEX.md',
            recentSessionCount: 1,
            lastUsedAt: '2026-03-17T12:00:00.000Z',
            usedInLastSession: true,
          },
        ],
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderWithRouter(<CompanionSkillsPage />);

    expect(html).toContain('Agent Browser');
    expect(html).toContain('Triggered in last session');
    expect(html).toContain('shared');
    expect(html).toContain('/app/skills/agent-browser');
  });
});
