import type { MemoryDocItem } from './types';
import { timeAgo } from './utils';

export const NOTE_ID_SEARCH_PARAM = 'note';
export const NOTE_VIEW_SEARCH_PARAM = 'view';
export const NOTE_ITEM_SEARCH_PARAM = 'item';
export const NOTE_NEW_SEARCH_PARAM = 'new';

export type NoteWorkspaceView = 'main' | 'references' | 'links';

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

export function readNoteView(search: string): NoteWorkspaceView {
  const value = new URLSearchParams(search).get(NOTE_VIEW_SEARCH_PARAM)?.trim();
  return value === 'references' || value === 'links' ? value : 'main';
}

export function readCreateState(search: string): boolean {
  return new URLSearchParams(search).get(NOTE_NEW_SEARCH_PARAM) === '1';
}

export function buildNoteSearch(locationSearch: string, updates: {
  memoryId?: string | null;
  view?: NoteWorkspaceView | null;
  item?: string | null;
  creating?: boolean | null;
}): string {
  const params = new URLSearchParams(locationSearch);

  if (updates.memoryId !== undefined) {
    if (updates.memoryId) {
      params.set(NOTE_ID_SEARCH_PARAM, updates.memoryId);
    } else {
      params.delete(NOTE_ID_SEARCH_PARAM);
      params.delete('memory');
    }
  }

  if (updates.view !== undefined) {
    if (updates.view) {
      params.set(NOTE_VIEW_SEARCH_PARAM, updates.view);
    } else {
      params.delete(NOTE_VIEW_SEARCH_PARAM);
    }
  }

  if (updates.item !== undefined) {
    if (updates.item) {
      params.set(NOTE_ITEM_SEARCH_PARAM, updates.item);
    } else {
      params.delete(NOTE_ITEM_SEARCH_PARAM);
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

export function formatReferenceCount(count: number | undefined): string {
  const normalized = count ?? 0;
  return `${normalized} ${normalized === 1 ? 'reference' : 'references'}`;
}

export function formatRelatedCount(related: string[] | undefined): string | null {
  const normalized = related?.length ?? 0;
  if (normalized === 0) {
    return null;
  }

  return `${normalized} related ${normalized === 1 ? 'node' : 'nodes'}`;
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

export function buildNoteListMeta(memory: MemoryDocItem): string {
  const parts = [`@${memory.id}`, noteKindLabel(memory)];

  if (memory.parent) {
    parts.push(`parent @${memory.parent}`);
  }

  const relatedCount = formatRelatedCount(memory.related);
  if (relatedCount) {
    parts.push(relatedCount);
  }

  const referenceSummary = (memory.referenceCount ?? 0) > 0 ? formatReferenceCount(memory.referenceCount) : null;
  if (referenceSummary) {
    parts.push(referenceSummary);
  }

  if (memory.updated) {
    parts.push(`updated ${timeAgo(memory.updated)}`);
  }

  return parts.join(' · ');
}
