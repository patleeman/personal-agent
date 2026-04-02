import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../types.js';
import { ProjectDetailPanel } from './ProjectDetailPanel.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createProjectDetail(): ProjectDetail {
  return {
    profile: 'datadog',
    project: {
      id: 'bloodhound-prototype',
      createdAt: '2026-03-20T12:00:00.000Z',
      updatedAt: '2026-03-24T10:48:00.000Z',
      title: 'Bloodhound prototype',
      description: 'Prototype a teammate-like proactive agent for a narrow pilot domain.',
      repoRoot: '/Users/patrickc.lee/personal/personal-agent',
      summary: 'Keep the structured project record tucked away until it is needed.',
      requirements: {
        goal: 'Ship a tight prototype that proves whether proactive help feels useful.',
        acceptanceCriteria: ['Teammates can define the pilot domain.'],
      },
      status: 'active',
      blockers: [],
      currentFocus: 'Tighten the main project workspace.',
      recentProgress: [],
      plan: {
        milestones: [],
        tasks: [],
      },
    },
    taskCount: 1,
    childPageCount: 1,
    fileCount: 1,
    attachmentCount: 1,
    artifactCount: 0,
    tasks: [
      {
        id: 'collapse-secondary-sections',
        status: 'doing',
        title: 'Collapse secondary sections by default',
      },
    ],
    document: {
      path: '/tmp/bloodhound-prototype/INDEX.md',
      updatedAt: '2026-03-24T09:30:00.000Z',
      content: `# Bloodhound prototype

Ship a tight prototype that proves whether proactive help feels useful.

## Plan

- Push secondary detail behind explicit reveals.`,
    },
    childPages: [
      {
        id: 'note-1',
        path: '/tmp/bloodhound-prototype-note-1/INDEX.md',
        title: 'Teammate feel',
        kind: 'note',
        kinds: ['note'],
        summary: 'Hidden note body that should not render in the compact sidebar list.',
        status: 'active',
        tags: ['type:note'],
        parent: 'bloodhound-prototype',
        body: '# Teammate feel\n\nHidden note body that should not render in the compact sidebar list.',
        createdAt: '2026-03-23T15:46:00.000Z',
        updatedAt: '2026-03-23T15:46:00.000Z',
      },
    ],
    files: [
      {
        id: 'file-1',
        sourceKind: 'attachment',
        kind: 'attachment',
        path: '/tmp/bloodhound-prototype/files/file-1.md',
        title: 'Dense design notes',
        description: 'Hidden attachment description.',
        originalName: 'dense-design-notes.md',
        mimeType: 'text/markdown',
        sizeBytes: 1024,
        createdAt: '2026-03-23T15:46:00.000Z',
        updatedAt: '2026-03-23T15:46:00.000Z',
        downloadPath: '/api/projects/bloodhound-prototype/files/file-1',
      },
    ],
    attachments: [],
    artifacts: [],
    linkedConversations: [
      {
        conversationId: 'conv-1',
        title: 'Prototype review thread',
        lastActivityAt: '2026-03-24T10:10:00.000Z',
        isRunning: false,
        needsAttention: false,
        snippet: 'Debating whether the right rail should own more project metadata.',
      },
    ],
    links: {
      outgoing: [{ kind: 'skill', id: 'agent-browser', title: 'Agent Browser', summary: 'Browser automation.' }],
      incoming: [{ kind: 'note', id: 'bloodhound-roadmap', title: 'Bloodhound roadmap', summary: 'Related note.' }],
      unresolved: ['missing-link'],
    },
    timeline: [
      {
        id: 'timeline-1',
        kind: 'document',
        createdAt: '2026-03-24T10:00:00.000Z',
        title: 'Project doc updated',
      },
    ],
  };
}

describe('ProjectDetailPanel', () => {
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
  });

  it('renders inline-editable project fields with the document before activity, subtasks, and a right rail', () => {
    const html = renderToString(
      <MemoryRouter>
        <ProjectDetailPanel project={createProjectDetail()} activeProfile="datadog" />
      </MemoryRouter>,
    );

    expect(html).toContain('Bloodhound prototype');
    expect(html).toContain('Start conversation');
    expect(html).toContain('Activity');
    expect(html).toContain('Tasks');
    expect(html).toContain('1 open · 0 done');
    expect(html).toContain('Collapse secondary sections by default');
    expect(html).toContain('Dense design notes');
    expect(html).toContain('Prototype review thread');
    expect(html).toContain('Pages');
    expect(html).toContain('Open page');
    expect(html).toContain('aria-label="Page title"');
    expect(html).toContain('name="project-status"');
    expect(html).not.toContain('Edit project');
    expect(html).not.toContain('Regenerate');
    expect(html).not.toContain('Edit document');
    expect(html).not.toContain('Current focus · Tighten the main project workspace.');
    expect(html).toContain('ui-note-editor-frame');
    expect(html).toContain('Hidden note body that should not render in the compact sidebar list.');
    expect(html).not.toContain('<h2 class="text-[20px] font-semibold tracking-tight text-primary">Document</h2>');
    expect(html).not.toContain('>Project doc<');
    expect(html.indexOf('ui-note-editor-frame')).toBeLessThan(html.indexOf('>Activity<'));
  });

  it('merges linked conversations into the visible activity stream', () => {
    const html = renderToString(
      <MemoryRouter>
        <ProjectDetailPanel project={createProjectDetail()} activeProfile="datadog" />
      </MemoryRouter>,
    );

    expect(html).toContain('Project doc updated');
    expect(html).toContain('Prototype review thread');
    expect(html).toContain('Conversation');
  });
});
