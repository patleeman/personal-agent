import { describe, expect, it } from 'vitest';
import type { ProjectDetail } from '../types.js';
import { buildActivityItems, summarizeActivityPreview } from './projectDetailState.js';

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
      status: 'in_progress',
      blockers: [],
      recentProgress: [],
      plan: {
        milestones: [],
        tasks: [],
      },
    },
    taskCount: 0,
    noteCount: 0,
    attachmentCount: 0,
    artifactCount: 0,
    tasks: [],
    brief: null,
    notes: [],
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

  it('orders activity items as a chronological timeline and keeps missing timestamps last', () => {
    const detail = createProjectDetail({
      linkedConversations: [
        {
          conversationId: 'conversation-late',
          title: 'Later conversation',
          lastActivityAt: '2026-03-16T11:00:00.000Z',
          isRunning: false,
          needsAttention: false,
        },
        {
          conversationId: 'conversation-missing-time',
          title: 'Conversation without timestamp',
          isRunning: false,
          needsAttention: false,
        },
      ],
      timeline: [
        {
          id: 'brief:demo-project',
          kind: 'brief',
          createdAt: '2026-03-16T09:00:00.000Z',
          title: 'Project handoff doc updated',
        },
        {
          id: 'note:decision-log',
          kind: 'note',
          createdAt: '2026-03-16T10:00:00.000Z',
          title: 'Decision log',
        },
        {
          id: 'conversation:shadowed',
          kind: 'conversation',
          createdAt: '2026-03-16T12:00:00.000Z',
          title: 'Shadowed conversation entry',
        },
      ],
    });

    expect(buildActivityItems(detail).map((item) => item.id)).toEqual([
      'timeline:brief:demo-project',
      'timeline:note:decision-log',
      'conversation:conversation-late',
      'conversation:conversation-missing-time',
    ]);
  });
});
