/**
 * Arc-style tab model:
 *   - openIds           (localStorage) = sessions promoted to visible tabs
 *   - archivedSessions  = all other sessions, restored on demand
 *
 * Restoring an archived conversation calls openSession() → adds to openIds → tab appears.
 * × on an open tab calls closeSession() → removed from openIds → back to the archive.
 */
import { useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../api';
import { LiveTitlesContext, useAppData, useSseConnection } from '../contexts';
import { NEW_CONVERSATION_TITLE, normalizeConversationTitle } from '../conversationTitle';
import { applyLiveSessionState, buildSyntheticLiveSessionMeta } from '../sessionIndicators';
import {
  closeConversationTab,
  OPEN_SESSIONS_CHANGED_EVENT,
  openConversationTab,
  readOpenSessionIds,
  replaceOpenConversationTabs,
  syncOpenConversationTabsToServer,
} from '../sessionTabs';
import type { SessionMeta } from '../types';

async function fetchSessionsSnapshot(): Promise<SessionMeta[]> {
  const [jsonl, live] = await Promise.all([api.sessions(), api.liveSessions()]);
  const jsonlIds = new Set(jsonl.map((session) => session.id));
  const syntheticLive: SessionMeta[] = live
    .filter((entry) => !jsonlIds.has(entry.id))
    .map((entry) => buildSyntheticLiveSessionMeta(entry));

  return [...syntheticLive, ...applyLiveSessionState(jsonl, live)];
}

export function useConversations() {
  const [openIds, setOpenIds] = useState<Set<string>>(readOpenSessionIds);
  const { titles: liveTitles } = useContext(LiveTitlesContext);
  const { sessions, setSessions } = useAppData();
  const { status: sseStatus } = useSseConnection();

  useEffect(() => {
    function handleOpenSessionsChanged() {
      setOpenIds(readOpenSessionIds());
    }

    window.addEventListener(OPEN_SESSIONS_CHANGED_EVENT, handleOpenSessionsChanged);
    return () => window.removeEventListener(OPEN_SESSIONS_CHANGED_EVENT, handleOpenSessionsChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localOpenIds = readOpenSessionIds();

    if (localOpenIds.size > 0) {
      syncOpenConversationTabsToServer(localOpenIds);
      return;
    }

    void api.openConversationTabs()
      .then(({ sessionIds }) => {
        if (cancelled || sessionIds.length === 0) {
          return;
        }

        if (readOpenSessionIds().size > 0) {
          return;
        }

        setOpenIds(replaceOpenConversationTabs(sessionIds));
      })
      .catch(() => {
        // Ignore bootstrap failures and keep the browser-local fallback.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const refetch = useCallback(async () => {
    const next = await fetchSessionsSnapshot();
    setSessions(next);
    return next;
  }, [setSessions]);

  const openSession = useCallback((id: string) => {
    setOpenIds(openConversationTab(id));
  }, []);

  const closeSession = useCallback((id: string) => {
    setOpenIds(closeConversationTab(id));
  }, []);

  const withTitles = (sessions ?? []).map((session) => {
    const liveTitle = normalizeConversationTitle(liveTitles.get(session.id));
    const sessionTitle = normalizeConversationTitle(session.title) ?? NEW_CONVERSATION_TITLE;
    const title = liveTitle ?? sessionTitle;

    return title === session.title ? session : { ...session, title };
  });
  const tabs = withTitles.filter((session) => openIds.has(session.id));
  const archivedSessions = withTitles.filter((session) => !openIds.has(session.id));
  const loading = sessions === null && (sseStatus === 'connecting' || sseStatus === 'reconnecting');

  return { tabs, archivedSessions, openSession, closeSession, loading, refetch };
}
