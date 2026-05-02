import { describe, expect, it } from 'vitest';
import { buildMentionItems, filterMentionItems, MAX_MENTION_MENU_ITEMS, resolveMentionItems } from './conversationMentions';

describe('conversationMentions', () => {
  it('builds task, note, folder, and file mentions without skills or profiles', () => {
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
        id: 'notes/reference/',
        kind: 'folder',
        name: 'reference',
        path: '/tmp/notes/reference',
        sizeBytes: 0,
        updatedAt: '2026-03-11T11:59:00.000Z',
      }, {
        id: 'notes/reference/INDEX.md',
        kind: 'file',
        name: 'INDEX.md',
        path: '/tmp/notes/reference/INDEX.md',
        sizeBytes: 42,
        updatedAt: '2026-03-11T12:00:00.000Z',
      }],
    });

    expect(items.map((item) => `${item.kind}:${item.id}`)).toEqual([
      'task:@daily-review',
      'note:@project-state-model',
      'folder:@notes/reference/',
      'file:@notes/reference/INDEX.md',
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
        id: 'notes/reference/INDEX.md',
        kind: 'file',
        name: 'INDEX.md',
        path: '/tmp/notes/reference/INDEX.md',
        sizeBytes: 42,
        updatedAt: '2026-03-11T12:00:00.000Z',
      }],
    });

    expect(filterMentionItems(items, '@daily').map((item) => item.id)).toEqual(['@daily-review']);
    expect(filterMentionItems(items, '@state').map((item) => item.id)).toEqual(['@project-state-model']);
    expect(filterMentionItems(items, '@stored').map((item) => item.id)).toEqual(['@project-state-model']);
    expect(filterMentionItems(items, '@index').map((item) => item.id)).toEqual(['@notes/reference/INDEX.md']);
    expect(filterMentionItems(items, '@reference').map((item) => item.id)).toEqual(['@notes/reference/INDEX.md']);
  });

  it('caps unqualified mention menus to a fixed number of items', () => {
    const items = buildMentionItems({
      tasks: Array.from({ length: MAX_MENTION_MENU_ITEMS + 2 }, (_, index) => ({
        id: `task-${index + 1}`,
        filePath: `/tmp/task-${index + 1}.task.md`,
        scheduleType: 'cron' as const,
        running: false,
        enabled: true,
        prompt: `Task ${index + 1}`,
      })),
      memoryDocs: [],
      vaultFiles: [],
    });

    expect(filterMentionItems(items, '@', { limit: MAX_MENTION_MENU_ITEMS }).map((item) => item.id)).toHaveLength(MAX_MENTION_MENU_ITEMS);
    expect(filterMentionItems(items, '@', { limit: 5 }).map((item) => item.id)).toHaveLength(5);
    expect(filterMentionItems(items, '@', { limit: 5.5 }).map((item) => item.id)).toHaveLength(MAX_MENTION_MENU_ITEMS + 2);
    expect(filterMentionItems(items, '@', { limit: 5000 }).map((item) => item.id)).toHaveLength(MAX_MENTION_MENU_ITEMS);
  });

  it('resolves mentioned items in encounter order for path-style file and folder references', () => {
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
        id: 'notes/reference/',
        kind: 'folder',
        name: 'reference',
        path: '/tmp/notes/reference',
        sizeBytes: 0,
        updatedAt: '2026-03-11T11:59:00.000Z',
      }, {
        id: 'notes/reference/INDEX.md',
        kind: 'file',
        name: 'INDEX.md',
        path: '/tmp/notes/reference/INDEX.md',
        sizeBytes: 42,
        updatedAt: '2026-03-11T12:00:00.000Z',
      }],
    });

    expect(resolveMentionItems('Use @notes/reference/ with @notes/reference/INDEX.md and @project-state-model.', items).map((item) => item.id)).toEqual([
      '@notes/reference/',
      '@notes/reference/INDEX.md',
      '@project-state-model',
    ]);
  });
});
