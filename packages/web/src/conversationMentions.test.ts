import { describe, expect, it } from 'vitest';
import { buildMentionItems, filterMentionItems, resolveMentionItems } from './conversationMentions';

describe('conversationMentions', () => {
  it('builds project, task, knowledge, skill, and per-profile mentions without view scaffolding', () => {
    const items = buildMentionItems({
      projects: [{
        id: 'web-ui',
        createdAt: '',
        updatedAt: '',
        description: 'Build the web UI shell.',
        summary: 'Inbox-first web shell.',
        status: 'active',
        blockers: [],
        recentProgress: [],
        plan: { milestones: [], tasks: [] },
      }],
      tasks: [{
        id: 'daily-review',
        filePath: '/tmp/daily-review.task.md',
        scheduleType: 'cron',
        running: false,
        enabled: true,
        prompt: 'Review today.',
      }],
      memoryDocs: [{
        id: 'project-state-model',
        title: 'Project State Model',
        summary: 'How project state is stored.',
        tags: ['architecture'],
        path: '/tmp/project-state-model.md',
      }],
      skills: [{
        source: 'shared',
        name: 'dd-pup-cli',
        description: 'Query Datadog platform data.',
        path: '/tmp/dd-pup-cli/SKILL.md',
      }],
      profiles: ['assistant', 'datadog', 'shared'],
    });

    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'project:@web-ui',
      'task:@daily-review',
      'knowledge:@project-state-model',
      'skill:@dd-pup-cli',
      'profile:@assistant',
      'profile:@datadog',
      'profile:@shared',
    ]);
  });

  it('filters mentions by id, title, or summary text', () => {
    const items = buildMentionItems({
      projects: [],
      tasks: [{
        id: 'daily-review',
        filePath: '/tmp/daily-review.task.md',
        scheduleType: 'cron',
        running: false,
        enabled: true,
        prompt: 'Review today.',
      }],
      memoryDocs: [{
        id: 'project-state-model',
        title: 'Project State Model',
        summary: 'How project state is stored.',
        tags: ['architecture'],
        path: '/tmp/project-state-model.md',
      }],
      skills: [{
        source: 'shared',
        name: 'dd-pup-cli',
        description: 'Query Datadog platform data.',
        path: '/tmp/dd-pup-cli/SKILL.md',
      }],
      profiles: ['assistant', 'datadog', 'shared'],
    });

    expect(filterMentionItems(items, '@daily').map((item) => item.id)).toEqual(['@daily-review']);
    expect(filterMentionItems(items, '@state').map((item) => item.id)).toEqual(['@project-state-model']);
    expect(filterMentionItems(items, '@stored').map((item) => item.id)).toEqual(['@project-state-model']);
    expect(filterMentionItems(items, '@pup').map((item) => item.id)).toEqual(['@dd-pup-cli']);
    expect(filterMentionItems(items, '@assist').map((item) => item.id)).toEqual(['@assistant']);
  });

  it('resolves mentioned items in encounter order', () => {
    const items = buildMentionItems({
      projects: [],
      tasks: [{
        id: 'daily-review',
        filePath: '/tmp/daily-review.task.md',
        scheduleType: 'cron',
        running: false,
        enabled: true,
        prompt: 'Review today.',
      }],
      memoryDocs: [{
        id: 'project-state-model',
        title: 'Project State Model',
        summary: 'How project state is stored.',
        tags: ['architecture'],
        path: '/tmp/project-state-model.md',
      }],
      skills: [{
        source: 'shared',
        name: 'dd-pup-cli',
        description: 'Query Datadog platform data.',
        path: '/tmp/dd-pup-cli/SKILL.md',
      }],
      profiles: ['assistant', 'datadog', 'shared'],
    });

    expect(resolveMentionItems('Use @assistant with @dd-pup-cli and @project-state-model.', items).map((item) => item.id)).toEqual([
      '@assistant',
      '@dd-pup-cli',
      '@project-state-model',
    ]);
  });
});
