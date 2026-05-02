import { describe, expect, it } from 'vitest';
import { scoreCommandPaletteItem, searchCommandPaletteItems, type CommandPaletteItem } from './commandPalette';

interface TestAction {
  kind: string;
}

const ITEMS: CommandPaletteItem<TestAction>[] = [
  {
    id: 'nav:projects',
    section: 'nav',
    title: 'Projects',
    subtitle: 'Browse all projects',
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
    id: 'memory:ship',
    section: 'memories',
    title: 'Ship candidate',
    subtitle: 'ready to branch',
    keywords: ['memory-123', 'release'],
    order: 1,
    action: { kind: 'memory' },
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
  {
    id: 'project:apollo',
    section: 'projects',
    title: 'Apollo migration',
    subtitle: 'Move jobs onto the new worker stack',
    keywords: ['apollo-migration', 'in_progress'],
    order: 1,
    action: { kind: 'project' },
  },
];

describe('command palette search', () => {
  it('scores title matches ahead of unrelated items', () => {
    const score = scoreCommandPaletteItem(ITEMS[5], 'apollo');
    const unrelated = scoreCommandPaletteItem(ITEMS[0], 'apollo');

    expect(score).not.toBeNull();
    expect(unrelated).toBeNull();
  });

  it('matches across multiple tokens and keywords', () => {
    const results = searchCommandPaletteItems(ITEMS, { query: 'ship release', scope: 'all' });

    expect(results).toHaveLength(1);
    expect(results[0]?.section).toBe('memories');
    expect(results[0]?.items[0]?.id).toBe('memory:ship');
  });

  it('filters to the requested scope', () => {
    const results = searchCommandPaletteItems(ITEMS, { query: '', scope: 'projects' });

    expect(results).toHaveLength(1);
    expect(results[0]?.section).toBe('projects');
    expect(results[0]?.items.map((item) => item.id)).toEqual(['project:apollo']);
  });

  it('keeps section order when query is empty', () => {
    const results = searchCommandPaletteItems(ITEMS, { query: '', scope: 'all' });

    expect(results.map((group) => group.section)).toEqual([
      'nav',
      'open',
      'archived',
      'memories',
      'tasks',
      'projects',
    ]);
  });
});
