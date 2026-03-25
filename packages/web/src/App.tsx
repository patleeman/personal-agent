import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { api } from './api';
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
  DurableRunListResult,
  GatewayState,
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
const CompanionConversationsPage = lazy(() => import('./companion/CompanionConversationsPage').then((module) => ({ default: module.CompanionConversationsPage })));
const CompanionConversationPage = lazy(() => import('./companion/CompanionConversationPage').then((module) => ({ default: module.CompanionConversationPage })));

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

export function App() {
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const [eventVersions, setEventVersions] = useState(INITIAL_APP_EVENT_VERSIONS);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'open' | 'reconnecting' | 'offline'>('connecting');
  const [activity, setActivityState] = useState<ActivitySnapshot | null>(null);
  const [projects, setProjectsState] = useState<ProjectRecord[] | null>(null);
  const [sessions, setSessionsState] = useState<SessionMeta[] | null>(null);
  const [tasks, setTasksState] = useState<ScheduledTaskSummary[] | null>(null);
  const [runs, setRunsState] = useState<DurableRunListResult | null>(null);
  const [daemon, setDaemonState] = useState<DaemonState | null>(null);
  const [gateway, setGatewayState] = useState<GatewayState | null>(null);
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

  const setGateway = useCallback((state: GatewayState) => {
    setGatewayState(state);
  }, []);

  const setSync = useCallback((state: SyncState) => {
    setSyncState(state);
  }, []);

  const setWebUi = useCallback((state: WebUiState) => {
    setWebUiState(state);
  }, []);

  const bootstrapSnapshots = useCallback(async () => {
    try {
      const [activityEntries, projectItems, sessionItems, taskItems, runResult, daemonState, gatewayState, syncState, webUiState] = await Promise.all([
        api.activity(),
        api.projects(),
        fetchSessionsSnapshot(),
        api.tasks(),
        api.runs(),
        api.daemon(),
        api.gateway(),
        api.sync(),
        api.webUiState(),
      ]);

      setActivity({
        entries: activityEntries,
        unreadCount: activityEntries.filter((entry) => !entry.read).length,
      });
      setProjects(projectItems);
      setSessions(sessionItems);
      setTasks(taskItems);
      setRuns(runResult);
      setDaemon(daemonState);
      setGateway(gatewayState);
      setSync(syncState);
      setWebUi(webUiState);
    } catch {
      // Ignore bootstrap failures — manual refresh + SSE reconnect remain available.
    }
  }, [setActivity, setDaemon, setGateway, setProjects, setRuns, setSessions, setSync, setTasks, setWebUi]);

  useEffect(() => {
    const es = new EventSource('/api/events');
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
        case 'gateway_snapshot':
          setGateway(payload.state);
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
  }, [bootstrapSnapshots, setActivity, setDaemon, setGateway, setProjects, setRuns, setSessions, setSync, setTasks, setTitle, setWebUi]);

  return (
    <AppEventsContext.Provider value={{ versions: eventVersions }}>
      <SseConnectionContext.Provider value={{ status: sseStatus }}>
        <AppDataContext.Provider value={{ activity, projects, sessions, tasks, runs, setActivity, setProjects, setSessions, setTasks, setRuns }}>
          <SystemStatusContext.Provider value={{ daemon, gateway, sync, webUi, setDaemon, setGateway, setSync, setWebUi }}>
            <LiveTitlesContext.Provider value={{ titles: titleMap, setTitle }}>
              <ThemeProvider>
                <BrowserRouter>
                  <Routes>
                    <Route path="app" element={suspendRoute(<CompanionLayout />)}>
                      <Route index element={<Navigate to="/app/conversations" replace />} />
                      <Route path="conversations" element={suspendRoute(<CompanionConversationsPage />)} />
                      <Route path="conversations/:id" element={suspendRoute(<CompanionConversationPage />)} />
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
