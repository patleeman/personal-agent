import { describe, expect, it } from 'vitest';
import { buildNoteSearch, filterMemories } from './noteWorkspaceState';
import type { MemoryDocItem } from '../types';

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
  it('builds note search params without note tag filters', () => {
    expect(buildNoteSearch('?note=memory-index&foo=bar', {
      memoryId: null,
      creating: false,
    })).toBe('?foo=bar');
  });

  it('filters notes by text across ids, titles, and summaries', () => {
    expect(filterMemories(MEMORIES, 'memory')).toEqual([MEMORIES[0]]);
    expect(filterMemories(MEMORIES, 'scratch')).toEqual([MEMORIES[1]]);
    expect(filterMemories(MEMORIES, '')).toEqual(MEMORIES);
  });
});
