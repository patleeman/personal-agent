/**
 * Shared React contexts for cross-component state.
 */
import { createContext, useContext } from 'react';
import type {
  ActivitySnapshot,
  AppEventTopic,
  ProjectRecord,
  ScheduledTaskSummary,
  SessionMeta,
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
  projects: 0,
  sessions: 0,
  tasks: 0,
  runs: 0,
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
  projects: ProjectRecord[] | null;
  sessions: SessionMeta[] | null;
  tasks: ScheduledTaskSummary[] | null;
  setActivity: (snapshot: ActivitySnapshot) => void;
  setProjects: (projects: ProjectRecord[]) => void;
  setSessions: (sessions: SessionMeta[]) => void;
  setTasks: (tasks: ScheduledTaskSummary[]) => void;
}

export const AppDataContext = createContext<AppDataContextValue>({
  activity: null,
  projects: null,
  sessions: null,
  tasks: null,
  setActivity: () => {},
  setProjects: () => {},
  setSessions: () => {},
  setTasks: () => {},
});

export function useAppData() {
  return useContext(AppDataContext);
}
