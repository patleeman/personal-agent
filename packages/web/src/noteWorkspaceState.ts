import type { MemoryDocItem } from './types';

export const NOTE_ID_SEARCH_PARAM = 'note';
const NOTE_NEW_SEARCH_PARAM = 'new';
const LEGACY_NOTE_ID_SEARCH_PARAM = 'memory';
const LEGACY_NOTE_VIEW_SEARCH_PARAM = 'view';
const LEGACY_NOTE_ITEM_SEARCH_PARAM = 'item';

export function filterMemories(memories: MemoryDocItem[], query: string): MemoryDocItem[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return memories;
  }

  return memories.filter((memory) => {
    const haystack = [
      memory.id,
      memory.title,
      memory.summary,
      memory.type,
      memory.status,
      memory.area,
      memory.role,
      memory.parent,
      memory.searchText,
      ...(memory.related ?? []),
      ...memory.tags,
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('\n')
      .toLowerCase();

    return haystack.includes(normalized);
  });
}

export function readCreateState(search: string): boolean {
  return new URLSearchParams(search).get(NOTE_NEW_SEARCH_PARAM) === '1';
}

export function buildNoteSearch(locationSearch: string, updates: {
  memoryId?: string | null;
  creating?: boolean | null;
}): string {
  const params = new URLSearchParams(locationSearch);
  const existingMemoryId = params.get(NOTE_ID_SEARCH_PARAM)?.trim() || params.get(LEGACY_NOTE_ID_SEARCH_PARAM)?.trim() || '';

  params.delete(LEGACY_NOTE_ID_SEARCH_PARAM);
  params.delete(LEGACY_NOTE_VIEW_SEARCH_PARAM);
  params.delete(LEGACY_NOTE_ITEM_SEARCH_PARAM);

  if (!params.get(NOTE_ID_SEARCH_PARAM) && existingMemoryId) {
    params.set(NOTE_ID_SEARCH_PARAM, existingMemoryId);
  }

  if (updates.memoryId !== undefined) {
    if (updates.memoryId) {
      params.set(NOTE_ID_SEARCH_PARAM, updates.memoryId);
    } else {
      params.delete(NOTE_ID_SEARCH_PARAM);
    }
  }

  if (updates.creating !== undefined) {
    if (updates.creating) {
      params.set(NOTE_NEW_SEARCH_PARAM, '1');
    } else {
      params.delete(NOTE_NEW_SEARCH_PARAM);
    }
  }

  const next = params.toString();
  return next ? `?${next}` : '';
}

export function noteKindLabel(memory: MemoryDocItem): string {
  const tags = new Set(memory.tags.map((tag) => tag.trim().toLowerCase()));
  const type = memory.type?.trim().toLowerCase();
  const role = memory.role?.trim().toLowerCase();

  if (role === 'structure' || type === 'structure' || tags.has('structure')) {
    return 'Structure note';
  }

  if (type === 'reference' || tags.has('reference')) {
    return 'Reference note';
  }

  if (type === 'project' || tags.has('project')) {
    return 'Project note';
  }

  return 'Note';
}

