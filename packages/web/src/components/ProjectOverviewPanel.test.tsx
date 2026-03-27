import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../types.js';
import { ProjectOverviewPanel } from './ProjectOverviewPanel.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createProjectDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    profile: 'assistant',
    project: {
      id: 'sidebar-refresh',
      createdAt: '2026-03-16T08:00:00.000Z',
      updatedAt: '2026-03-16T10:30:00.000Z',
      title: 'Sidebar refresh',
      description: 'Improve the active project summary in the conversation rail.',
      summary: 'Make the project context easier to scan while chatting.',
      requirements: {
        goal: '',
        acceptanceCriteria: [],
      },
      status: 'active',
      blockers: [],
      recentProgress: [],
      plan: {
        milestones: [],
        tasks: [],
      },
    },
    taskCount: 2,
    noteCount: 1,
    fileCount: 1,
    attachmentCount: 0,
    artifactCount: 1,
    tasks: [
      {
        id: 'overview-implementation',
        status: 'doing',
        title: 'Implement the richer summary panel',
      },
      {
        id: 'copy-pass',
        status: 'todo',
        title: 'Review project sidebar copy',
      },
    ],
    document: {
      path: '/tmp/sidebar-refresh/INDEX.md',
      updatedAt: '2026-03-16T09:30:00.000Z',
      content: `# Sidebar refresh

Make the active project easy to scan from the conversation sidebar.`,
    },
    brief: {
      path: '/tmp/sidebar-refresh/INDEX.md',
      updatedAt: '2026-03-16T09:30:00.000Z',
      content: `# Sidebar refresh

Make the active project easy to scan from the conversation sidebar.`,
    },
    notes: [],
    files: [
      {
        id: 'file-1',
        sourceKind: 'artifact',
        kind: 'artifact',
        path: '/tmp/sidebar-refresh/report.md',
        title: 'Rail report',
        originalName: 'report.md',
        sizeBytes: 123,
        createdAt: '2026-03-16T09:30:00.000Z',
        updatedAt: '2026-03-16T09:30:00.000Z',
        downloadPath: '/api/projects/sidebar-refresh/files/file-1/download',
      },
    ],
    attachments: [],
    artifacts: [],
    linkedConversations: [
      {
        conversationId: 'conv-123',
        title: 'Sidebar iteration',
        lastActivityAt: '2026-03-16T10:15:00.000Z',
        isRunning: false,
        needsAttention: false,
      },
    ],
    timeline: [],
    ...overrides,
  };
}

describe('ProjectOverviewPanel', () => {
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

  it('renders the simplified project digest with doc and task previews', () => {
    const html = renderToString(
      <MemoryRouter>
        <ProjectOverviewPanel project={createProjectDetail()} />
      </MemoryRouter>,
    );

    expect(html).toContain('Sidebar refresh');
    expect(html).toContain('Make the project context easier to scan while chatting.');
    expect(html).toContain('Doc');
    expect(html).toContain('Make the active project easy to scan from the conversation sidebar.');
    expect(html).toContain('Tasks');
    expect(html).toContain('Implement the richer summary panel');
    expect(html).toContain('Review project sidebar copy');
    expect(html).toContain('1 file');
    expect(html).toContain('1 conversation');
  });
});
