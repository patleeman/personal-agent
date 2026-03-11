import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { api } from './api';
import { TasksPage } from './pages/TasksPage';
import { Layout } from './components/Layout';
import { ConversationPage } from './pages/ConversationPage';
import { InboxPage } from './pages/InboxPage';
import { MemoryPage } from './pages/MemoryPage';
import { ProjectsPage } from './pages/ProjectsPage';
import {
  AppDataContext,
  AppEventsContext,
  INITIAL_APP_EVENT_VERSIONS,
  LiveTitlesContext,
  SseConnectionContext,
} from './contexts';
import type {
  ActivitySnapshot,
  AppEvent,
  AppEventTopic,
  ProjectRecord,
  ScheduledTaskSummary,
  SessionMeta,
} from './types';

function LegacyTaskRoutesRedirect() {
  const { id } = useParams<{ id?: string }>();
  return <Navigate to={id ? `/scheduled/${id}` : '/scheduled'} replace />;
}

async function fetchSessionsSnapshot(): Promise<SessionMeta[]> {
  const [jsonl, live] = await Promise.all([api.sessions(), api.liveSessions()]);
  const jsonlIds = new Set(jsonl.map((session) => session.id));
  const syntheticLive: SessionMeta[] = live
    .filter((entry) => !jsonlIds.has(entry.id))
    .map((entry) => ({
      id: entry.id,
      file: entry.sessionFile,
      timestamp: new Date().toISOString(),
      cwd: entry.cwd,
      cwdSlug: entry.cwd.replace(/\//g, '-'),
      model: '',
      title: '(new conversation)',
      messageCount: 0,
    }));

  return [...syntheticLive, ...jsonl];
}

export function App() {
  const [titleMap, setTitleMap] = useState<Map<string, string>>(new Map());
  const [eventVersions, setEventVersions] = useState(INITIAL_APP_EVENT_VERSIONS);
  const [sseStatus, setSseStatus] = useState<'connecting' | 'open' | 'reconnecting' | 'offline'>('connecting');
  const [activity, setActivityState] = useState<ActivitySnapshot | null>(null);
  const [projects, setProjectsState] = useState<ProjectRecord[] | null>(null);
  const [sessions, setSessionsState] = useState<SessionMeta[] | null>(null);
  const [tasks, setTasksState] = useState<ScheduledTaskSummary[] | null>(null);
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

  const bootstrapSnapshots = useCallback(async () => {
    try {
      const [activityEntries, projectItems, sessionItems, taskItems] = await Promise.all([
        api.activity(),
        api.projects(),
        fetchSessionsSnapshot(),
        api.tasks(),
      ]);

      setActivity({
        entries: activityEntries,
        unreadCount: activityEntries.filter((entry) => !entry.read).length,
      });
      setProjects(projectItems);
      setSessions(sessionItems);
      setTasks(taskItems);
    } catch {
      // Ignore bootstrap failures — manual refresh + SSE reconnect remain available.
    }
  }, [setActivity, setProjects, setSessions, setTasks]);

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
  }, [bootstrapSnapshots, setActivity, setProjects, setSessions, setTasks, setTitle]);

  return (
    <AppEventsContext.Provider value={{ versions: eventVersions }}>
      <SseConnectionContext.Provider value={{ status: sseStatus }}>
        <AppDataContext.Provider value={{ activity, projects, sessions, tasks, setActivity, setProjects, setSessions, setTasks }}>
          <LiveTitlesContext.Provider value={{ titles: titleMap, setTitle }}>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Layout />}>
                  <Route index element={<Navigate to="/inbox" replace />} />
                  <Route path="conversations/:id" element={<ConversationPage />} />
                  <Route path="inbox" element={<InboxPage />} />
                  <Route path="inbox/:id" element={<InboxPage />} />
                  <Route path="projects" element={<ProjectsPage />} />
                  <Route path="projects/:id" element={<ProjectsPage />} />
                  <Route path="scheduled" element={<TasksPage />} />
                  <Route path="scheduled/:id" element={<TasksPage />} />
                  <Route path="automations" element={<LegacyTaskRoutesRedirect />} />
                  <Route path="automations/:id" element={<LegacyTaskRoutesRedirect />} />
                  <Route path="tasks" element={<LegacyTaskRoutesRedirect />} />
                  <Route path="tasks/:id" element={<LegacyTaskRoutesRedirect />} />
                  <Route path="memory" element={<MemoryPage />} />
                </Route>
              </Routes>
            </BrowserRouter>
          </LiveTitlesContext.Provider>
        </AppDataContext.Provider>
      </SseConnectionContext.Provider>
    </AppEventsContext.Provider>
  );
}
