import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { resolveWebRouteRedirect } from './routes';
import { api } from './api';
import { buildApiPath } from './apiBase';
import { normalizeAppEvent } from './appEventTransport';
import { subscribeDesktopAppEvents } from './desktopAppEvents';
import { readDesktopEnvironment } from './desktopBridge';
import { createDesktopAwareEventSource } from './desktopEventSource';
import { lazyRouteWithRecovery } from './lazyRouteRecovery';
import { Layout } from './components/Layout';
import { resolveConversationIndexRedirect } from './conversation/conversationRoutes';
import {
  hasDraftConversationAttachments,
  hasDraftConversationContextDocs,
  readDraftConversationComposer,
  readDraftConversationCwd,
} from './draftConversation';
import { useConversations } from './hooks/useConversations';
import { fetchSessionsSnapshot } from './sessionSnapshot';
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
} from './conversation/conversationEventVersions';
import {
  mergeSessionSnapshotPreservingOrder,
  removeSessionMetaPreservingOrder,
  replaceSessionMetaPreservingOrder,
} from './sessionListState';
import { ThemeProvider } from './theme';
import { createSessionMetaRefreshScheduler } from './sessionMetaRefreshScheduler';
import type {
  AppEvent,
  DaemonState,
  DesktopAppEvent,
  DurableRunListResult,
  RemoteAccessSessionState,
  ScheduledTaskSummary,
  SessionMeta,
  WebUiState,
} from './types';
import { setConversationRunIdInSearch } from './conversation/conversationRuns';
import { getRunPrimaryConnection, type RunPresentationLookups } from './runPresentation';

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

  if (!id) {
    return <Navigate to="/automations" replace />;
  }

  useEffect(() => {

    const cached = runs?.runs.find((run) => run.runId === id);
    if (cached) {
      const connection = getRunPrimaryConnection(cached, lookups);
      setTarget(connection?.to
        ? `${connection.to}${setConversationRunIdInSearch('', cached.runId)}`
        : '/automations');
      return;
    }

    let cancelled = false;
    void api.durableRun(id)
      .then((detail) => {
        if (cancelled) {
          return;
        }

        const connection = getRunPrimaryConnection(detail.run, lookups);
        setTarget(connection?.to
          ? `${connection.to}${setConversationRunIdInSearch('', detail.run.runId)}`
          : '/automations');
      })
      .catch(() => {
        if (!cancelled) {
          setTarget('/automations');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, lookups, runs?.runs]);

  return target ? <Navigate to={target} replace /> : null;
}

function DeletedStandaloneAdminRedirect() {
  return <Navigate to="/settings" replace />;
}

const TasksPage = lazyRouteWithRecovery('tasks-page', () => import('./pages/TasksPage').then((module) => ({ default: module.TasksPage })));
const ConversationPage = lazyRouteWithRecovery('conversation-page', () => import('./pages/ConversationPage').then((module) => ({ default: module.ConversationPage })));
const SystemPage = lazyRouteWithRecovery('system-page', () => import('./pages/SystemPage').then((module) => ({ default: module.SystemPage })));
const SettingsPage = lazyRouteWithRecovery('settings-page', () => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));

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

function defaultRemoteAccessDeviceLabel(): string {
  if (typeof navigator === 'undefined') {
    return 'Remote desktop';
  }

  const navigatorWithUserAgentData = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = navigatorWithUserAgentData.userAgentData?.platform ?? navigator.platform ?? '';
  return platform.trim().length > 0 ? `${platform} desktop` : 'Remote desktop';
}

function RemoteAccessPairingScreen() {
  const [pairingCode, setPairingCode] = useState('');
  const [deviceLabel, setDeviceLabel] = useState(() => defaultRemoteAccessDeviceLabel());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePair = useCallback(async () => {
    if (busy || pairingCode.trim().length === 0) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.exchangeRemoteAccessPairingCode(pairingCode, deviceLabel);
      window.location.reload();
    } catch (pairError) {
      setError(pairError instanceof Error ? pairError.message : String(pairError));
      setBusy(false);
    }
  }, [busy, deviceLabel, pairingCode]);

  return (
    <ThemeProvider>
      <div className="flex min-h-screen items-center justify-center bg-base px-5 py-8 text-primary">
        <div className="w-full max-w-md rounded-[28px] border border-border-subtle bg-surface/80 px-5 py-6 shadow-[0_18px_80px_rgba(15,23,42,0.18)]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Remote access</p>
          <h1 className="mt-3 text-[24px] font-semibold tracking-tight text-primary">Pair this browser</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-secondary">
            Enter a short-lived pairing code from the machine hosting Pi to unlock the full desktop web UI over your tailnet.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-secondary">
            Generate a code from the local web UI or run <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-primary">pa ui pairing-code</code>. Active pairings refresh while you use them; idle pairings expire after 30 days unless you revoke them sooner.
          </p>
          <label className="mt-5 block">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/70">Pairing code</span>
            <input
              value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ABCD-EFGH-IJKL"
              className="mt-2 w-full rounded-2xl border border-border-subtle bg-base px-4 py-3 font-mono text-[16px] tracking-[0.18em] text-primary outline-none transition focus:border-accent"
            />
          </label>
          <label className="mt-4 block">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-dim/70">Device label</span>
            <input
              value={deviceLabel}
              onChange={(event) => setDeviceLabel(event.target.value)}
              autoCorrect="off"
              spellCheck={false}
              className="mt-2 w-full rounded-2xl border border-border-subtle bg-base px-4 py-3 text-[14px] text-primary outline-none transition focus:border-accent"
            />
          </label>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => { void handlePair(); }}
              disabled={busy || pairingCode.trim().length === 0}
              className="ui-toolbar-button"
            >
              {busy ? 'Signing in…' : 'Pair browser'}
            </button>
          </div>
          {error ? <p className="mt-4 text-[12px] text-danger">{error}</p> : null}
        </div>
      </div>
    </ThemeProvider>
  );
}

export function App() {
  const [remoteAccessSession, setRemoteAccessSession] = useState<RemoteAccessSessionState | null>(null);
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const [eventVersions, setEventVersions] = useState(INITIAL_APP_EVENT_VERSIONS);
  const [conversationVersions, setConversationVersions] = useState(INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'open' | 'reconnecting' | 'offline'>('connecting');


  const projects = null;
  const [sessions, setSessionsState] = useState<SessionMeta[] | null>(null);
  const [tasks, setTasksState] = useState<ScheduledTaskSummary[] | null>(null);
  const [runs, setRunsState] = useState<DurableRunListResult | null>(null);
  const [daemon, setDaemonState] = useState<DaemonState | null>(null);
  const [webUi, setWebUiState] = useState<WebUiState | null>(null);
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

  const setWebUi = useCallback((state: WebUiState) => {
    setWebUiState(state);
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
      case 'webUi':
        setWebUi(payload.state);
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
  }, [bumpConversationVersion, refreshSessionMeta, setDaemon, setSessions, setTasks, setTitle, setWebUi]);

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

    void api.webUiState()
      .then((state) => {
        setWebUi(state);
      })
      .catch(() => {
        // Keep waiting for SSE or a later retry.
      });
  }, [setDaemon, setRuns, setSessions, setTasks, setWebUi]);

  useEffect(() => {
    let cancelled = false;

    api.remoteAccessSession()
      .then((state) => {
        if (!cancelled) {
          setRemoteAccessSession(state);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRemoteAccessSession({ required: false, session: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const remoteAccessGranted = remoteAccessSession !== null
    && (!remoteAccessSession.required || remoteAccessSession.session !== null);

  useEffect(() => {
    if (!remoteAccessGranted) {
      return;
    }

    let cancelled = false;
    let cleanup = () => {};
    const bootstrapTimer = window.setTimeout(() => {
      if (!openedOnceRef.current) {
        setSseStatus('offline');
        void bootstrapSnapshots();
      }
    }, 1500);

    const startLegacyAppStream = () => {
      const es = createDesktopAwareEventSource(buildApiPath('/events'));
      es.onopen = () => {
        openedOnceRef.current = true;
        window.clearTimeout(bootstrapTimer);
        setSseStatus('open');
      };

      es.onmessage = (event) => {
        let payload: AppEvent;
        try {
          payload = JSON.parse(event.data) as AppEvent;
        } catch {
          return;
        }

        const normalized = normalizeAppEvent(payload);
        if (normalized) {
          handleDesktopAppEvent(normalized);
        }
      };

      es.onerror = () => {
        if (es.readyState === EventSource.CLOSED) {
          setSseStatus('offline');
          return;
        }
        setSseStatus(openedOnceRef.current ? 'reconnecting' : 'connecting');
      };

      return () => {
        es.close();
      };
    };

    void (async () => {
      const environment = await readDesktopEnvironment().catch(() => null);
      if (cancelled) {
        return;
      }

      if (environment?.activeHostKind === 'local') {
        try {
          const localCleanup = await subscribeDesktopAppEvents({
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
          });
          if (cancelled) {
            localCleanup();
            return;
          }

          cleanup = localCleanup;
          return;
        } catch {
          // Fall through to the legacy desktop-aware event transport.
        }
      }

      if (cancelled) {
        return;
      }

      cleanup = startLegacyAppStream();
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(bootstrapTimer);
      cleanup();
      setSseStatus('offline');
    };
  }, [bootstrapSnapshots, handleDesktopAppEvent, remoteAccessGranted, setRuns]);

  if (remoteAccessSession === null) {
    return (
      <ThemeProvider>
        <div className="flex min-h-screen items-center justify-center bg-base px-6 text-[12px] text-dim">Checking desktop access…</div>
      </ThemeProvider>
    );
  }

  if (remoteAccessSession.required && !remoteAccessSession.session) {
    return <RemoteAccessPairingScreen />;
  }

  return (
    <AppEventsContext.Provider value={{ versions: eventVersions, conversationVersions }}>
      <SseConnectionContext.Provider value={{ status: sseStatus }}>
        <AppDataContext.Provider value={{ projects, sessions, tasks, runs, setProjects, setSessions, setTasks, setRuns }}>
          <SystemStatusContext.Provider value={{ daemon, webUi, setDaemon, setWebUi }}>
            <LiveTitlesContext.Provider value={{ titles: titleMap, setTitle }}>
              <ThemeProvider>
                <BrowserRouter>
                  <Routes>
                    <Route path="/" element={<Layout />}>
                      <Route index element={<Navigate to="/conversations/new" replace />} />
                      <Route path="conversations" element={<ConversationsRouteRedirect />} />
                      <Route path="conversations/new" element={suspendRoute(<ConversationPage draft />)} />
                      <Route path="conversations/:id" element={suspendRoute(<ConversationPage />)} />
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
