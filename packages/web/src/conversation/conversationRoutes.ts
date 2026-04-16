import { DRAFT_CONVERSATION_ID, DRAFT_CONVERSATION_ROUTE } from '../conversation/draftConversation';

const DEFAULT_CONVERSATIONS_REDIRECT_PATH = DRAFT_CONVERSATION_ROUTE;

function normalizeConversationId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized === DRAFT_CONVERSATION_ID) {
    return null;
  }

  return normalized;
}

function normalizeConversationSurfaceId(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  return normalized;
}

export function buildConversationPath(id: string): string {
  return `/conversations/${encodeURIComponent(id)}`;
}

export function buildConversationSurfacePath(id: string): string {
  return id === DRAFT_CONVERSATION_ID ? DRAFT_CONVERSATION_ROUTE : buildConversationPath(id);
}

export function buildConversationDeeplink(id: string, baseUrl: string): string {
  return new URL(buildConversationSurfacePath(id), baseUrl).toString();
}

export function resolveConversationIndexRedirect(input: {
  openIds?: Iterable<unknown>;
  pinnedIds?: Iterable<unknown>;
  hasDraft?: boolean;
}): string {
  for (const value of input.openIds ?? []) {
    const conversationId = normalizeConversationId(value);
    if (conversationId) {
      return buildConversationPath(conversationId);
    }
  }

  for (const value of input.pinnedIds ?? []) {
    const conversationId = normalizeConversationId(value);
    if (conversationId) {
      return buildConversationPath(conversationId);
    }
  }

  if (input.hasDraft) {
    return DRAFT_CONVERSATION_ROUTE;
  }

  return DEFAULT_CONVERSATIONS_REDIRECT_PATH;
}

export function resolveConversationAdjacentPath(input: {
  orderedIds?: Iterable<unknown>;
  activeId?: unknown;
  direction: -1 | 1;
}): string | null {
  const orderedIds = Array.from(input.orderedIds ?? [])
    .map((value) => normalizeConversationSurfaceId(value))
    .filter((value): value is string => Boolean(value));
  if (orderedIds.length === 0) {
    return null;
  }

  const activeId = normalizeConversationSurfaceId(input.activeId);
  if (!activeId) {
    return buildConversationSurfacePath(input.direction > 0 ? orderedIds[0] : orderedIds[orderedIds.length - 1]);
  }

  const activeIndex = orderedIds.findIndex((value) => value === activeId);
  if (activeIndex === -1) {
    return buildConversationSurfacePath(input.direction > 0 ? orderedIds[0] : orderedIds[orderedIds.length - 1]);
  }

  const nextIndex = (activeIndex + input.direction + orderedIds.length) % orderedIds.length;
  return buildConversationSurfacePath(orderedIds[nextIndex]);
}

export function resolveConversationCloseRedirect(input: {
  orderedIds?: Iterable<unknown>;
  closingId?: unknown;
}): string {
  const closingId = normalizeConversationSurfaceId(input.closingId);
  if (!closingId) {
    return DEFAULT_CONVERSATIONS_REDIRECT_PATH;
  }

  const orderedIds = Array.from(input.orderedIds ?? [])
    .map((value) => normalizeConversationSurfaceId(value))
    .filter((value): value is string => Boolean(value));
  const closingIndex = orderedIds.findIndex((value) => value === closingId);
  if (closingIndex === -1) {
    return DEFAULT_CONVERSATIONS_REDIRECT_PATH;
  }

  const remainingIds = orderedIds.filter((value) => value !== closingId);
  if (remainingIds.length === 0) {
    return DEFAULT_CONVERSATIONS_REDIRECT_PATH;
  }

  return buildConversationSurfacePath(remainingIds[Math.min(closingIndex, remainingIds.length - 1)]);
}
