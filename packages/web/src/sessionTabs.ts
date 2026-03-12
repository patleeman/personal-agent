import { OPEN_SESSION_IDS_STORAGE_KEY } from './localSettings';

export const OPEN_SESSIONS_CHANGED_EVENT = 'pa:open-sessions-changed';

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

function sameSessionIds(left: Set<string>, right: Set<string>): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const id of left) {
    if (!right.has(id)) {
      return false;
    }
  }

  return true;
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

export function readOpenSessionIds(): Set<string> {
  try {
    const raw = localStorage.getItem(OPEN_SESSION_IDS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return new Set(normalizeSessionIds(parsed));
      }
    }
  } catch {
    // Ignore malformed storage.
  }

  return new Set<string>();
}

function writeOpenSessionIds(ids: Set<string>): void {
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
}

export function replaceOpenConversationTabs(sessionIds: Iterable<unknown>): Set<string> {
  const next = new Set(normalizeSessionIds(sessionIds));
  const current = readOpenSessionIds();
  if (sameSessionIds(current, next)) {
    return current;
  }

  writeOpenSessionIds(next);
  return next;
}

export function ensureConversationTabOpen(sessionId: string | null | undefined): Set<string> {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const next = readOpenSessionIds();
  if (!normalizedSessionId || next.has(normalizedSessionId)) {
    return next;
  }

  next.add(normalizedSessionId);
  writeOpenSessionIds(next);
  return next;
}

export function openConversationTab(sessionId: string): Set<string> {
  return ensureConversationTabOpen(sessionId);
}

export function closeConversationTab(sessionId: string): Set<string> {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const next = readOpenSessionIds();
  if (!normalizedSessionId || !next.has(normalizedSessionId)) {
    return next;
  }

  next.delete(normalizedSessionId);
  writeOpenSessionIds(next);
  return next;
}
