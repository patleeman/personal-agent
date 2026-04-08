import { DRAFT_CONVERSATION_ID, DRAFT_CONVERSATION_ROUTE } from './draftConversation';

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

function buildConversationSurfacePath(id: string): string {
  return id === DRAFT_CONVERSATION_ID ? DRAFT_CONVERSATION_ROUTE : buildConversationPath(id);
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
