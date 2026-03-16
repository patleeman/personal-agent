import React from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDetail } from '../types.js';
import { ProjectOverviewPanel } from './ProjectOverviewPanel.js';

(globalThis as typeof globalThis & { React?: typeof React }).React = React;

function createProjectDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    project: {
      id: 'sidebar-refresh',
      createdAt: '2026-03-16T08:00:00.000Z',
      updatedAt: '2026-03-16T10:30:00.000Z',
      title: 'Sidebar refresh',
      description: 'Improve the active project summary in the conversation rail.',
      summary: 'Make the project context easier to scan while chatting.',
      requirements: {
        goal: '',
        acceptanceCriteria: ['Show the goal', 'Show the plan summary'],
      },
      status: 'in_progress',
      blockers: ['Need the sidebar summary to reuse the full project narrative.'],
      currentFocus: 'Pull the richer narrative into the conversation rail.',
      recentProgress: ['Added the new project overview layout.'],
      plan: {
        currentMilestoneId: 'rail-digest',
        milestones: [
          {
            id: 'rail-digest',
            title: 'Ship the richer project digest',
            status: 'in_progress',
            summary: 'Mirror the important parts of the full project view.',
          },
          {
            id: 'polish',
            title: 'Polish spacing and copy',
            status: 'pending',
          },
        ],
        tasks: [],
      },
    },
    taskCount: 2,
    noteCount: 1,
    attachmentCount: 0,
    artifactCount: 1,
    tasks: [
      {
        id: 'overview-implementation',
        status: 'in_progress',
        title: 'Implement the richer summary panel',
        milestoneId: 'rail-digest',
      },
      {
        id: 'copy-pass',
        status: 'pending',
        title: 'Review project sidebar copy',
      },
    ],
    brief: {
      path: '/tmp/sidebar-refresh/BRIEF.md',
      updatedAt: '2026-03-16T09:30:00.000Z',
      content: `# Sidebar refresh

## Requirements

Make the active project easy to scan from the conversation sidebar.

## Plan

- Scope the conversation sidebar refresh.
- Pull in the project brief when list fields are sparse.

## Completion summary

Shipped the richer sidebar summary.`,
    },
    notes: [],
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

  it('renders a richer project digest using brief-derived requirements and plan sections', () => {
    const html = renderToString(
      <MemoryRouter>
        <ProjectOverviewPanel project={createProjectDetail()} />
      </MemoryRouter>,
    );

    expect(html).toContain('Requirements');
    expect(html).toContain('Make the active project easy to scan from the conversation sidebar.');
    expect(html).toContain('Acceptance criteria');
    expect(html).toContain('Show the goal');
    expect(html).toContain('Plan');
    expect(html).toContain('Scope the conversation sidebar refresh.');
    expect(html).toContain('Pull the richer narrative into the conversation rail.');
    expect(html).toContain('Milestones');
    expect(html).toContain('Tasks');
    expect(html).toContain('unassigned');
  });
});
