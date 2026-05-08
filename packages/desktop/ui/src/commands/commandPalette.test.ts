import { describe, expect, it } from 'vitest';

import {
  type CommandPaletteItem,
  isCommandPaletteThreadDataLoading,
  searchCommandPaletteItems,
  selectCommandPaletteScopedItems,
  shouldBootstrapCommandPaletteThreads,
} from './commandPalette';

interface TestAction {
  kind: string;
}

const ITEMS: CommandPaletteItem<TestAction>[] = [
  {
    id: 'open:alpha',
    section: 'open',
    title: 'Alpha issue triage',
    subtitle: '/tmp/alpha',
    keywords: ['conv-open-1', 'alpha body text'],
    order: 1,
    action: { kind: 'open' },
  },
  {
    id: 'archived:beta',
    section: 'archived',
    title: 'Beta cleanup',
    subtitle: '/tmp/archive',
    keywords: ['conv-archive-1', 'beta body text'],
    order: 1,
    action: { kind: 'restore' },
  },
  {
    id: 'file:guide',
    section: 'files',
    title: 'Workspace Files',
    subtitle: 'notes/workspace-files.md',
    keywords: ['workspaces', 'workspace layout guide'],
    order: 1,
    action: { kind: 'file' },
  },
  {
    id: 'extension-command:agent-board:new-task',
    section: 'commands',
    title: 'Agent Board: New task',
    subtitle: 'agent-board',
    keywords: ['kanban', 'task'],
    order: 1,
    action: { kind: 'extensionCommand' },
  },
];

describe('command palette search', () => {
  it('filters file matches ahead of unrelated items in the files scope', () => {
    const results = searchCommandPaletteItems(ITEMS, { query: 'workspace', scope: 'files' });

    expect(results).toHaveLength(1);
    expect(results[0]?.section).toBe('files');
    expect(results[0]?.items.map((item) => item.id)).toEqual(['file:guide']);
  });

  it('matches across multiple tokens and keywords', () => {
    const results = searchCommandPaletteItems(ITEMS, { query: 'beta body', scope: 'threads' });

    expect(results).toHaveLength(1);
    expect(results[0]?.section).toBe('archived');
    expect(results[0]?.items[0]?.id).toBe('archived:beta');
  });

  it('filters to the requested thread scope', () => {
    const results = searchCommandPaletteItems(ITEMS, { query: '', scope: 'threads' });

    expect(results.map((group) => group.section)).toEqual(['open', 'archived']);
  });

  it('includes commands and files in the search-all scope', () => {
    const results = searchCommandPaletteItems(ITEMS, { query: '', scope: 'search' });

    expect(results.map((group) => group.section)).toEqual(['commands', 'open', 'archived', 'files']);
  });

  it('filters to the requested command scope', () => {
    const results = searchCommandPaletteItems(ITEMS, { query: 'board', scope: 'commands' });

    expect(results).toHaveLength(1);
    expect(results[0]?.section).toBe('commands');
    expect(results[0]?.items.map((item) => item.id)).toEqual(['extension-command:agent-board:new-task']);
  });

  it('keeps local thread and file title matches while adding content-search results', () => {
    const scoped = selectCommandPaletteScopedItems({
      scope: 'search',
      query: 'workspace',
      openConversationItems: [ITEMS[0]!],
      archivedConversationItems: [ITEMS[1]!],
      fileItems: [ITEMS[2]!],
      commandItems: [ITEMS[3]!],
      searchedConversationItems: [
        {
          ...ITEMS[1]!,
          id: 'conversation-search:beta:block-1',
          title: 'Matched transcript block',
        },
      ],
      searchedFileItems: [
        {
          ...ITEMS[2]!,
          id: 'file-search:guide',
          title: 'Workspace file excerpt',
        },
      ],
    });

    expect(scoped.map((item) => item.id)).toEqual([
      'extension-command:agent-board:new-task',
      'open:alpha',
      'archived:beta',
      'conversation-search:beta:block-1',
      'file:guide',
      'file-search:guide',
    ]);

    const results = searchCommandPaletteItems(scoped, { query: 'workspace', scope: 'search' });
    expect(results.flatMap((group) => group.items.map((item) => item.id))).toContain('file:guide');
  });

  it('supports overriding empty-query limits for lazy-loaded thread history', () => {
    const items = [
      ITEMS[1]!,
      {
        ...ITEMS[1]!,
        id: 'archived:gamma',
        title: 'Gamma cleanup',
        order: 2,
      },
    ];
    const results = searchCommandPaletteItems(items, {
      query: '',
      scope: 'threads',
      emptyQueryLimits: { archived: 1 },
    });

    expect(results).toHaveLength(1);
    expect(results[0]?.total).toBe(2);
    expect(results[0]?.items.map((item) => item.id)).toEqual(['archived:beta']);

    const malformedLimitResults = searchCommandPaletteItems(items, {
      query: '',
      scope: 'threads',
      emptyQueryLimits: { archived: 1.5 },
    });
    expect(malformedLimitResults[0]?.items.map((item) => item.id)).toEqual(['archived:beta', 'archived:gamma']);
  });

  it('caps excessive empty-query limit overrides', () => {
    const items = Array.from({ length: 150 }, (_, index) => ({
      ...ITEMS[1]!,
      id: `archived:${index}`,
      title: `Archived ${index}`,
      order: index,
    }));

    const results = searchCommandPaletteItems(items, {
      query: '',
      scope: 'threads',
      emptyQueryLimits: { archived: 5000 },
    });

    expect(results[0]?.items).toHaveLength(100);
  });

  it('bootstraps thread results when the palette opens before sessions load', () => {
    expect(
      shouldBootstrapCommandPaletteThreads({
        open: true,
        scope: 'threads',
        sessions: null,
        alreadyRequested: false,
      }),
    ).toBe(true);

    expect(
      shouldBootstrapCommandPaletteThreads({
        open: true,
        scope: 'search',
        sessions: null,
        alreadyRequested: false,
      }),
    ).toBe(true);

    expect(
      shouldBootstrapCommandPaletteThreads({
        open: true,
        scope: 'files',
        sessions: null,
        alreadyRequested: false,
      }),
    ).toBe(false);
  });

  it('does not re-bootstrap thread results after the first request or once sessions are loaded', () => {
    expect(
      shouldBootstrapCommandPaletteThreads({
        open: true,
        scope: 'threads',
        sessions: null,
        alreadyRequested: true,
      }),
    ).toBe(false);

    expect(
      shouldBootstrapCommandPaletteThreads({
        open: true,
        scope: 'threads',
        sessions: [],
        alreadyRequested: false,
      }),
    ).toBe(false);

    expect(
      shouldBootstrapCommandPaletteThreads({
        open: false,
        scope: 'threads',
        sessions: null,
        alreadyRequested: false,
      }),
    ).toBe(false);
  });

  it('treats unknown sessions as a loading state for thread sections', () => {
    expect(isCommandPaletteThreadDataLoading({ sessions: null, sessionsLoading: false })).toBe(true);
    expect(isCommandPaletteThreadDataLoading({ sessions: [], sessionsLoading: true })).toBe(true);
    expect(isCommandPaletteThreadDataLoading({ sessions: [], sessionsLoading: false })).toBe(false);
  });
});
