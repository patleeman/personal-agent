import { DRAFT_CONVERSATION_ID, DRAFT_CONVERSATION_ROUTE } from './draftConversation';

const DEFAULT_CONVERSATIONS_REDIRECT_PATH = '/workspace/files';

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

export function buildConversationPath(id: string): string {
  return `/conversations/${encodeURIComponent(id)}`;
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
