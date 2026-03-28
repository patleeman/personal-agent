import { describe, expect, it } from 'vitest';
import { buildNoteSearch, filterMemories, readNoteTagFilters, toggleNoteTagFilter } from './noteWorkspaceState';
import type { MemoryDocItem } from './types';

const MEMORIES: MemoryDocItem[] = [
  {
    id: 'memory-index',
    title: 'Memory index',
    summary: 'Top-level knowledge hub.',
    tags: ['notes', 'index', 'structure'],
    path: '/tmp/memory-index/INDEX.md',
    type: 'structure',
    status: 'active',
    area: 'notes',
  },
  {
    id: 'quick-idea',
    title: 'Quick idea',
    summary: 'Short scratch note.',
    tags: ['scratch'],
    path: '/tmp/quick-idea/INDEX.md',
    type: 'note',
    status: 'active',
    area: 'notes',
  },
];

describe('noteWorkspaceState', () => {
  it('reads normalized tag filters from the url', () => {
    expect(readNoteTagFilters('?tag=Structure&tag=scratch&tag=structure')).toEqual(['structure', 'scratch']);
  });

  it('builds note search params with tag filters', () => {
    expect(buildNoteSearch('?note=memory-index&foo=bar', {
      memoryId: null,
      creating: false,
      tags: ['structure', 'notes'],
    })).toBe('?foo=bar&tag=structure&tag=notes');
  });

  it('toggles tags and combines tag filters with text filtering', () => {
    expect(toggleNoteTagFilter(['structure'], 'notes')).toEqual(['structure', 'notes']);
    expect(toggleNoteTagFilter(['structure', 'notes'], 'notes')).toEqual(['structure']);
    expect(filterMemories(MEMORIES, 'memory', ['structure'])).toEqual([MEMORIES[0]]);
    expect(filterMemories(MEMORIES, '', ['scratch'])).toEqual([MEMORIES[1]]);
  });
});
