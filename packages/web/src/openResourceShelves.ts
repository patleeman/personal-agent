import { useEffect, useState } from 'react';
import {
  OPEN_NOTE_IDS_STORAGE_KEY,
  OPEN_PROJECT_IDS_STORAGE_KEY,
  OPEN_SKILL_IDS_STORAGE_KEY,
  OPEN_WORKSPACE_IDS_STORAGE_KEY,
  PINNED_NOTE_IDS_STORAGE_KEY,
  PINNED_PROJECT_IDS_STORAGE_KEY,
  PINNED_SKILL_IDS_STORAGE_KEY,
  PINNED_WORKSPACE_IDS_STORAGE_KEY,
} from './localSettings';

export const OPEN_RESOURCE_SHELVES_CHANGED_EVENT = 'pa:open-resource-shelves-changed';

export type OpenResourceKind = 'note' | 'project' | 'skill' | 'workspace';

export interface OpenResourceShelfState {
  openIds: string[];
  pinnedIds: string[];
}

function normalizeResourceId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeResourceIds(values: Iterable<unknown>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeResourceId(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ids.push(normalized);
  }

  return ids;
}

function normalizeShelfState(input: Partial<OpenResourceShelfState>): OpenResourceShelfState {
  const pinnedIds = normalizeResourceIds(input.pinnedIds ?? []);
  const pinnedIdSet = new Set(pinnedIds);
  const openIds = normalizeResourceIds(input.openIds ?? []).filter((id) => !pinnedIdSet.has(id));

  return {
    openIds,
    pinnedIds,
  };
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((id, index) => id === right[index]);
}

function sameShelfState(left: OpenResourceShelfState, right: OpenResourceShelfState): boolean {
  return sameIds(left.openIds, right.openIds) && sameIds(left.pinnedIds, right.pinnedIds);
}

function storageKeys(kind: OpenResourceKind): { open: string; pinned: string } {
  switch (kind) {
    case 'note':
      return { open: OPEN_NOTE_IDS_STORAGE_KEY, pinned: PINNED_NOTE_IDS_STORAGE_KEY };
    case 'project':
      return { open: OPEN_PROJECT_IDS_STORAGE_KEY, pinned: PINNED_PROJECT_IDS_STORAGE_KEY };
    case 'skill':
      return { open: OPEN_SKILL_IDS_STORAGE_KEY, pinned: PINNED_SKILL_IDS_STORAGE_KEY };
    case 'workspace':
      return { open: OPEN_WORKSPACE_IDS_STORAGE_KEY, pinned: PINNED_WORKSPACE_IDS_STORAGE_KEY };
  }
}

function readStoredIds(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return normalizeResourceIds(parsed);
  } catch {
    return [];
  }
}

function writeStoredIds(storageKey: string, ids: readonly string[]): void {
  try {
    if (ids.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(ids));
      return;
    }

    localStorage.removeItem(storageKey);
  } catch {
    // Ignore storage failures.
  }
}

function dispatchShelfChanged(kind: OpenResourceKind, state: OpenResourceShelfState): void {
  window.dispatchEvent(new CustomEvent(OPEN_RESOURCE_SHELVES_CHANGED_EVENT, {
    detail: { kind, state },
  }));
}

function writeShelfState(kind: OpenResourceKind, state: OpenResourceShelfState): OpenResourceShelfState {
  const normalized = normalizeShelfState(state);
  const keys = storageKeys(kind);
  writeStoredIds(keys.open, normalized.openIds);
  writeStoredIds(keys.pinned, normalized.pinnedIds);
  dispatchShelfChanged(kind, normalized);
  return normalized;
}

export function readOpenResourceShelf(kind: OpenResourceKind): OpenResourceShelfState {
  const keys = storageKeys(kind);
  return normalizeShelfState({
    openIds: readStoredIds(keys.open),
    pinnedIds: readStoredIds(keys.pinned),
  });
}

export function ensureOpenResourceShelfItem(kind: OpenResourceKind, id: string | null | undefined): OpenResourceShelfState {
  const normalizedId = normalizeResourceId(id);
  const current = readOpenResourceShelf(kind);
  if (!normalizedId || current.pinnedIds.includes(normalizedId) || current.openIds.includes(normalizedId)) {
    return current;
  }

  return writeShelfState(kind, {
    ...current,
    openIds: [...current.openIds, normalizedId],
  });
}

export function closeOpenResourceShelfItem(kind: OpenResourceKind, id: string | null | undefined): OpenResourceShelfState {
  const normalizedId = normalizeResourceId(id);
  const current = readOpenResourceShelf(kind);
  const nextOpenIds = current.openIds.filter((candidate) => candidate !== normalizedId);
  if (nextOpenIds.length === current.openIds.length) {
    return current;
  }

  return writeShelfState(kind, {
    ...current,
    openIds: nextOpenIds,
  });
}

export function pinOpenResourceShelfItem(kind: OpenResourceKind, id: string | null | undefined): OpenResourceShelfState {
  const normalizedId = normalizeResourceId(id);
  const current = readOpenResourceShelf(kind);
  if (!normalizedId || current.pinnedIds.includes(normalizedId)) {
    return current;
  }

  return writeShelfState(kind, {
    openIds: current.openIds.filter((candidate) => candidate !== normalizedId),
    pinnedIds: [...current.pinnedIds, normalizedId],
  });
}

export function unpinOpenResourceShelfItem(
  kind: OpenResourceKind,
  id: string | null | undefined,
  options: { open?: boolean } = {},
): OpenResourceShelfState {
  const normalizedId = normalizeResourceId(id);
  const current = readOpenResourceShelf(kind);
  const nextPinnedIds = current.pinnedIds.filter((candidate) => candidate !== normalizedId);
  if (nextPinnedIds.length === current.pinnedIds.length) {
    return current;
  }

  const nextOpenIds = options.open === false || current.openIds.includes(normalizedId)
    ? current.openIds
    : [...current.openIds, normalizedId];

  return writeShelfState(kind, {
    openIds: nextOpenIds,
    pinnedIds: nextPinnedIds,
  });
}

export function replaceOpenResourceShelf(kind: OpenResourceKind, nextState: Partial<OpenResourceShelfState>): OpenResourceShelfState {
  const current = readOpenResourceShelf(kind);
  const next = normalizeShelfState({
    openIds: nextState.openIds ?? current.openIds,
    pinnedIds: nextState.pinnedIds ?? current.pinnedIds,
  });

  if (sameShelfState(current, next)) {
    return current;
  }

  return writeShelfState(kind, next);
}

export function useOpenResourceShelf(kind: OpenResourceKind) {
  const [state, setState] = useState(() => readOpenResourceShelf(kind));

  useEffect(() => {
    function handleShelvesChanged(event: Event) {
      const detail = (event as CustomEvent<{ kind?: OpenResourceKind; state?: OpenResourceShelfState }>).detail;
      if (detail?.kind === kind && detail.state) {
        setState(detail.state);
        return;
      }

      setState(readOpenResourceShelf(kind));
    }

    window.addEventListener(OPEN_RESOURCE_SHELVES_CHANGED_EVENT, handleShelvesChanged);
    return () => window.removeEventListener(OPEN_RESOURCE_SHELVES_CHANGED_EVENT, handleShelvesChanged);
  }, [kind]);

  return {
    ...state,
    ensureOpen: (id: string | null | undefined) => setState(ensureOpenResourceShelfItem(kind, id)),
    closeOpen: (id: string | null | undefined) => setState(closeOpenResourceShelfItem(kind, id)),
    pinOpen: (id: string | null | undefined) => setState(pinOpenResourceShelfItem(kind, id)),
    unpinOpen: (id: string | null | undefined, options?: { open?: boolean }) => setState(unpinOpenResourceShelfItem(kind, id, options)),
  };
}
