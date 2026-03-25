/**
 * Arc-style tab model:
 *   - pinnedIds               (localStorage + settings) = conversations always visible above open tabs
 *   - openIds                 (localStorage + settings) = active workspace tabs below the pinned shelf
 *   - archivedConversationIds (localStorage + settings) = conversations explicitly archived out of live/review focus
 *   - archivedSessions        = all other sessions, restored on demand
 *
 * Restoring an archived conversation calls openSession() → adds to openIds → tab appears.
 * × on an open tab calls closeSession() → removed from openIds → back to the archive.
 * Pinning removes a conversation from openIds and keeps it in the pinned shelf instead.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { LiveTitlesContext, useAppData, useSseConnection } from '../contexts';
import { NEW_CONVERSATION_TITLE, normalizeConversationTitle } from '../conversationTitle';
import { fetchSessionsSnapshot } from '../sessionSnapshot';
import {
  closeConversationTab,
  moveConversationTab,
  OPEN_SESSIONS_CHANGED_EVENT,
  openConversationTab,
  pinConversationTab,
  readArchivedSessionIds,
  readConversationLayout,
  readOpenSessionIds,
  readPinnedSessionIds,
  replaceConversationLayout,
  syncOpenConversationTabsToServer,
  type ConversationLayout,
  type ConversationShelf,
  type OpenConversationDropPosition,
  unpinConversationTab,
} from '../sessionTabs';
import type { SessionMeta } from '../types';
import { resolveSessionLineageAutoOpen } from '../sessionLineage';

function applyLayoutState(layout: ConversationLayout, setters: {
  setOpenIds: (ids: string[]) => void;
  setPinnedIds: (ids: string[]) => void;
  setArchivedConversationIds: (ids: string[]) => void;
}) {
  setters.setOpenIds(layout.sessionIds);
  setters.setPinnedIds(layout.pinnedSessionIds);
  setters.setArchivedConversationIds(layout.archivedSessionIds);
}

function buildPlaceholderSessionMeta(id: string, title?: string): SessionMeta {
  return {
    id,
    file: '',
    timestamp: new Date(0).toISOString(),
    cwd: '',
    cwdSlug: '',
    model: '',
    title: title ?? 'Connecting…',
    messageCount: 0,
    isRunning: false,
  };
}

export function useConversations() {
  const [openIds, setOpenIds] = useState(() => readOpenSessionIds());
  const [pinnedIds, setPinnedIds] = useState(() => readPinnedSessionIds());
  const [archivedConversationIds, setArchivedConversationIds] = useState(() => readArchivedSessionIds());
  const { titles: liveTitles } = useContext(LiveTitlesContext);
  const { sessions, runs, setSessions } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const knownSessionIdsRef = useRef<string[] | null>(null);
  const pendingChildSessionIdsRef = useRef<string[]>([]);

  useEffect(() => {
    function handleConversationLayoutChanged() {
      const layout = readConversationLayout();
      applyLayoutState(layout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
    }

    window.addEventListener(OPEN_SESSIONS_CHANGED_EVENT, handleConversationLayoutChanged);
    return () => window.removeEventListener(OPEN_SESSIONS_CHANGED_EVENT, handleConversationLayoutChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localLayout = readConversationLayout();

    if (localLayout.sessionIds.length > 0 || localLayout.pinnedSessionIds.length > 0 || localLayout.archivedSessionIds.length > 0) {
      syncOpenConversationTabsToServer(localLayout.sessionIds, localLayout.pinnedSessionIds, localLayout.archivedSessionIds);
      return;
    }

    void api.openConversationTabs()
      .then(({ sessionIds, pinnedSessionIds, archivedSessionIds }) => {
        if (cancelled || (sessionIds.length === 0 && pinnedSessionIds.length === 0 && archivedSessionIds.length === 0)) {
          return;
        }

        const currentLayout = readConversationLayout();
        if (currentLayout.sessionIds.length > 0 || currentLayout.pinnedSessionIds.length > 0 || currentLayout.archivedSessionIds.length > 0) {
          return;
        }

        const nextLayout = replaceConversationLayout({ sessionIds, pinnedSessionIds, archivedSessionIds });
        applyLayoutState(nextLayout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
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
    setArchivedConversationIds(readArchivedSessionIds());
  }, []);

  const closeSession = useCallback((id: string) => {
    setOpenIds(closeConversationTab(id));
    setPinnedIds(readPinnedSessionIds());
    setArchivedConversationIds(readArchivedSessionIds());
  }, []);

  const pinSession = useCallback((id: string) => {
    const nextLayout = pinConversationTab(id);
    applyLayoutState(nextLayout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
  }, []);

  const unpinSession = useCallback((id: string, options: { open?: boolean } = {}) => {
    const nextLayout = unpinConversationTab(id, options);
    applyLayoutState(nextLayout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
  }, []);

  const moveSession = useCallback((
    sessionId: string,
    targetSection: ConversationShelf,
    targetSessionId?: string | null,
    position?: OpenConversationDropPosition,
  ) => {
    const nextLayout = moveConversationTab(sessionId, targetSection, targetSessionId, position);
    applyLayoutState(nextLayout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
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
    applyLayoutState(nextLayout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
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
    () => pinnedIds.map((id) => {
      const session = sessionsById.get(id);
      if (session) {
        return session;
      }

      return buildPlaceholderSessionMeta(id, normalizeConversationTitle(liveTitles.get(id)) ?? 'Connecting…');
    }),
    [liveTitles, pinnedIds, sessionsById],
  );
  const tabs = useMemo(
    () => openIds.map((id) => {
      const session = sessionsById.get(id);
      if (session) {
        return session;
      }

      return buildPlaceholderSessionMeta(id, normalizeConversationTitle(liveTitles.get(id)) ?? 'Connecting…');
    }),
    [liveTitles, openIds, sessionsById],
  );
  const archivedSessions = useMemo(
    () => withTitles.filter((session) => !openIdSet.has(session.id) && !pinnedIdSet.has(session.id)),
    [openIdSet, pinnedIdSet, withTitles],
  );
  const loading = sessions === null && (sseStatus === 'connecting' || sseStatus === 'reconnecting');

  return {
    pinnedIds,
    openIds,
    archivedConversationIds,
    pinnedSessions,
    tabs,
    archivedSessions,
    openSession,
    closeSession,
    pinSession,
    unpinSession,
    moveSession,
    loading,
    refetch,
  };
}
