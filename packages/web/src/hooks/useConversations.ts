/**
 * Arc-style tab model:
 *   - pinnedIds         (localStorage + settings) = conversations always visible above open tabs
 *   - openIds           (localStorage + settings) = active workspace tabs below the pinned shelf
 *   - archivedSessions  = all other sessions, restored on demand
 *
 * Restoring an archived conversation calls openSession() → adds to openIds → tab appears.
 * × on an open tab calls closeSession() → removed from openIds → back to the archive.
 * Pinning removes a conversation from openIds and keeps it in the pinned shelf instead.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { LiveTitlesContext, useAppData, useSseConnection } from '../contexts';
import { NEW_CONVERSATION_TITLE, normalizeConversationTitle } from '../conversationTitle';
import { applyLiveSessionState, buildSyntheticLiveSessionMeta } from '../sessionIndicators';
import {
  closeConversationTab,
  moveConversationTab,
  OPEN_SESSIONS_CHANGED_EVENT,
  openConversationTab,
  pinConversationTab,
  readConversationLayout,
  readOpenSessionIds,
  readPinnedSessionIds,
  replaceConversationLayout,
  replaceOpenConversationTabs,
  replacePinnedConversationTabs,
  syncOpenConversationTabsToServer,
  type ConversationLayout,
  type ConversationShelf,
  type OpenConversationDropPosition,
  unpinConversationTab,
} from '../sessionTabs';
import type { SessionMeta } from '../types';
import { resolveSessionLineageAutoOpen } from '../sessionLineage';

async function fetchSessionsSnapshot(): Promise<SessionMeta[]> {
  const [jsonl, live] = await Promise.all([api.sessions(), api.liveSessions()]);
  const jsonlIds = new Set(jsonl.map((session) => session.id));
  const syntheticLive: SessionMeta[] = live
    .filter((entry) => !jsonlIds.has(entry.id))
    .map((entry) => buildSyntheticLiveSessionMeta(entry));

  return [...syntheticLive, ...applyLiveSessionState(jsonl, live)];
}

function applyLayoutState(layout: ConversationLayout, setters: {
  setOpenIds: (ids: string[]) => void;
  setPinnedIds: (ids: string[]) => void;
}) {
  setters.setOpenIds(layout.sessionIds);
  setters.setPinnedIds(layout.pinnedSessionIds);
}

export function useConversations() {
  const [openIds, setOpenIds] = useState(() => readOpenSessionIds());
  const [pinnedIds, setPinnedIds] = useState(() => readPinnedSessionIds());
  const { titles: liveTitles } = useContext(LiveTitlesContext);
  const { sessions, runs, setSessions } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const knownSessionIdsRef = useRef<string[] | null>(null);
  const pendingChildSessionIdsRef = useRef<string[]>([]);

  useEffect(() => {
    function handleConversationLayoutChanged() {
      const layout = readConversationLayout();
      applyLayoutState(layout, { setOpenIds, setPinnedIds });
    }

    window.addEventListener(OPEN_SESSIONS_CHANGED_EVENT, handleConversationLayoutChanged);
    return () => window.removeEventListener(OPEN_SESSIONS_CHANGED_EVENT, handleConversationLayoutChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localLayout = readConversationLayout();

    if (localLayout.sessionIds.length > 0 || localLayout.pinnedSessionIds.length > 0) {
      syncOpenConversationTabsToServer(localLayout.sessionIds, localLayout.pinnedSessionIds);
      return;
    }

    void api.openConversationTabs()
      .then(({ sessionIds, pinnedSessionIds }) => {
        if (cancelled || (sessionIds.length === 0 && pinnedSessionIds.length === 0)) {
          return;
        }

        const currentLayout = readConversationLayout();
        if (currentLayout.sessionIds.length > 0 || currentLayout.pinnedSessionIds.length > 0) {
          return;
        }

        const nextLayout = replaceConversationLayout({ sessionIds, pinnedSessionIds });
        applyLayoutState(nextLayout, { setOpenIds, setPinnedIds });
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
    setPinnedIds(readPinnedSessionIds());
  }, []);

  const closeSession = useCallback((id: string) => {
    setOpenIds(closeConversationTab(id));
    setPinnedIds(readPinnedSessionIds());
  }, []);

  const pinSession = useCallback((id: string) => {
    const nextLayout = pinConversationTab(id);
    applyLayoutState(nextLayout, { setOpenIds, setPinnedIds });
  }, []);

  const unpinSession = useCallback((id: string, options: { open?: boolean } = {}) => {
    const nextLayout = unpinConversationTab(id, options);
    applyLayoutState(nextLayout, { setOpenIds, setPinnedIds });
  }, []);

  const reorderSessions = useCallback((ids: string[]) => {
    setOpenIds(replaceOpenConversationTabs(ids));
    setPinnedIds(readPinnedSessionIds());
  }, []);

  const reorderPinnedSessions = useCallback((ids: string[]) => {
    setPinnedIds(replacePinnedConversationTabs(ids));
    setOpenIds(readOpenSessionIds());
  }, []);

  const moveSession = useCallback((
    sessionId: string,
    targetSection: ConversationShelf,
    targetSessionId?: string | null,
    position?: OpenConversationDropPosition,
  ) => {
    const nextLayout = moveConversationTab(sessionId, targetSection, targetSessionId, position);
    applyLayoutState(nextLayout, { setOpenIds, setPinnedIds });
  }, []);

  const runsById = useMemo(
    () => new Map((runs?.runs ?? []).map((run) => [run.runId, run] as const)),
    [runs],
  );

  useEffect(() => {
    if (!sessions) {
      return;
    }

    const currentSessionIds = sessions.map((session) => session.id);
    if (knownSessionIdsRef.current === null) {
      knownSessionIdsRef.current = currentSessionIds;
      pendingChildSessionIdsRef.current = [];
      return;
    }

    const result = resolveSessionLineageAutoOpen({
      sessions,
      runsById,
      openIds,
      pinnedIds,
      knownSessionIds: knownSessionIdsRef.current,
      pendingSessionIds: pendingChildSessionIdsRef.current,
    });

    knownSessionIdsRef.current = result.nextKnownSessionIds;
    pendingChildSessionIdsRef.current = result.nextPendingSessionIds;

    if (!result.changed) {
      return;
    }

    const nextLayout = replaceConversationLayout({
      sessionIds: result.nextOpenIds,
      pinnedSessionIds: result.nextPinnedIds,
    });
    applyLayoutState(nextLayout, { setOpenIds, setPinnedIds });
  }, [openIds, pinnedIds, runsById, sessions]);

  const withTitles = (sessions ?? []).map((session) => {
    const liveTitle = normalizeConversationTitle(liveTitles.get(session.id));
    const sessionTitle = normalizeConversationTitle(session.title) ?? NEW_CONVERSATION_TITLE;
    const title = liveTitle ?? sessionTitle;

    return title === session.title ? session : { ...session, title };
  });
  const openIdSet = useMemo(() => new Set(openIds), [openIds]);
  const pinnedIdSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const sessionsById = useMemo(
    () => new Map(withTitles.map((session) => [session.id, session] satisfies [string, SessionMeta])),
    [withTitles],
  );
  const pinnedSessions = useMemo(
    () => pinnedIds
      .map((id) => sessionsById.get(id))
      .filter((session): session is SessionMeta => Boolean(session)),
    [pinnedIds, sessionsById],
  );
  const tabs = useMemo(
    () => openIds
      .map((id) => sessionsById.get(id))
      .filter((session): session is SessionMeta => Boolean(session)),
    [openIds, sessionsById],
  );
  const archivedSessions = useMemo(
    () => withTitles.filter((session) => !openIdSet.has(session.id) && !pinnedIdSet.has(session.id)),
    [openIdSet, pinnedIdSet, withTitles],
  );
  const loading = sessions === null && (sseStatus === 'connecting' || sseStatus === 'reconnecting');

  return {
    pinnedIds,
    openIds,
    pinnedSessions,
    tabs,
    archivedSessions,
    openSession,
    closeSession,
    pinSession,
    unpinSession,
    reorderSessions,
    reorderPinnedSessions,
    moveSession,
    loading,
    refetch,
  };
}
