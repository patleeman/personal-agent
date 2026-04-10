import { listConversationSessionsSnapshot, readConversationSessionMeta } from './conversationService.js';
import { readSessionSearchText } from './sessions.js';

export function readConversationSessionsCapability() {
  return listConversationSessionsSnapshot();
}

export function readConversationSessionMetaCapability(sessionId: string) {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    return null;
  }

  return readConversationSessionMeta(normalizedSessionId);
}

export function readConversationSessionSearchIndexCapability(input: { sessionIds?: unknown } = {}) {
  const rawSessionIds = Array.isArray(input.sessionIds) ? input.sessionIds : [];
  const sessionIds = rawSessionIds
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (sessionIds.length === 0) {
    return { index: {} as Record<string, string> };
  }

  const index: Record<string, string> = {};
  for (const sessionId of sessionIds) {
    const searchText = readSessionSearchText(sessionId);
    index[sessionId] = typeof searchText === 'string' ? searchText : '';
  }

  return { index };
}
