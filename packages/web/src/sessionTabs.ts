import { OPEN_SESSION_IDS_STORAGE_KEY } from './localSettings';

export const OPEN_SESSIONS_CHANGED_EVENT = 'pa:open-sessions-changed';

export type OpenConversationDropPosition = 'before' | 'after';

function normalizeSessionId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSessionIds(values: Iterable<unknown>): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeSessionId(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ids.push(normalized);
  }

  return ids;
}

function sameSessionIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((id, index) => id === right[index]);
}

function persistOpenSessionIdsToServer(sessionIds: string[]): void {
  if (typeof fetch !== 'function') {
    return;
  }

  void fetch('/api/web-ui/open-conversations', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionIds }),
  }).catch(() => {
    // Ignore best-effort sync failures.
  });
}

export function syncOpenConversationTabsToServer(ids: Iterable<unknown>): void {
  persistOpenSessionIdsToServer(normalizeSessionIds(ids));
}

export function readOpenSessionIds(): string[] {
  try {
    const raw = localStorage.getItem(OPEN_SESSION_IDS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return normalizeSessionIds(parsed);
      }
    }
  } catch {
    // Ignore malformed storage.
  }

  return [];
}

function writeOpenSessionIds(ids: Iterable<unknown>): string[] {
  const normalizedIds = normalizeSessionIds(ids);

  try {
    localStorage.setItem(OPEN_SESSION_IDS_STORAGE_KEY, JSON.stringify(normalizedIds));
  } catch {
    // Ignore storage write failures.
  }

  persistOpenSessionIdsToServer(normalizedIds);
  window.dispatchEvent(new CustomEvent(OPEN_SESSIONS_CHANGED_EVENT, {
    detail: { ids: normalizedIds },
  }));

  return normalizedIds;
}

export function replaceOpenConversationTabs(sessionIds: Iterable<unknown>): string[] {
  const next = normalizeSessionIds(sessionIds);
  const current = readOpenSessionIds();
  if (sameSessionIds(current, next)) {
    return current;
  }

  return writeOpenSessionIds(next);
}

export function ensureConversationTabOpen(sessionId: string | null | undefined): string[] {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const next = readOpenSessionIds();
  if (!normalizedSessionId || next.includes(normalizedSessionId)) {
    return next;
  }

  return writeOpenSessionIds([...next, normalizedSessionId]);
}

export function openConversationTab(sessionId: string): string[] {
  return ensureConversationTabOpen(sessionId);
}

export function closeConversationTab(sessionId: string): string[] {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const current = readOpenSessionIds();
  const next = current.filter((id) => id !== normalizedSessionId);
  if (next.length === current.length) {
    return current;
  }

  return writeOpenSessionIds(next);
}

export function reorderOpenSessionIds(
  sessionIds: readonly string[],
  draggedSessionId: string,
  targetSessionId: string,
  position: OpenConversationDropPosition,
): string[] {
  const normalizedSessionIds = normalizeSessionIds(sessionIds);
  const draggedId = normalizeSessionId(draggedSessionId);
  const targetId = normalizeSessionId(targetSessionId);

  if (!draggedId || !targetId || draggedId === targetId) {
    return normalizedSessionIds;
  }

  if (!normalizedSessionIds.includes(draggedId) || !normalizedSessionIds.includes(targetId)) {
    return normalizedSessionIds;
  }

  const reordered = normalizedSessionIds.filter((id) => id !== draggedId);
  const targetIndex = reordered.indexOf(targetId);
  if (targetIndex === -1) {
    return normalizedSessionIds;
  }

  const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
  reordered.splice(insertIndex, 0, draggedId);
  return reordered;
}
