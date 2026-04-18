import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { resolveWebRouteRedirect } from '../navigation/routes';
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
import { createSessionMetaRefreshScheduler } from '../session/sessionMetaRefreshScheduler';
import type {
  DaemonState,
  DesktopAppEvent,
  DurableRunListResult,
  ScheduledTaskSummary,
  SessionMeta,
} from '../shared/types';
import { setConversationRunIdInSearch } from '../conversation/conversationRuns';
import { getRunPrimaryConnection, type RunPresentationLookups } from '../automation/runPresentation';

function LegacyTaskRoutesRedirect() {
  const { id } = useParams<{ id?: string }>();
  return <Navigate to={id ? `/automations/${id}` : '/automations'} replace />;
}

function LegacyWebRouteRedirect() {
  const location = useLocation();
  const redirectPath = resolveWebRouteRedirect(location.pathname, location.search) ?? '/conversations/new';
  return <Navigate to={redirectPath} replace />;
}

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

function DeletedStandaloneRunsRedirect() {
  const { id } = useParams<{ id?: string }>();
  const { runs, tasks, sessions } = useAppData();
  const [target, setTarget] = useState<string | null>(null);
  const lookups = useMemo<RunPresentationLookups>(() => ({ tasks, sessions }), [sessions, tasks]);

  const buildRunRedirectTarget = useCallback((route: string | undefined, runId: string): string => {
    if (!route) {
      return '/automations';
    }

    if (route.startsWith('/automations')) {
      return `${route}${setConversationRunIdInSearch('', runId)}`;
    }

    return route;
  }, []);

  if (!id) {
    return <Navigate to="/automations" replace />;
  }

  useEffect(() => {

    const cached = runs?.runs.find((run) => run.runId === id);
    if (cached) {
      const connection = getRunPrimaryConnection(cached, lookups);
      setTarget(buildRunRedirectTarget(connection?.to, cached.runId));
      return;
    }

    let cancelled = false;
    void api.durableRun(id)
      .then((detail) => {
        if (cancelled) {
          return;
        }

        const connection = getRunPrimaryConnection(detail.run, lookups);
        setTarget(buildRunRedirectTarget(connection?.to, detail.run.runId));
      })
      .catch(() => {
        if (!cancelled) {
          setTarget('/automations');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [buildRunRedirectTarget, id, lookups, runs?.runs]);

  return target ? <Navigate to={target} replace /> : null;
}

function DeletedStandaloneAdminRedirect() {
  return <Navigate to="/settings" replace />;
}

const TasksPage = lazyRouteWithRecovery('tasks-page', () => import('../pages/TasksPage').then((module) => ({ default: module.TasksPage })));
const ConversationPage = lazyRouteWithRecovery('conversation-page', () => import('../pages/ConversationPage').then((module) => ({ default: module.ConversationPage })));
const SystemPage = lazyRouteWithRecovery('system-page', () => import('../pages/SystemPage').then((module) => ({ default: module.SystemPage })));
const SettingsPage = lazyRouteWithRecovery('settings-page', () => import('../pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));

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

  const sessionMetaRefreshSchedulerRef = useRef<ReturnType<typeof createSessionMetaRefreshScheduler> | null>(null);

  useEffect(() => {
    const scheduler = createSessionMetaRefreshScheduler((sessionId) => refreshSessionMeta(sessionId));
    sessionMetaRefreshSchedulerRef.current = scheduler;

    return () => {
      scheduler.dispose();
      if (sessionMetaRefreshSchedulerRef.current === scheduler) {
        sessionMetaRefreshSchedulerRef.current = null;
      }
    };
  }, [refreshSessionMeta]);

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
        if (sessionMetaRefreshSchedulerRef.current) {
          sessionMetaRefreshSchedulerRef.current.schedule(payload.sessionId);
        } else {
          void refreshSessionMeta(payload.sessionId);
        }
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
                      <Route path="workspace" element={<Navigate to="/conversations/new" replace />} />
                      <Route path="workspace/*" element={<Navigate to="/conversations/new" replace />} />
                      <Route path="system" element={suspendRoute(<SystemPage />)} />
                      <Route path="runs" element={<DeletedStandaloneRunsRedirect />} />
                      <Route path="runs/:id" element={<DeletedStandaloneRunsRedirect />} />
                      <Route path="knowledge" element={<LegacyWebRouteRedirect />} />
                      <Route path="knowledge/*" element={<LegacyWebRouteRedirect />} />
                      <Route path="notes" element={<LegacyWebRouteRedirect />} />
                      <Route path="notes/*" element={<LegacyWebRouteRedirect />} />
                      <Route path="memories" element={<LegacyWebRouteRedirect />} />
                      <Route path="memories/*" element={<LegacyWebRouteRedirect />} />
                      <Route path="skills" element={<LegacyWebRouteRedirect />} />
                      <Route path="skills/*" element={<LegacyWebRouteRedirect />} />
                      <Route path="nodes" element={<LegacyWebRouteRedirect />} />
                      <Route path="nodes/*" element={<LegacyWebRouteRedirect />} />
                      <Route path="automations" element={suspendRoute(<TasksPage />)} />
                      <Route path="automations/:id" element={suspendRoute(<TasksPage />)} />
                      <Route path="scheduled" element={<LegacyTaskRoutesRedirect />} />
                      <Route path="scheduled/:id" element={<LegacyTaskRoutesRedirect />} />
                      <Route path="tasks" element={<LegacyTaskRoutesRedirect />} />
                      <Route path="tasks/:id" element={<LegacyTaskRoutesRedirect />} />
                      <Route path="tools" element={<DeletedStandaloneAdminRedirect />} />
                      <Route path="instructions" element={<DeletedStandaloneAdminRedirect />} />
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
