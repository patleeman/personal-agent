import {
  ARCHIVED_SESSION_IDS_STORAGE_KEY,
  OPEN_SESSION_IDS_STORAGE_KEY,
  PINNED_SESSION_IDS_STORAGE_KEY,
} from '../local/localSettings';
import { api } from '../client/api';

export const CONVERSATION_LAYOUT_CHANGED_EVENT = 'pa:conversation-layout-changed';

export type OpenConversationDropPosition = 'before' | 'after';
export type ConversationShelf = 'open' | 'pinned';

export interface ConversationLayout {
  sessionIds: string[];
  pinnedSessionIds: string[];
  archivedSessionIds: string[];
}

interface ConversationLayoutInput {
  sessionIds?: Iterable<unknown>;
  pinnedSessionIds?: Iterable<unknown>;
  archivedSessionIds?: Iterable<unknown>;
}

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

function normalizeConversationLayout(input: ConversationLayoutInput): ConversationLayout {
  const pinnedSessionIds = normalizeSessionIds(input.pinnedSessionIds ?? []);
  const pinnedIdSet = new Set(pinnedSessionIds);
  const sessionIds = normalizeSessionIds(input.sessionIds ?? []).filter((id) => !pinnedIdSet.has(id));
  const workspaceIdSet = new Set([...sessionIds, ...pinnedSessionIds]);
  const archivedSessionIds = normalizeSessionIds(input.archivedSessionIds ?? []).filter((id) => !workspaceIdSet.has(id));

  return {
    sessionIds,
    pinnedSessionIds,
    archivedSessionIds,
  };
}

function mergeConversationLayout(current: ConversationLayout, input: ConversationLayoutInput): ConversationLayout {
  return normalizeConversationLayout({
    sessionIds: input.sessionIds ?? current.sessionIds,
    pinnedSessionIds: input.pinnedSessionIds ?? current.pinnedSessionIds,
    archivedSessionIds: input.archivedSessionIds ?? current.archivedSessionIds,
  });
}

function listWorkspaceSessionIds(layout: ConversationLayout): string[] {
  return [...layout.pinnedSessionIds, ...layout.sessionIds];
}

function applyArchiveTransitions(current: ConversationLayout, next: ConversationLayout): ConversationLayout {
  const currentWorkspaceIdSet = new Set(listWorkspaceSessionIds(current));
  const nextWorkspaceIdSet = new Set(listWorkspaceSessionIds(next));
  const archivedSessionIds = new Set(next.archivedSessionIds);

  for (const sessionId of nextWorkspaceIdSet) {
    archivedSessionIds.delete(sessionId);
  }

  for (const sessionId of currentWorkspaceIdSet) {
    if (!nextWorkspaceIdSet.has(sessionId)) {
      archivedSessionIds.add(sessionId);
    }
  }

  return normalizeConversationLayout({
    sessionIds: next.sessionIds,
    pinnedSessionIds: next.pinnedSessionIds,
    archivedSessionIds: [...archivedSessionIds],
  });
}

function sameSessionIds(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((id, index) => id === right[index]);
}

function sameConversationLayout(left: ConversationLayout, right: ConversationLayout): boolean {
  return sameSessionIds(left.sessionIds, right.sessionIds)
    && sameSessionIds(left.pinnedSessionIds, right.pinnedSessionIds)
    && sameSessionIds(left.archivedSessionIds, right.archivedSessionIds);
}

function persistConversationLayoutToServer(layout: ConversationLayout): void {
  void api.setOpenConversationTabs(
    layout.sessionIds,
    layout.pinnedSessionIds,
    layout.archivedSessionIds,
  ).catch(() => {
    // Ignore best-effort sync failures.
  });
}

function readStoredSessionIds(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
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

export function readConversationLayout(): ConversationLayout {
  return normalizeConversationLayout({
    sessionIds: readStoredSessionIds(OPEN_SESSION_IDS_STORAGE_KEY),
    pinnedSessionIds: readStoredSessionIds(PINNED_SESSION_IDS_STORAGE_KEY),
    archivedSessionIds: readStoredSessionIds(ARCHIVED_SESSION_IDS_STORAGE_KEY),
  });
}

export function readOpenSessionIds(): string[] {
  return readConversationLayout().sessionIds;
}

export function readPinnedSessionIds(): string[] {
  return readConversationLayout().pinnedSessionIds;
}

export function readArchivedSessionIds(): string[] {
  return readConversationLayout().archivedSessionIds;
}

function writeStoredSessionIds(storageKey: string, sessionIds: readonly string[]): void {
  try {
    if (sessionIds.length > 0) {
      localStorage.setItem(storageKey, JSON.stringify(sessionIds));
    } else {
      localStorage.removeItem(storageKey);
    }
  } catch {
    // Ignore storage write failures.
  }
}

function writeConversationLayout(layout: ConversationLayout): ConversationLayout {
  const normalizedLayout = normalizeConversationLayout(layout);

  writeStoredSessionIds(OPEN_SESSION_IDS_STORAGE_KEY, normalizedLayout.sessionIds);
  writeStoredSessionIds(PINNED_SESSION_IDS_STORAGE_KEY, normalizedLayout.pinnedSessionIds);
  writeStoredSessionIds(ARCHIVED_SESSION_IDS_STORAGE_KEY, normalizedLayout.archivedSessionIds);
  persistConversationLayoutToServer(normalizedLayout);
  window.dispatchEvent(new CustomEvent(CONVERSATION_LAYOUT_CHANGED_EVENT, {
    detail: normalizedLayout,
  }));

  return normalizedLayout;
}

export function replaceConversationLayout(layout: ConversationLayoutInput): ConversationLayout {
  const current = readConversationLayout();
  const merged = mergeConversationLayout(current, layout);
  const next = applyArchiveTransitions(current, merged);
  if (sameConversationLayout(current, next)) {
    return current;
  }

  return writeConversationLayout(next);
}

export function ensureConversationTabOpen(sessionId: string | null | undefined): string[] {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const layout = readConversationLayout();
  if (!normalizedSessionId || layout.pinnedSessionIds.includes(normalizedSessionId) || layout.sessionIds.includes(normalizedSessionId)) {
    return layout.sessionIds;
  }

  return writeConversationLayout({
    ...layout,
    sessionIds: [...layout.sessionIds, normalizedSessionId],
  }).sessionIds;
}

export function openConversationTab(sessionId: string): string[] {
  return ensureConversationTabOpen(sessionId);
}

export function closeConversationTab(sessionId: string): string[] {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const current = readConversationLayout();
  const nextSessionIds = current.sessionIds.filter((id) => id !== normalizedSessionId);
  if (nextSessionIds.length === current.sessionIds.length) {
    return current.sessionIds;
  }

  return replaceConversationLayout({
    sessionIds: nextSessionIds,
    pinnedSessionIds: current.pinnedSessionIds,
  }).sessionIds;
}

export function setConversationArchivedState(sessionId: string, archived: boolean): ConversationLayout {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const current = readConversationLayout();
  if (!normalizedSessionId) {
    return current;
  }

  const nextPinnedSessionIds = current.pinnedSessionIds.filter((id) => id !== normalizedSessionId);
  const openWithoutSession = current.sessionIds.filter((id) => id !== normalizedSessionId);
  const archivedWithoutSession = current.archivedSessionIds.filter((id) => id !== normalizedSessionId);
  const nextSessionIds = archived
    ? openWithoutSession
    : [...openWithoutSession, normalizedSessionId];
  const nextArchivedSessionIds = archived
    ? [...archivedWithoutSession, normalizedSessionId]
    : archivedWithoutSession;

  return replaceConversationLayout({
    sessionIds: nextSessionIds,
    pinnedSessionIds: nextPinnedSessionIds,
    archivedSessionIds: nextArchivedSessionIds,
  });
}

export function reopenMostRecentlyArchivedConversation(): {
  reopenedSessionId: string | null;
  layout: ConversationLayout;
} {
  const current = readConversationLayout();
  const reopenedSessionId = current.archivedSessionIds.at(-1) ?? null;
  if (!reopenedSessionId) {
    return { reopenedSessionId: null, layout: current };
  }

  return {
    reopenedSessionId,
    layout: setConversationArchivedState(reopenedSessionId, false),
  };
}

export function pinConversationTab(sessionId: string): ConversationLayout {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const current = readConversationLayout();
  if (!normalizedSessionId) {
    return current;
  }

  const firstPinnedSessionId = current.pinnedSessionIds.find((id) => id !== normalizedSessionId) ?? null;
  return moveConversationTab(normalizedSessionId, 'pinned', firstPinnedSessionId, 'before');
}

export function unpinConversationTab(
  sessionId: string,
  options: { open?: boolean } = {},
): ConversationLayout {
  const normalizedSessionId = normalizeSessionId(sessionId);
  const current = readConversationLayout();
  const nextPinnedSessionIds = current.pinnedSessionIds.filter((id) => id !== normalizedSessionId);

  if (nextPinnedSessionIds.length === current.pinnedSessionIds.length) {
    return current;
  }

  const nextSessionIds = options.open === false || current.sessionIds.includes(normalizedSessionId)
    ? current.sessionIds
    : [...current.sessionIds, normalizedSessionId];

  return replaceConversationLayout({
    sessionIds: nextSessionIds,
    pinnedSessionIds: nextPinnedSessionIds,
  });
}

export function moveConversationToSection(
  layout: ConversationLayout,
  draggedSessionId: string,
  targetSection: ConversationShelf,
  targetSessionId?: string | null,
  position: OpenConversationDropPosition = 'after',
): ConversationLayout {
  const normalizedLayout = normalizeConversationLayout(layout);
  const draggedId = normalizeSessionId(draggedSessionId);

  if (!draggedId) {
    return normalizedLayout;
  }

  const nextSessionIds = normalizedLayout.sessionIds.filter((id) => id !== draggedId);
  const nextPinnedSessionIds = normalizedLayout.pinnedSessionIds.filter((id) => id !== draggedId);
  const targetIds = targetSection === 'open' ? nextSessionIds : nextPinnedSessionIds;
  const normalizedTargetId = normalizeSessionId(targetSessionId);

  if (!normalizedTargetId) {
    targetIds.push(draggedId);
    return normalizeConversationLayout({
      sessionIds: nextSessionIds,
      pinnedSessionIds: nextPinnedSessionIds,
      archivedSessionIds: normalizedLayout.archivedSessionIds,
    });
  }

  const targetIndex = targetIds.indexOf(normalizedTargetId);
  if (targetIndex === -1) {
    targetIds.push(draggedId);
    return normalizeConversationLayout({
      sessionIds: nextSessionIds,
      pinnedSessionIds: nextPinnedSessionIds,
      archivedSessionIds: normalizedLayout.archivedSessionIds,
    });
  }

  const insertIndex = position === 'before' ? targetIndex : targetIndex + 1;
  targetIds.splice(insertIndex, 0, draggedId);
  return normalizeConversationLayout({
    sessionIds: nextSessionIds,
    pinnedSessionIds: nextPinnedSessionIds,
    archivedSessionIds: normalizedLayout.archivedSessionIds,
  });
}

export function moveConversationTab(
  sessionId: string,
  targetSection: ConversationShelf,
  targetSessionId?: string | null,
  position: OpenConversationDropPosition = 'after',
): ConversationLayout {
  const current = readConversationLayout();
  const next = moveConversationToSection(current, sessionId, targetSection, targetSessionId, position);
  if (sameConversationLayout(current, next)) {
    return current;
  }

  return writeConversationLayout(next);
}

export function shiftConversationTab(sessionId: string, direction: -1 | 1): ConversationLayout {
  const normalizedSessionId = normalizeSessionId(sessionId);
  if (!normalizedSessionId) {
    return readConversationLayout();
  }

  const current = readConversationLayout();
  const pinnedIndex = current.pinnedSessionIds.indexOf(normalizedSessionId);
  if (pinnedIndex !== -1) {
    const targetIndex = pinnedIndex + direction;
    const targetSessionId = current.pinnedSessionIds[targetIndex];
    if (!targetSessionId) {
      return current;
    }

    return moveConversationTab(
      normalizedSessionId,
      'pinned',
      targetSessionId,
      direction < 0 ? 'before' : 'after',
    );
  }

  const openIndex = current.sessionIds.indexOf(normalizedSessionId);
  if (openIndex === -1) {
    return current;
  }

  const targetSessionId = current.sessionIds[openIndex + direction];
  if (!targetSessionId) {
    return current;
  }

  return moveConversationTab(
    normalizedSessionId,
    'open',
    targetSessionId,
    direction < 0 ? 'before' : 'after',
  );
}
