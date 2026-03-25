import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { COMPANION_APP_PATH, resolveCompanionRouteRedirect } from './companion/routes';
import { api } from './api';
import { buildApiPath } from './apiBase';
import { Layout } from './components/Layout';
import { InboxPage } from './pages/InboxPage';
import { fetchSessionsSnapshot } from './sessionSnapshot';
import {
  AppDataContext,
  AppEventsContext,
  INITIAL_APP_EVENT_VERSIONS,
  LiveTitlesContext,
  SseConnectionContext,
  SystemStatusContext,
} from './contexts';
import { ThemeProvider } from './theme';
import type {
  ActivitySnapshot,
  AppEvent,
  AppEventTopic,
  DaemonState,
  DesktopAuthSessionState,
  DurableRunListResult,
  ProjectRecord,
  ScheduledTaskSummary,
  SessionMeta,
  SyncState,
  WebUiState,
} from './types';

function LegacyTaskRoutesRedirect() {
  const { id } = useParams<{ id?: string }>();
  return <Navigate to={id ? `/scheduled/${id}` : '/scheduled'} replace />;
}

function LegacyRunsRoutesRedirect() {
  const { id } = useParams<{ id?: string }>();
  return <Navigate to={id ? `/system?run=${encodeURIComponent(id)}` : '/system'} replace />;
}

function WorkspaceRouteRedirect() {
  const location = useLocation();
  return <Navigate to={{ pathname: '/workspace/files', search: location.search }} replace />;
}

function CompanionRouteValidationBoundary() {
  const location = useLocation();
  const redirectPath = resolveCompanionRouteRedirect(location.pathname);

  if (redirectPath) {
    return <Navigate to={{ pathname: redirectPath, search: location.search }} replace />;
  }

  return <CompanionLayout />;
}

function isCompanionBrowserRoute(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.location.pathname === COMPANION_APP_PATH
    || window.location.pathname.startsWith(`${COMPANION_APP_PATH}/`);
}

const TasksPage = lazy(() => import('./pages/TasksPage').then((module) => ({ default: module.TasksPage })));
const ConversationsPage = lazy(() => import('./pages/ConversationsPage').then((module) => ({ default: module.ConversationsPage })));
const ConversationPage = lazy(() => import('./pages/ConversationPage').then((module) => ({ default: module.ConversationPage })));
const SystemPage = lazy(() => import('./pages/SystemPage').then((module) => ({ default: module.SystemPage })));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then((module) => ({ default: module.ProjectsPage })));
const AutomationPage = lazy(() => import('./pages/AutomationPage').then((module) => ({ default: module.AutomationPage })));
const SkillsPage = lazy(() => import('./pages/SkillsPage').then((module) => ({ default: module.SkillsPage })));
const InstructionsPage = lazy(() => import('./pages/InstructionsPage').then((module) => ({ default: module.InstructionsPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const ToolsPage = lazy(() => import('./pages/ToolsPage').then((module) => ({ default: module.ToolsPage })));
const MemoriesPage = lazy(() => import('./pages/MemoriesPage').then((module) => ({ default: module.MemoriesPage })));
const WorkspacePage = lazy(() => import('./pages/WorkspacePage').then((module) => ({ default: module.WorkspacePage })));
const WorkspaceChangesPage = lazy(() => import('./pages/WorkspaceChangesPage').then((module) => ({ default: module.WorkspaceChangesPage })));
const CompanionLayout = lazy(() => import('./companion/CompanionLayout').then((module) => ({ default: module.CompanionLayout })));
const CompanionInboxPage = lazy(() => import('./companion/CompanionInboxPage').then((module) => ({ default: module.CompanionInboxPage })));
const CompanionConversationsPage = lazy(() => import('./companion/CompanionConversationsPage').then((module) => ({ default: module.CompanionConversationsPage })));
const CompanionConversationPage = lazy(() => import('./companion/CompanionConversationPage').then((module) => ({ default: module.CompanionConversationPage })));
const CompanionTasksPage = lazy(() => import('./companion/CompanionTasksPage').then((module) => ({ default: module.CompanionTasksPage })));
const CompanionTaskDetailPage = lazy(() => import('./companion/CompanionTaskDetailPage').then((module) => ({ default: module.CompanionTaskDetailPage })));
const CompanionSystemPage = lazy(() => import('./companion/CompanionSystemPage').then((module) => ({ default: module.CompanionSystemPage })));
const CompanionProjectsPage = lazy(() => import('./companion/CompanionProjectsPage').then((module) => ({ default: module.CompanionProjectsPage })));
const CompanionProjectDetailPage = lazy(() => import('./companion/CompanionProjectDetailPage').then((module) => ({ default: module.CompanionProjectDetailPage })));
const CompanionMemoriesPage = lazy(() => import('./companion/CompanionMemoriesPage').then((module) => ({ default: module.CompanionMemoriesPage })));
const CompanionMemoryDetailPage = lazy(() => import('./companion/CompanionMemoryDetailPage').then((module) => ({ default: module.CompanionMemoryDetailPage })));
const CompanionSkillsPage = lazy(() => import('./companion/CompanionSkillsPage').then((module) => ({ default: module.CompanionSkillsPage })));
const CompanionSkillDetailPage = lazy(() => import('./companion/CompanionSkillDetailPage').then((module) => ({ default: module.CompanionSkillDetailPage })));

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

function defaultDesktopDeviceLabel(): string {
  if (typeof navigator === 'undefined') {
    return 'Remote desktop';
  }

  const navigatorWithUserAgentData = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = navigatorWithUserAgentData.userAgentData?.platform ?? navigator.platform ?? '';
  return platform.trim().length > 0 ? `${platform} desktop` : 'Remote desktop';
}

function DesktopPairingScreen() {
  const [pairingCode, setPairingCode] = useState('');
  const [deviceLabel, setDeviceLabel] = useState(() => defaultDesktopDeviceLabel());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePair = useCallback(async () => {
    if (busy || pairingCode.trim().length === 0) {
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await api.exchangeDesktopPairingCode(pairingCode, deviceLabel);
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-dim/70">Pi Desktop</p>
          <h1 className="mt-3 text-[24px] font-semibold tracking-tight text-primary">Pair this browser</h1>
          <p className="mt-2 text-[13px] leading-relaxed text-secondary">
            Enter a short-lived pairing code from the machine hosting Pi to unlock the full desktop web UI over your tailnet.
          </p>
          <p className="mt-2 text-[12px] leading-relaxed text-secondary">
            Generate a code from the local web UI or run <code className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-primary">pa ui pairing-code</code>. Once paired, this browser stays signed in until you revoke it.
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
  const [desktopAuth, setDesktopAuth] = useState<DesktopAuthSessionState | null>(null);
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const [eventVersions, setEventVersions] = useState(INITIAL_APP_EVENT_VERSIONS);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'open' | 'reconnecting' | 'offline'>('connecting');
  const [activity, setActivityState] = useState<ActivitySnapshot | null>(null);
  const [projects, setProjectsState] = useState<ProjectRecord[] | null>(null);
  const [sessions, setSessionsState] = useState<SessionMeta[] | null>(null);
  const [tasks, setTasksState] = useState<ScheduledTaskSummary[] | null>(null);
  const [runs, setRunsState] = useState<DurableRunListResult | null>(null);
  const [daemon, setDaemonState] = useState<DaemonState | null>(null);
  const [sync, setSyncState] = useState<SyncState | null>(null);
  const [webUi, setWebUiState] = useState<WebUiState | null>(null);
  const openedOnceRef = useRef(false);

  const setTitle = useCallback((id: string, title: string) => {
    setTitleMap((prev) => {
      if (prev.get(id) === title) return prev;
      const next = new Map(prev);
      next.set(id, title);
      return next;
    });
  }, []);

  const setActivity = useCallback((snapshot: ActivitySnapshot) => {
    setActivityState(snapshot);
  }, []);

  const setProjects = useCallback((items: ProjectRecord[]) => {
    setProjectsState(items);
  }, []);

  const setSessions = useCallback((items: SessionMeta[]) => {
    setSessionsState(items);
  }, []);

  const setTasks = useCallback((items: ScheduledTaskSummary[]) => {
    setTasksState(items);
  }, []);

  const setRuns = useCallback((result: DurableRunListResult) => {
    setRunsState(result);
  }, []);

  const setDaemon = useCallback((state: DaemonState) => {
    setDaemonState(state);
  }, []);

  const setSync = useCallback((state: SyncState) => {
    setSyncState(state);
  }, []);

  const setWebUi = useCallback((state: WebUiState) => {
    setWebUiState(state);
  }, []);

  const bootstrapSnapshots = useCallback(async () => {
    const companionRoute = isCompanionBrowserRoute();
    const [activityEntries, projectItems, sessionItems, taskItems, runResult, daemonState, syncState, webUiState] = await Promise.allSettled([
      api.activity(),
      api.projects(),
      companionRoute ? Promise.resolve<SessionMeta[] | null>(null) : fetchSessionsSnapshot(),
      api.tasks(),
      api.runs(),
      api.daemon(),
      api.sync(),
      api.webUiState(),
    ]);

    if (activityEntries.status === 'fulfilled') {
      setActivity({
        entries: activityEntries.value,
        unreadCount: activityEntries.value.filter((entry) => !entry.read).length,
      });
    }

    if (projectItems.status === 'fulfilled') {
      setProjects(projectItems.value);
    }

    if (sessionItems.status === 'fulfilled' && sessionItems.value) {
      setSessions(sessionItems.value);
    }

    if (taskItems.status === 'fulfilled') {
      setTasks(taskItems.value);
    }

    if (runResult.status === 'fulfilled') {
      setRuns(runResult.value);
    }

    if (daemonState.status === 'fulfilled') {
      setDaemon(daemonState.value);
    }

    if (syncState.status === 'fulfilled') {
      setSync(syncState.value);
    }

    if (webUiState.status === 'fulfilled') {
      setWebUi(webUiState.value);
    }
  }, [setActivity, setDaemon, setProjects, setRuns, setSessions, setSync, setTasks, setWebUi]);

  useEffect(() => {
    let cancelled = false;

    api.desktopAuthSession()
      .then((state) => {
        if (!cancelled) {
          setDesktopAuth(state);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopAuth({ required: false, session: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const desktopAccessGranted = desktopAuth !== null && (!desktopAuth.required || desktopAuth.session !== null);

  useEffect(() => {
    if (!desktopAccessGranted) {
      return;
    }

    const es = new EventSource(buildApiPath('/events'));
    const bootstrapTimer = window.setTimeout(() => {
      if (!openedOnceRef.current) {
        setSseStatus('offline');
        void bootstrapSnapshots();
      }
    }, 1500);

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

      switch (payload.type) {
        case 'live_title':
          setTitle(payload.sessionId, payload.title);
          return;
        case 'activity_snapshot':
          setActivity({ entries: payload.entries, unreadCount: payload.unreadCount });
          return;
        case 'projects_snapshot':
          setProjects(payload.projects);
          return;
        case 'sessions_snapshot':
          if (isCompanionBrowserRoute()) {
            setEventVersions((prev) => ({
              ...prev,
              sessions: prev.sessions + 1,
            }));
            return;
          }

          setSessions(payload.sessions);
          return;
        case 'tasks_snapshot':
          setTasks(payload.tasks);
          return;
        case 'runs_snapshot':
          setRuns(payload.result);
          return;
        case 'daemon_snapshot':
          setDaemon(payload.state);
          return;
        case 'sync_snapshot':
          setSync(payload.state);
          return;
        case 'web_ui_snapshot':
          setWebUi(payload.state);
          return;
        case 'invalidate':
          setEventVersions((prev) => {
            const next = { ...prev };
            for (const topic of payload.topics) {
              next[topic as AppEventTopic] += 1;
            }
            return next;
          });
          return;
        default:
          return;
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
      window.clearTimeout(bootstrapTimer);
      es.close();
      setSseStatus('offline');
    };
  }, [bootstrapSnapshots, desktopAccessGranted, setActivity, setDaemon, setProjects, setRuns, setSessions, setSync, setTasks, setTitle, setWebUi]);

  if (desktopAuth === null) {
    return (
      <ThemeProvider>
        <div className="flex min-h-screen items-center justify-center bg-base px-6 text-[12px] text-dim">Checking desktop access…</div>
      </ThemeProvider>
    );
  }

  if (desktopAuth.required && !desktopAuth.session) {
    return <DesktopPairingScreen />;
  }

  return (
    <AppEventsContext.Provider value={{ versions: eventVersions }}>
      <SseConnectionContext.Provider value={{ status: sseStatus }}>
        <AppDataContext.Provider value={{ activity, projects, sessions, tasks, runs, setActivity, setProjects, setSessions, setTasks, setRuns }}>
          <SystemStatusContext.Provider value={{ daemon, sync, webUi, setDaemon, setSync, setWebUi }}>
            <LiveTitlesContext.Provider value={{ titles: titleMap, setTitle }}>
              <ThemeProvider>
                <BrowserRouter>
                  <Routes>
                    <Route path="app/*" element={suspendRoute(<CompanionRouteValidationBoundary />)}>
                      <Route index element={<Navigate to="/app/inbox" replace />} />
                      <Route path="inbox" element={suspendRoute(<CompanionInboxPage />)} />
                      <Route path="conversations" element={suspendRoute(<CompanionConversationsPage />)} />
                      <Route path="conversations/:id" element={suspendRoute(<CompanionConversationPage />)} />
                      <Route path="tasks" element={suspendRoute(<CompanionTasksPage />)} />
                      <Route path="tasks/:id" element={suspendRoute(<CompanionTaskDetailPage />)} />
                      <Route path="system" element={suspendRoute(<CompanionSystemPage />)} />
                      <Route path="projects" element={suspendRoute(<CompanionProjectsPage />)} />
                      <Route path="projects/:id" element={suspendRoute(<CompanionProjectDetailPage />)} />
                      <Route path="memories" element={suspendRoute(<CompanionMemoriesPage />)} />
                      <Route path="memories/:id" element={suspendRoute(<CompanionMemoryDetailPage />)} />
                      <Route path="skills" element={suspendRoute(<CompanionSkillsPage />)} />
                      <Route path="skills/:name" element={suspendRoute(<CompanionSkillDetailPage />)} />
                    </Route>
                    <Route path="/" element={<Layout />}>
                      <Route index element={<Navigate to="/conversations" replace />} />
                      <Route path="conversations" element={suspendRoute(<ConversationsPage />)} />
                      <Route path="conversations/new" element={suspendRoute(<ConversationPage draft />)} />
                      <Route path="conversations/:id" element={suspendRoute(<ConversationPage />)} />
                      <Route path="workspace" element={<WorkspaceRouteRedirect />} />
                      <Route path="workspace/files" element={suspendRoute(<WorkspacePage />)} />
                      <Route path="workspace/changes" element={suspendRoute(<WorkspaceChangesPage />)} />
                      <Route path="inbox" element={<InboxPage />} />
                      <Route path="inbox/:id" element={<InboxPage />} />
                      <Route path="system" element={suspendRoute(<SystemPage />)} />
                      <Route path="projects" element={suspendRoute(<ProjectsPage />)} />
                      <Route path="projects/:id" element={suspendRoute(<ProjectsPage />)} />
                      <Route path="memories" element={suspendRoute(<MemoriesPage />)} />
                      <Route path="skills" element={suspendRoute(<SkillsPage />)} />
                      <Route path="instructions" element={suspendRoute(<InstructionsPage />)} />
                      <Route path="plans" element={suspendRoute(<AutomationPage />)} />
                      <Route path="runs" element={<LegacyRunsRoutesRedirect />} />
                      <Route path="runs/:id" element={<LegacyRunsRoutesRedirect />} />
                      <Route path="scheduled" element={suspendRoute(<TasksPage />)} />
                      <Route path="scheduled/:id" element={suspendRoute(<TasksPage />)} />
                      <Route path="automations" element={<LegacyTaskRoutesRedirect />} />
                      <Route path="automations/:id" element={<LegacyTaskRoutesRedirect />} />
                      <Route path="tasks" element={<LegacyTaskRoutesRedirect />} />
                      <Route path="tasks/:id" element={<LegacyTaskRoutesRedirect />} />
                      <Route path="tools" element={suspendRoute(<ToolsPage />)} />
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
