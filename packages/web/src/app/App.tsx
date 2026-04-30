import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { api } from '../client/api';
import { subscribeDesktopAppEvents } from '../desktop/desktopAppEvents';
import { lazyRouteWithRecovery } from '../navigation/lazyRouteRecovery';
import { Layout } from '../components/Layout';
import { resolveConversationIndexRedirect } from '../conversation/conversationRoutes';
import {
  hasDraftConversationAttachments,
  hasDraftConversationContextDocs,
  readDraftConversationComposer,
  readDraftConversationCwd,
} from '../conversation/draftConversation';
import { useConversations } from '../hooks/useConversations';
import { fetchSessionsSnapshot } from '../session/sessionSnapshot';
import {
  AppDataContext,
  AppEventsContext,
  INITIAL_APP_EVENT_VERSIONS,
  LiveTitlesContext,
  SseConnectionContext,
  SystemStatusContext,
  useAppData,
} from './contexts';
import {
  INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS,
  bumpConversationScopedEventVersions,
} from '../conversation/conversationEventVersions';
import {
  mergeSessionSnapshotPreservingOrder,
  removeSessionMetaPreservingOrder,
  replaceSessionMetaPreservingOrder,
} from '../session/sessionListState';
import { ThemeProvider } from '../ui-state/theme';
import type {
  DaemonState,
  DesktopAppEvent,
  DurableRunListResult,
  ScheduledTaskSummary,
  SessionMeta,
} from '../shared/types';

function ConversationsRouteRedirect() {
  const { openIds, pinnedIds } = useConversations();
  const redirectPath = resolveConversationIndexRedirect({
    openIds,
    pinnedIds,
    hasDraft: readDraftConversationComposer().trim().length > 0
      || readDraftConversationCwd().trim().length > 0
      || hasDraftConversationAttachments()
      || hasDraftConversationContextDocs(),
  });

  return <Navigate to={redirectPath} replace />;
}

const TasksPage = lazyRouteWithRecovery('tasks-page', () => import('../pages/TasksPage').then((module) => ({ default: module.TasksPage })));
const ConversationPage = lazyRouteWithRecovery('conversation-page', () => import('../pages/ConversationPage').then((module) => ({ default: module.ConversationPage })));
const SettingsPage = lazyRouteWithRecovery('settings-page', () => import('../pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const KnowledgePage = lazyRouteWithRecovery('knowledge-page', () => import('../pages/KnowledgePage').then((module) => ({ default: module.KnowledgePage })));

function suspendRoute(element: React.ReactNode) {
  return (
    <Suspense
      fallback={(
        <div className="flex h-full items-center justify-center px-6 text-[12px] text-dim">
          Loading…
        </div>
      )}
    >
      {element}
    </Suspense>
  );
}

function DraftConversationRoute() {
  return suspendRoute(<ConversationPage key="draft" draft />);
}

function SavedConversationRoute() {
  const { id } = useParams<{ id?: string }>();
  return suspendRoute(<ConversationPage key={id ?? 'conversation'} />);
}

export function App() {
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const [eventVersions, setEventVersions] = useState(INITIAL_APP_EVENT_VERSIONS);
  const [conversationVersions, setConversationVersions] = useState(INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'open' | 'reconnecting' | 'offline'>('connecting');


  const projects = null;
  const [sessions, setSessionsState] = useState<SessionMeta[] | null>(null);
  const [tasks, setTasksState] = useState<ScheduledTaskSummary[] | null>(null);
  const [runs, setRunsState] = useState<DurableRunListResult | null>(null);
  const [daemon, setDaemonState] = useState<DaemonState | null>(null);
  const openedOnceRef = useRef(false);
  const inflightSessionMetaRefreshesRef = useRef(new Map<string, Promise<void>>());

  const setTitle = useCallback((id: string, title: string) => {
    setTitleMap((prev) => {
      if (prev.get(id) === title) return prev;
      const next = new Map(prev);
      next.set(id, title);
      return next;
    });
  }, []);


  const setProjects = useCallback(() => {}, []);

  const setSessions = useCallback((items: SessionMeta[]) => {
    setSessionsState((previous) => mergeSessionSnapshotPreservingOrder(previous, items));
  }, []);

  const applySessionMetaUpdate = useCallback((sessionId: string, nextSession: SessionMeta | null) => {
    setSessionsState((previous) => {
      if (!previous) {
        return previous;
      }

      if (!nextSession) {
        return removeSessionMetaPreservingOrder(previous, sessionId);
      }

      return replaceSessionMetaPreservingOrder(previous, nextSession);
    });
  }, []);

  const bumpConversationVersion = useCallback((sessionId: string) => {
    setConversationVersions((previous) => bumpConversationScopedEventVersions(previous, sessionId));
  }, []);

  const refreshSessionMeta = useCallback((sessionId: string) => {
    const inflight = inflightSessionMetaRefreshesRef.current.get(sessionId);
    if (inflight) {
      return inflight;
    }

    const request = api.sessionMeta(sessionId)
      .then((session) => {
        applySessionMetaUpdate(sessionId, session);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        if (/not found/i.test(message)) {
          applySessionMetaUpdate(sessionId, null);
        }
      })
      .finally(() => {
        inflightSessionMetaRefreshesRef.current.delete(sessionId);
      });

    inflightSessionMetaRefreshesRef.current.set(sessionId, request);
    return request;
  }, [applySessionMetaUpdate]);

  const setTasks = useCallback((items: ScheduledTaskSummary[]) => {
    setTasksState(items);
  }, []);

  const setRuns = useCallback((result: DurableRunListResult) => {
    setRunsState(result);
  }, []);

  const setDaemon = useCallback((state: DaemonState) => {
    setDaemonState(state);
  }, []);

  const handleDesktopAppEvent = useCallback((payload: DesktopAppEvent) => {
    switch (payload.type) {
      case 'live_title':
        setTitle(payload.sessionId, payload.title);
        return;
      case 'session_meta_changed':
        bumpConversationVersion(payload.sessionId);
        void refreshSessionMeta(payload.sessionId);
        return;
      case 'session_file_changed':
        bumpConversationVersion(payload.sessionId);
        return;

      case 'sessions':
        setSessions(payload.sessions);
        return;
      case 'tasks':
        setTasks(payload.tasks);
        return;
      case 'runs':
        setRuns(payload.result);
        return;
      case 'daemon':
        setDaemon(payload.state);
        return;
      case 'invalidate':
        if (payload.topics.includes('runs')) {
          void api.runs()
            .then((result) => {
              setRuns(result);
            })
            .catch(() => {
              // Keep the last known snapshot until the next app event or manual refresh.
            });
        }
        setEventVersions((prev) => {
          const next = { ...prev };
          for (const topic of payload.topics) {
            if (topic in next) {
              const trackedTopic = topic as keyof typeof next;
              next[trackedTopic] += 1;
            }
          }
          return next;
        });
        return;
      default:
        return;
    }
  }, [bumpConversationVersion, refreshSessionMeta, setDaemon, setSessions, setTasks, setTitle]);

  const bootstrapSnapshots = useCallback(() => {
    void fetchSessionsSnapshot()
      .then((items) => {
        setSessions(items);
      })
      .catch(() => {
        // Keep waiting for SSE or a later retry.
      });

    void api.tasks()
      .then((items) => {
        setTasks(items);
      })
      .catch(() => {
        // Keep waiting for SSE or a later retry.
      });

    void api.runs()
      .then((result) => {
        setRuns(result);
      })
      .catch(() => {
        // Keep waiting for SSE or a later retry.
      });

    void api.daemon()
      .then((state) => {
        setDaemon(state);
      })
      .catch(() => {
        // Keep waiting for SSE or a later retry.
      });
  }, [setDaemon, setRuns, setSessions, setTasks]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    const bootstrapTimer = window.setTimeout(() => {
      if (!openedOnceRef.current) {
        setSseStatus('offline');
        void bootstrapSnapshots();
      }
    }, 1500);

    void subscribeDesktopAppEvents({
      onopen: () => {
        openedOnceRef.current = true;
        window.clearTimeout(bootstrapTimer);
        setSseStatus('open');
      },
      onevent: handleDesktopAppEvent,
      onerror: () => {
        setSseStatus(openedOnceRef.current ? 'reconnecting' : 'connecting');
      },
      onclose: () => {
        setSseStatus('offline');
      },
    }).then((localCleanup) => {
      if (cancelled) {
        localCleanup();
        return;
      }

      cleanup = localCleanup;
    }).catch(() => {
      if (!cancelled) {
        setSseStatus('offline');
        void bootstrapSnapshots();
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(bootstrapTimer);
      cleanup();
      setSseStatus('offline');
    };
  }, [bootstrapSnapshots, handleDesktopAppEvent]);

  return (
    <AppEventsContext.Provider value={{ versions: eventVersions, conversationVersions }}>
      <SseConnectionContext.Provider value={{ status: sseStatus }}>
        <AppDataContext.Provider value={{ projects, sessions, tasks, runs, setProjects, setSessions, setTasks, setRuns }}>
          <SystemStatusContext.Provider value={{ daemon, setDaemon }}>
            <LiveTitlesContext.Provider value={{ titles: titleMap, setTitle }}>
              <ThemeProvider>
                <BrowserRouter>
                  <Routes>
                    <Route path="/" element={<Layout />}>
                      <Route index element={<Navigate to="/conversations/new" replace />} />
                      <Route path="conversations" element={<ConversationsRouteRedirect />} />
                      <Route path="conversations/new" element={<DraftConversationRoute />} />
                      <Route path="conversations/:id" element={<SavedConversationRoute />} />
                      <Route path="knowledge" element={suspendRoute(<KnowledgePage />)} />
                      <Route path="knowledge/*" element={suspendRoute(<KnowledgePage />)} />
                      <Route path="automations" element={suspendRoute(<TasksPage />)} />
                      <Route path="automations/:id" element={suspendRoute(<TasksPage />)} />
                      <Route path="settings" element={suspendRoute(<SettingsPage />)} />
                    </Route>
                  </Routes>
                </BrowserRouter>
              </ThemeProvider>
            </LiveTitlesContext.Provider>
          </SystemStatusContext.Provider>
        </AppDataContext.Provider>
      </SseConnectionContext.Provider>
    </AppEventsContext.Provider>
  );
}
