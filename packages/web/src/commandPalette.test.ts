import { describe, expect, it } from 'vitest';
import { scoreCommandPaletteItem, searchCommandPaletteItems, type CommandPaletteItem } from './commandPalette';

interface TestAction {
  kind: string;
}

const ITEMS: CommandPaletteItem<TestAction>[] = [
  {
    id: 'nav:workspace',
    section: 'nav',
    title: 'Workspace Files',
    subtitle: 'Browse workspace files',
    keywords: ['workspaces'],
    order: 1,
    action: { kind: 'navigate' },
  },
  {
    id: 'open:alpha',
    section: 'open',
    title: 'Alpha issue triage',
    subtitle: '/tmp/alpha',
    keywords: ['conv-open-1'],
    order: 1,
    action: { kind: 'open' },
  },
  {
    id: 'archived:beta',
    section: 'archived',
    title: 'Beta cleanup',
    subtitle: '/tmp/archive',
    keywords: ['conv-archive-1'],
    order: 1,
    action: { kind: 'restore' },
  },
  {
    id: 'task:nightly',
    section: 'tasks',
    title: 'nightly-review',
    subtitle: 'Summarize unresolved tickets',
    keywords: ['0 8 * * *', 'gpt-5'],
    order: 1,
    action: { kind: 'task' },
  },
];

describe('command palette search', () => {
  it('scores title matches ahead of unrelated items', () => {
    const score = scoreCommandPaletteItem(ITEMS[3], 'nightly');
    const unrelated = scoreCommandPaletteItem(ITEMS[0], 'nightly');

    expect(score).not.toBeNull();
    expect(unrelated).toBeNull();
  });

  it('matches across multiple tokens and keywords', () => {
    const results = searchCommandPaletteItems(ITEMS, { query: 'nightly summarize', scope: 'commands' });

    expect(results).toHaveLength(1);
    expect(results[0]?.section).toBe('tasks');
    expect(results[0]?.items[0]?.id).toBe('task:nightly');
  });

  it('filters to the requested scope', () => {
    const results = searchCommandPaletteItems(ITEMS, { query: '', scope: 'threads' });

    expect(results).toHaveLength(1);
    expect(results[0]?.section).toBe('archived');
    expect(results[0]?.items.map((item) => item.id)).toEqual(['archived:beta']);
  });

  it('keeps section order when query is empty', () => {
    const results = searchCommandPaletteItems(ITEMS, { query: '', scope: 'commands' });

    expect(results.map((group) => group.section)).toEqual([
      'nav',
      'open',
      'tasks',
    ]);
  });
});
