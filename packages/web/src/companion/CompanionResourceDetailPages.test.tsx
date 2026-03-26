import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useApi } from '../hooks.js';
import { CompanionMemoryDetailPage } from './CompanionMemoryDetailPage.js';
import { CompanionProjectDetailPage } from './CompanionProjectDetailPage.js';
import { CompanionSkillDetailPage } from './CompanionSkillDetailPage.js';

vi.mock('../hooks', () => ({
  useApi: vi.fn(),
}));

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

describe('companion resource detail pages', () => {
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

  it('renders project detail with linked companion conversations', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        profile: 'assistant',
        project: {
          id: 'continuous-conversations',
          createdAt: '2026-03-16T10:00:00.000Z',
          updatedAt: '2026-03-25T00:00:00.000Z',
          title: 'Continuous conversations',
          description: 'Cross-surface companion app work.',
          summary: 'Ship the companion app.',
          requirements: {
            goal: 'Make the companion app useful on the phone.',
            acceptanceCriteria: ['Archived conversations visible', 'Todo management on mobile'],
          },
          status: 'in_progress',
          blockers: ['Validate the last mile on mobile.'],
          currentFocus: 'Finish the companion detail views.',
          recentProgress: [],
          plan: {
            currentMilestoneId: 'mobile',
            milestones: [{ id: 'mobile', title: 'Mobile PWA', status: 'in_progress', summary: 'Ship companion app polish.' }],
            tasks: [{ id: 'todo', title: 'Manage conversation todos', status: 'in_progress' }],
          },
        },
        taskCount: 1,
        noteCount: 1,
        attachmentCount: 0,
        artifactCount: 0,
        tasks: [{ id: 'todo', title: 'Manage conversation todos', status: 'in_progress' }],
        brief: { content: '## Brief\n\nShip the phone companion.', updatedAt: '2026-03-25T00:00:00.000Z' },
        notes: [{ id: 'note-1', title: 'Next step', kind: 'note', body: 'Validate on mobile.', updatedAt: '2026-03-25T00:00:00.000Z' }],
        attachments: [],
        artifacts: [],
        linkedConversations: [{
          conversationId: 'conv-123',
          title: 'Companion todo session',
          isRunning: false,
          needsAttention: true,
          snippet: 'Todo management now works on the phone.',
          lastActivityAt: '2026-03-25T00:00:00.000Z',
        }],
        timeline: [],
        links: {
          outgoing: [{ kind: 'skill', id: 'tool-agent-browser', title: 'Tool Agent Browser', summary: 'Browser automation.' }],
          incoming: [{ kind: 'note', id: 'companion-roadmap', title: 'Companion roadmap', summary: 'Related planning note.' }],
          unresolved: ['missing-node'],
        },
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/app/projects/continuous-conversations']}>
        <Routes>
          <Route path="/app/projects/:id" element={<CompanionProjectDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Continuous conversations');
    expect(html).toContain('Definition of done');
    expect(html).toContain('Validate the last mile on mobile.');
    expect(html).toContain('Companion todo session');
    expect(html).toContain('/app/conversations/conv-123');
    expect(html).toContain('Linked from');
    expect(html).toContain('/app/notes/companion-roadmap');
    expect(html).toContain('@missing-node');
  });

  it('renders memory detail with markdown content and references', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        memory: {
          id: 'memory-index',
          title: 'Memory index',
          summary: 'Top-level knowledge hub.',
          tags: ['notes', 'index'],
          path: '/tmp/memory-index/INDEX.md',
          type: 'index',
          status: 'active',
          role: 'hub',
          area: 'notes',
          referenceCount: 1,
          updated: '2026-03-25T00:00:00.000Z',
        },
        content: '# Memory index\n\n## Role\n- Keep the overview current.',
        references: [{
          title: 'Reference doc',
          summary: 'Supporting material.',
          tags: ['reference'],
          path: '/tmp/memory-index/references/doc.md',
          relativePath: 'references/doc.md',
          updated: '2026-03-24T00:00:00.000Z',
        }],
        links: {
          outgoing: [{ kind: 'project', id: 'continuous-conversations', title: 'Continuous conversations', summary: 'Project node.' }],
          incoming: [{ kind: 'note', id: 'notes-overview', title: 'Notes overview', summary: 'Structure note.' }],
          unresolved: [],
        },
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/app/notes/memory-index']}>
        <Routes>
          <Route path="/app/notes/:id" element={<CompanionMemoryDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Memory index');
    expect(html).toContain('Role');
    expect(html).toContain('Reference doc');
    expect(html).toContain('references/doc.md');
    expect(html).toContain('Relationships');
    expect(html).toContain('/app/projects/continuous-conversations');
  });

  it('renders skill detail with invocation guidance and markdown content', () => {
    vi.mocked(useApi).mockReturnValue({
      data: {
        skill: {
          name: 'tool-agent-browser',
          description: 'Automate browsers and Electron apps with agent-browser.',
          source: 'shared',
          path: '/tmp/tool-agent-browser/INDEX.md',
          recentSessionCount: 1,
          lastUsedAt: '2026-03-25T00:00:00.000Z',
          usedInLastSession: true,
        },
        content: '# Agent Browser\n\nUse this skill for browser automation.',
        links: {
          outgoing: [{ kind: 'project', id: 'continuous-conversations', title: 'Continuous conversations', summary: 'Project node.' }],
          incoming: [{ kind: 'note', id: 'memory-index', title: 'Memory index', summary: 'Top-level knowledge hub.' }],
          unresolved: ['unknown-skill-ref'],
        },
      },
      loading: false,
      refreshing: false,
      error: null,
      refetch: vi.fn(),
      replaceData: vi.fn(),
    });

    const html = renderToString(
      <MemoryRouter initialEntries={['/app/skills/tool-agent-browser']}>
        <Routes>
          <Route path="/app/skills/:name" element={<CompanionSkillDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(html).toContain('Agent Browser');
    expect(html).toContain('Use in conversation');
    expect(html).toContain('tool-agent-browser');
    expect(html).toContain('Use this skill for browser automation.');
    expect(html).toContain('unknown-skill-ref');
    expect(html).toContain('/app/notes/memory-index');
  });
});
