/**
 * Shared React contexts for cross-component state.
 */
import { createContext, useContext } from 'react';
import type {
  ActivitySnapshot,
  AlertSnapshot,
  AppEventTopic,
  DaemonState,
  DurableRunListResult,
  ProjectRecord,
  ScheduledTaskSummary,
  SessionMeta,
  SyncState,
  WebUiState,
} from './types';

// ── Live title overrides ──────────────────────────────────────────────────────
// ConversationPage pushes stream.title here; Sidebar reads it to update tabs/archive.

export interface LiveTitlesContextValue {
  titles: Map<string, string>;
  setTitle: (id: string, title: string) => void;
}

export const LiveTitlesContext = createContext<LiveTitlesContextValue>({
  titles: new Map(),
  setTitle: () => {},
});

export function useLiveTitles() {
  return useContext(LiveTitlesContext);
}

export type AppEventVersions = Record<AppEventTopic, number>;

export const INITIAL_APP_EVENT_VERSIONS: AppEventVersions = {
  activity: 0,
  alerts: 0,
  projects: 0,
  sessions: 0,
  tasks: 0,
  runs: 0,
  automation: 0,
  daemon: 0,
  sync: 0,
  webUi: 0,
  executionTargets: 0,
  workspace: 0,
};

export interface AppEventsContextValue {
  versions: AppEventVersions;
}

export const AppEventsContext = createContext<AppEventsContextValue>({
  versions: INITIAL_APP_EVENT_VERSIONS,
});

export function useAppEvents() {
  return useContext(AppEventsContext);
}

export type SseConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'offline';

export interface SseConnectionContextValue {
  status: SseConnectionStatus;
}

export const SseConnectionContext = createContext<SseConnectionContextValue>({
  status: 'connecting',
});

export function useSseConnection() {
  return useContext(SseConnectionContext);
}

export interface AppDataContextValue {
  activity: ActivitySnapshot | null;
  alerts?: AlertSnapshot | null;
  projects: ProjectRecord[] | null;
  sessions: SessionMeta[] | null;
  tasks: ScheduledTaskSummary[] | null;
  runs: DurableRunListResult | null;
  setActivity: (snapshot: ActivitySnapshot) => void;
  setAlerts?: (snapshot: AlertSnapshot) => void;
  setProjects: (projects: ProjectRecord[]) => void;
  setSessions: (sessions: SessionMeta[]) => void;
  setTasks: (tasks: ScheduledTaskSummary[]) => void;
  setRuns: (runs: DurableRunListResult) => void;
}

export const AppDataContext = createContext<AppDataContextValue>({
  activity: null,
  alerts: null,
  projects: null,
  sessions: null,
  tasks: null,
  runs: null,
  setActivity: () => {},
  setAlerts: () => {},
  setProjects: () => {},
  setSessions: () => {},
  setTasks: () => {},
  setRuns: () => {},
});

export function useAppData() {
  return useContext(AppDataContext);
}

export interface SystemStatusContextValue {
  daemon: DaemonState | null;
  sync: SyncState | null;
  webUi: WebUiState | null;
  setDaemon: (value: DaemonState) => void;
  setSync: (value: SyncState) => void;
  setWebUi: (value: WebUiState) => void;
}

export const SystemStatusContext = createContext<SystemStatusContextValue>({
  daemon: null,
  sync: null,
  webUi: null,
  setDaemon: () => {},
  setSync: () => {},
  setWebUi: () => {},
});

export function useSystemStatus() {
  return useContext(SystemStatusContext);
}
