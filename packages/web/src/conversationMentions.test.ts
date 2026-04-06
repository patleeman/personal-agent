import { describe, expect, it } from 'vitest';
import { buildMentionItems, filterMentionItems, resolveMentionItems } from './conversationMentions';

describe('conversationMentions', () => {
  it('builds task, note, and vault-file mentions without skills or profiles', () => {
    const items = buildMentionItems({
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
      vaultFiles: [{
        id: '_profiles/datadog/AGENTS.md',
        name: 'AGENTS.md',
        path: '/tmp/_profiles/datadog/AGENTS.md',
        sizeBytes: 42,
        updatedAt: '2026-03-11T12:00:00.000Z',
      }],
    });

    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'task:@daily-review',
      'note:@project-state-model',
      'file:@_profiles/datadog/AGENTS.md',
    ]);
  });

  it('filters mentions by id, title, or summary text', () => {
    const items = buildMentionItems({
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
      vaultFiles: [{
        id: '_profiles/datadog/AGENTS.md',
        name: 'AGENTS.md',
        path: '/tmp/_profiles/datadog/AGENTS.md',
        sizeBytes: 42,
        updatedAt: '2026-03-11T12:00:00.000Z',
      }],
    });

    expect(filterMentionItems(items, '@daily').map((item) => item.id)).toEqual(['@daily-review']);
    expect(filterMentionItems(items, '@state').map((item) => item.id)).toEqual(['@project-state-model']);
    expect(filterMentionItems(items, '@stored').map((item) => item.id)).toEqual(['@project-state-model']);
    expect(filterMentionItems(items, '@agents').map((item) => item.id)).toEqual(['@_profiles/datadog/AGENTS.md']);
    expect(filterMentionItems(items, '@datadog').map((item) => item.id)).toEqual(['@_profiles/datadog/AGENTS.md']);
  });

  it('resolves mentioned items in encounter order for path-style file references', () => {
    const items = buildMentionItems({
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
      vaultFiles: [{
        id: '_profiles/datadog/AGENTS.md',
        name: 'AGENTS.md',
        path: '/tmp/_profiles/datadog/AGENTS.md',
        sizeBytes: 42,
        updatedAt: '2026-03-11T12:00:00.000Z',
      }],
    });

    expect(resolveMentionItems('Use @_profiles/datadog/AGENTS.md with @project-state-model.', items).map((item) => item.id)).toEqual([
      '@_profiles/datadog/AGENTS.md',
      '@project-state-model',
    ]);
  });
});
