import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
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

const TasksPage = lazy(() => import('./pages/TasksPage').then((module) => ({ default: module.TasksPage })));
const ConversationsPage = lazy(() => import('./pages/ConversationsPage').then((module) => ({ default: module.ConversationsPage })));
const ConversationPage = lazy(() => import('./pages/ConversationPage').then((module) => ({ default: module.ConversationPage })));
const SystemPage = lazy(() => import('./pages/SystemPage').then((module) => ({ default: module.SystemPage })));
const ProjectsPage = lazy(() => import('./pages/ProjectsPage').then((module) => ({ default: module.ProjectsPage })));
const AutomationPage = lazy(() => import('./pages/AutomationPage').then((module) => ({ default: module.AutomationPage })));
const KnowledgeBasePage = lazy(() => import('./pages/KnowledgeBasePage').then((module) => ({ default: module.KnowledgeBasePage })));
const CapabilitiesPage = lazy(() => import('./pages/CapabilitiesPage').then((module) => ({ default: module.CapabilitiesPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const ToolsPage = lazy(() => import('./pages/ToolsPage').then((module) => ({ default: module.ToolsPage })));
const MemoriesPage = lazy(() => import('./pages/MemoriesPage').then((module) => ({ default: module.MemoriesPage })));

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
      const [activityEntries, projectItems, sessionItems, taskItems, runResult] = await Promise.all([
        api.activity(),
        api.projects(),
        fetchSessionsSnapshot(),
        api.tasks(),
        api.runs(),
      ]);

      setActivity({
        entries: activityEntries,
        unreadCount: activityEntries.filter((entry) => !entry.read).length,
      });
      setProjects(projectItems);
      setSessions(sessionItems);
      setTasks(taskItems);
      setRuns(runResult);
    } catch {
      // Ignore bootstrap failures — manual refresh + SSE reconnect remain available.
    }
  }, [setActivity, setProjects, setRuns, setSessions, setTasks]);

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
                    <Route path="/" element={<Layout />}>
                      <Route index element={<Navigate to="/conversations" replace />} />
                      <Route path="conversations" element={suspendRoute(<ConversationsPage />)} />
                      <Route path="conversations/new" element={suspendRoute(<ConversationPage draft />)} />
                      <Route path="conversations/:id" element={suspendRoute(<ConversationPage />)} />
                      <Route path="inbox" element={<InboxPage />} />
                      <Route path="inbox/:id" element={<InboxPage />} />
                      <Route path="knowledge" element={suspendRoute(<KnowledgeBasePage />)} />
                      <Route path="capabilities" element={suspendRoute(<CapabilitiesPage />)} />
                      <Route path="system" element={suspendRoute(<SystemPage />)} />
                      <Route path="projects" element={suspendRoute(<ProjectsPage />)} />
                      <Route path="projects/:id" element={suspendRoute(<ProjectsPage />)} />
                      <Route path="plans" element={suspendRoute(<AutomationPage />)} />
                      <Route path="memories" element={suspendRoute(<MemoriesPage />)} />
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
