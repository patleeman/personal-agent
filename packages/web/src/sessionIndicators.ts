import { NEW_CONVERSATION_TITLE, normalizeConversationTitle } from './conversationTitle';
import type { ActivityEntry, LiveSessionMeta, SessionMeta } from './types';

export function buildSyntheticLiveSessionMeta(
  liveSession: Pick<LiveSessionMeta, 'id' | 'cwd' | 'sessionFile' | 'title' | 'isStreaming'>,
): SessionMeta {
  return {
    id: liveSession.id,
    file: liveSession.sessionFile,
    timestamp: new Date().toISOString(),
    cwd: liveSession.cwd,
    cwdSlug: liveSession.cwd.replace(/\//g, '-'),
    model: '',
    title: normalizeConversationTitle(liveSession.title) ?? NEW_CONVERSATION_TITLE,
    messageCount: 0,
    isRunning: liveSession.isStreaming,
  };
}

export function applyLiveSessionState(
  sessions: SessionMeta[],
  liveSessions: Array<Pick<LiveSessionMeta, 'id' | 'title' | 'isStreaming'>>,
): SessionMeta[] {
  const liveById = new Map(liveSessions.map((session) => [session.id, session]));

  return sessions.map((session) => {
    const liveSession = liveById.get(session.id);
    const isRunning = Boolean(liveSession?.isStreaming);
    const title = normalizeConversationTitle(liveSession?.title) ?? session.title;

    if (session.isRunning === isRunning && session.title === title) {
      return session;
    }

    return {
      ...session,
      title,
      isRunning,
    };
  });
}

export function collectAttentionConversationIds(entries: ActivityEntry[]): Set<string> {
  const ids = new Set<string>();

  for (const entry of entries) {
    if (entry.read || !entry.relatedConversationIds || entry.relatedConversationIds.length === 0) {
      continue;
    }

    for (const conversationId of entry.relatedConversationIds) {
      if (!conversationId) {
        continue;
      }

      ids.add(conversationId);
    }
  }

  return ids;
}

export function collectConversationAttentionIds(input: {
  sessions: SessionMeta[];
  unreadConversationIds?: ReadonlySet<string>;
  seenMessageCounts?: Record<string, number>;
  activeConversationId?: string | null;
}) {
  const ids = new Set(input.unreadConversationIds ?? []);

  for (const session of input.sessions) {
    if (session.id === input.activeConversationId || session.isRunning) {
      continue;
    }

    const seenMessageCount = input.seenMessageCounts?.[session.id];
    if (typeof seenMessageCount === 'number') {
      if (session.messageCount > seenMessageCount) {
        ids.add(session.id);
      }
      continue;
    }

    if (session.messageCount > 0) {
      ids.add(session.id);
    }
  }

  return ids;
}
