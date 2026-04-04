import { describe, expect, it } from 'vitest';
import type { ProjectDetail } from '../types.js';
import {
  buildActivityItems,
  normalizeProjectForm,
  projectFormFromDetail,
  projectFormsEqual,
  summarizeActivityPreview,
} from './projectDetailState.js';

function createProjectDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    project: {
      id: 'demo-project',
      createdAt: '2026-03-16T08:00:00.000Z',
      updatedAt: '2026-03-16T08:00:00.000Z',
      title: 'Demo project',
      description: 'Demo description',
      summary: '',
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
    profile: 'assistant',
    taskCount: 0,
    fileCount: 0,
    attachmentCount: 0,
    artifactCount: 0,
    tasks: [],
    document: null,
    files: [],
    attachments: [],
    artifacts: [],
    linkedConversations: [],
    timeline: [],
    ...overrides,
  };
}

describe('project detail timeline helpers', () => {
  it('summarizes markdown-heavy activity into a compact preview', () => {
    expect(summarizeActivityPreview(`Done.\n\n### Shipped\n- Added \`prompt-catalog/system\`\n- Replaced **inline** blocks`)).toBe(
      'Done. · Shipped • Added prompt-catalog/system • Replaced inline blocks',
    );
  });

  it('returns undefined for empty activity previews', () => {
    expect(summarizeActivityPreview('   \n\n   ')).toBeUndefined();
  });

  it('uses the description as the editable summary fallback when summary is blank', () => {
    const detail = createProjectDetail({
      project: {
        ...createProjectDetail().project,
        description: 'Fallback description',
        summary: '   ',
      },
    });

    expect(projectFormFromDetail(detail)).toMatchObject({
      summary: 'Fallback description',
    });
  });

  it('normalizes project form values before comparing them', () => {
    expect(projectFormsEqual(
      {
        title: ' Demo project ',
        repoRoot: ' /tmp/demo ',
        summary: ' Tight summary ',
        status: ' active ',
      },
      normalizeProjectForm({
        title: 'Demo project',
        repoRoot: '/tmp/demo',
        summary: 'Tight summary',
        status: 'active',
      }),
    )).toBe(true);
  });

  it('orders activity newest first across timeline entries and linked conversations', () => {
    const detail = createProjectDetail({
      timeline: [
        {
          id: 'project:demo-project',
          kind: 'project',
          createdAt: '2026-03-16T09:00:00.000Z',
          title: 'Project created',
        },
        {
          id: 'document:decision-log',
          kind: 'document',
          createdAt: '2026-03-16T10:00:00.000Z',
          title: 'Decision log',
        },
      ],
      linkedConversations: [
        {
          conversationId: 'conv-1',
          title: 'Related conversation',
          lastActivityAt: '2026-03-16T12:00:00.000Z',
          isRunning: false,
          needsAttention: false,
        },
      ],
    });

    expect(buildActivityItems(detail).map((item) => item.id)).toEqual([
      'conversation:conv-1',
      'timeline:document:decision-log',
      'timeline:project:demo-project',
    ]);
  });
});
