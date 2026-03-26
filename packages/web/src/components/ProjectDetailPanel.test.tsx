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
        acceptanceCriteria: ['Teammates can define the pilot domain.', 'The prototype hands rich context into remediation flows.'],
      },
      status: 'in_progress',
      blockers: ['Need a sharper project detail layout for scanning.'],
      currentFocus: 'Turn the project page into a quick read instead of a wall of text.',
      recentProgress: ['Added a more compact summary flow for project readers.'],
      planSummary: `- Keep the active work visible.
- Push secondary detail behind explicit reveals.`,
      completionSummary: 'Not done yet, but the outcome section is ready for when the prototype lands.',
      plan: {
        currentMilestoneId: 'scanability-pass',
        milestones: [
          {
            id: 'scanability-pass',
            title: 'Improve scanability',
            status: 'in_progress',
            summary: 'Reduce dense default-expanded sections.',
          },
        ],
        tasks: [],
      },
    },
    taskCount: 1,
    noteCount: 1,
    attachmentCount: 1,
    artifactCount: 0,
    tasks: [
      {
        id: 'collapse-secondary-sections',
        status: 'in_progress',
        title: 'Collapse secondary sections by default',
        milestoneId: 'scanability-pass',
      },
    ],
    brief: {
      path: '/tmp/bloodhound-prototype/INDEX.md',
      updatedAt: '2026-03-24T09:30:00.000Z',
      content: `# Bloodhound prototype

## Requirements

Handoff-only narrative that should stay collapsed on first render.

## Plan

- Handoff-only implementation notes.

## Completion summary

Handoff-only completion notes.`,
    },
    notes: [
      {
        id: 'note-1',
        path: '/tmp/bloodhound-prototype/notes/note-1.md',
        title: 'Teammate feel',
        kind: 'note',
        body: 'Hidden note body that should not render until Notes is expanded.',
        createdAt: '2026-03-23T15:46:00.000Z',
        updatedAt: '2026-03-23T15:46:00.000Z',
      },
    ],
    attachments: [
      {
        id: 'file-1',
        kind: 'attachment',
        path: '/tmp/bloodhound-prototype/files/file-1.md',
        title: 'Dense design notes',
        description: 'Hidden attachment description.',
        originalName: 'dense-design-notes.md',
        mimeType: 'text/markdown',
        sizeBytes: 1024,
        createdAt: '2026-03-23T15:46:00.000Z',
        updatedAt: '2026-03-23T15:46:00.000Z',
        downloadPath: '/api/projects/bloodhound-prototype/files/attachment/file-1',
      },
    ],
    artifacts: [],
    linkedConversations: [],
    timeline: [
      {
        id: 'timeline-1',
        kind: 'note',
        createdAt: '2026-03-24T10:00:00.000Z',
        title: 'Project kickoff note',
        description: 'Hidden timeline body text that should not show until Timeline is expanded.',
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

  it('keeps secondary project sections collapsed on the first render', () => {
    const html = renderToString(
      <MemoryRouter>
        <ProjectDetailPanel project={createProjectDetail()} activeProfile="datadog" />
      </MemoryRouter>,
    );

    expect(html).toContain('Ship a tight prototype that proves whether proactive help feels useful.');
    expect(html).toContain('Push secondary detail behind explicit reveals.');

    expect(html).toContain('Narrative brief with requirements, plan, and completion notes.');
    expect(html).not.toContain('Handoff-only narrative that should stay collapsed on first render.');

    expect(html).toContain('Latest activity: Project kickoff note');
    expect(html).not.toContain('Hidden timeline body text that should not show until Timeline is expanded.');

    expect(html).toContain('1 durable note across decisions, questions, and checkpoints.');
    expect(html).not.toContain('Hidden note body that should not render until Notes is expanded.');

    expect(html).toContain('1 attachment · 0 artifacts');
    expect(html).not.toContain('Dense design notes');

    expect(html).toContain('Keep the structured project record tucked away until it is needed.');
  });
});
