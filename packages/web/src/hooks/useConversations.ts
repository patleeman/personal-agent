/**
 * Arc-style tab model:
 *   - pinnedIds               (localStorage + settings) = conversations always visible above open tabs
 *   - openIds                 (localStorage + settings) = active workspace tabs below the pinned shelf
 *   - archivedConversationIds (localStorage + settings) = conversations explicitly archived out of live/review focus
 *   - archivedSessions        = all other sessions, restored on demand
 *
 * Restoring an archived conversation calls restoreSession() → removes archived state → tab appears.
 * Archive actions call archiveSession() → remove from pinned/open workspace → move into the archive.
 * Pinning removes a conversation from openIds and keeps it in the pinned shelf instead.
 */
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../client/api';
import { LiveTitlesContext, useAppData, useSseConnection } from '../app/contexts';
import { NEW_CONVERSATION_TITLE, normalizeConversationTitle } from '../conversation/conversationTitle';
import { fetchSessionsSnapshot } from '../session/sessionSnapshot';
import {
  closeConversationTab,
  moveConversationTab,
  CONVERSATION_LAYOUT_CHANGED_EVENT,
  openConversationTab,
  pinConversationTab,
  readArchivedSessionIds,
  readConversationLayout,
  readOpenSessionIds,
  readPinnedSessionIds,
  reopenMostRecentlyArchivedConversation,
  replaceConversationLayout,
  setConversationArchivedState,
  shiftConversationTab,
  type ConversationLayout,
  type ConversationShelf,
  type OpenConversationDropPosition,
  unpinConversationTab,
} from '../session/sessionTabs';
import type { SessionMeta } from '../shared/types';

const RUNNING_INDICATOR_GRACE_MS = 15_000;

function compareSessionsByRecentActivity(left: SessionMeta, right: SessionMeta): number {
  return (right.lastActivityAt ?? right.timestamp).localeCompare(left.lastActivityAt ?? left.timestamp);
}

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

export function applyRunningIndicatorGrace(
  sessions: SessionMeta[],
  runningUntilBySessionId: Map<string, number>,
  nowMs: number,
  graceMs = RUNNING_INDICATOR_GRACE_MS,
): SessionMeta[] {
  let changed = false;

  const nextSessions = sessions.map((session) => {
    if (session.isRunning) {
      runningUntilBySessionId.set(session.id, nowMs + graceMs);
      return session;
    }

    const runningUntil = runningUntilBySessionId.get(session.id) ?? 0;
    if (runningUntil > nowMs) {
      changed = true;
      return { ...session, isRunning: true };
    }

    if (runningUntilBySessionId.has(session.id)) {
      runningUntilBySessionId.delete(session.id);
    }
    return session;
  });

  return changed ? nextSessions : sessions;
}

export function useConversations() {
  const [openIds, setOpenIds] = useState(() => readOpenSessionIds());
  const [pinnedIds, setPinnedIds] = useState(() => readPinnedSessionIds());
  const [archivedConversationIds, setArchivedConversationIds] = useState(() => readArchivedSessionIds());
  const { titles: liveTitles } = useContext(LiveTitlesContext);
  const { sessions, tasks, setSessions } = useAppData();
  const { status: sseStatus } = useSseConnection();
  const seenRunningAutomationIdsRef = useRef<Set<string>>(new Set());
  const runningIndicatorGraceBySessionIdRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    function handleConversationLayoutChanged() {
      const layout = readConversationLayout();
      applyLayoutState(layout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
    }

    window.addEventListener(CONVERSATION_LAYOUT_CHANGED_EVENT, handleConversationLayoutChanged);
    return () => window.removeEventListener(CONVERSATION_LAYOUT_CHANGED_EVENT, handleConversationLayoutChanged);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const localLayout = readConversationLayout();

    if (localLayout.sessionIds.length > 0 || localLayout.pinnedSessionIds.length > 0 || localLayout.archivedSessionIds.length > 0) {
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

  useEffect(() => {
    if (tasks === null) {
      return;
    }

    const nextRunningAutomationIds = new Set(tasks.filter((task) => task.running).map((task) => task.id));
    const newlyRunningThreadIds = new Set(
      tasks.flatMap((task) => (
        task.running
          && task.threadConversationId
          && !seenRunningAutomationIdsRef.current.has(task.id)
          ? [task.threadConversationId]
          : []
      )),
    );

    if (newlyRunningThreadIds.size > 0) {
      const currentLayout = readConversationLayout();
      const nextSessionIds = [...currentLayout.sessionIds];
      let changed = false;

      for (const threadId of newlyRunningThreadIds) {
        if (currentLayout.pinnedSessionIds.includes(threadId) || nextSessionIds.includes(threadId)) {
          continue;
        }

        nextSessionIds.push(threadId);
        changed = true;
      }

      if (changed) {
        const nextLayout = replaceConversationLayout({
          sessionIds: nextSessionIds,
          pinnedSessionIds: currentLayout.pinnedSessionIds,
          archivedSessionIds: currentLayout.archivedSessionIds,
        });
        applyLayoutState(nextLayout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
      }
    }

    seenRunningAutomationIdsRef.current = nextRunningAutomationIds;
  }, [tasks]);

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

  const archiveSession = useCallback((id: string) => {
    const nextLayout = setConversationArchivedState(id, true);
    applyLayoutState(nextLayout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
  }, []);

  const restoreSession = useCallback((id: string) => {
    const nextLayout = setConversationArchivedState(id, false);
    applyLayoutState(nextLayout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
  }, []);

  const reopenMostRecentlyClosedSession = useCallback(() => {
    const { reopenedSessionId, layout } = reopenMostRecentlyArchivedConversation();
    applyLayoutState(layout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
    return reopenedSessionId;
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

  const shiftSession = useCallback((sessionId: string, direction: -1 | 1) => {
    const nextLayout = shiftConversationTab(sessionId, direction);
    applyLayoutState(nextLayout, { setOpenIds, setPinnedIds, setArchivedConversationIds });
  }, []);

  const automationThreadTitleBySessionId = useMemo(
    () => new Map((tasks ?? []).flatMap((task) => task.threadConversationId ? [[task.threadConversationId, task.threadTitle ?? task.title ?? `Automation: ${task.id}`] as const] : [])),
    [tasks],
  );

  const sessionsWithRunningGrace = useMemo(
    () => applyRunningIndicatorGrace(sessions ?? [], runningIndicatorGraceBySessionIdRef.current, Date.now()),
    [sessions],
  );

  const withTitles = useMemo(() => sessionsWithRunningGrace.map((session) => {
    const liveTitle = normalizeConversationTitle(liveTitles.get(session.id));
    const sessionTitle = normalizeConversationTitle(session.title) ?? NEW_CONVERSATION_TITLE;
    const title = liveTitle ?? sessionTitle;

    return title === session.title ? session : { ...session, title };
  }), [liveTitles, sessionsWithRunningGrace]);
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

      return buildPlaceholderSessionMeta(id, normalizeConversationTitle(liveTitles.get(id)) ?? automationThreadTitleBySessionId.get(id) ?? 'Connecting…');
    }),
    [automationThreadTitleBySessionId, liveTitles, pinnedIds, sessionsById],
  );
  const tabs = useMemo(
    () => openIds.map((id) => {
      const session = sessionsById.get(id);
      if (session) {
        return session;
      }

      return buildPlaceholderSessionMeta(id, normalizeConversationTitle(liveTitles.get(id)) ?? automationThreadTitleBySessionId.get(id) ?? 'Connecting…');
    }),
    [automationThreadTitleBySessionId, liveTitles, openIds, sessionsById],
  );
  const archivedSessions = useMemo(
    () => withTitles
      .filter((session) => !openIdSet.has(session.id) && !pinnedIdSet.has(session.id))
      .sort(compareSessionsByRecentActivity),
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
    archiveSession,
    restoreSession,
    reopenMostRecentlyClosedSession,
    moveSession,
    shiftSession,
    loading,
    refetch,
  };
}
