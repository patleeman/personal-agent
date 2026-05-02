/**
 * Shared React contexts for cross-component state.
 */
import { createContext, useContext } from 'react';
import {
  INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS,
  type ConversationScopedEventVersions,
} from '../conversation/conversationEventVersions';
import type {
  AppEventTopic,
  DaemonState,
  DurableRunListResult,
  ProjectRecord,
  ScheduledTaskSummary,
  SessionMeta,
} from '../shared/types';

// ── Live title overrides ──────────────────────────────────────────────────────
// ConversationPage pushes stream.title here; Sidebar reads it to update tabs/archive.

interface LiveTitlesContextValue {
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

type AppEventVersions = Record<AppEventTopic, number>;

export const INITIAL_APP_EVENT_VERSIONS: AppEventVersions = {
  sessions: 0,
  sessionFiles: 0,
  artifacts: 0,
  checkpoints: 0,
  attachments: 0,
  tasks: 0,
  runs: 0,
  automation: 0,
  daemon: 0,
  workspace: 0,
  knowledgeBase: 0,
};

interface AppEventsContextValue {
  versions: AppEventVersions;
  conversationVersions: ConversationScopedEventVersions;
}

export const AppEventsContext = createContext<AppEventsContextValue>({
  versions: INITIAL_APP_EVENT_VERSIONS,
  conversationVersions: INITIAL_CONVERSATION_SCOPED_EVENT_VERSIONS,
});

export function useAppEvents() {
  return useContext(AppEventsContext);
}

type SseConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'offline';

interface SseConnectionContextValue {
  status: SseConnectionStatus;
}

export const SseConnectionContext = createContext<SseConnectionContextValue>({
  status: 'connecting',
});

export function useSseConnection() {
  return useContext(SseConnectionContext);
}

interface AppDataContextValue {
  projects: ProjectRecord[] | null;
  sessions: SessionMeta[] | null;
  tasks: ScheduledTaskSummary[] | null;
  runs: DurableRunListResult | null;
  setProjects: (projects: ProjectRecord[]) => void;
  setSessions: (sessions: SessionMeta[]) => void;
  setTasks: (tasks: ScheduledTaskSummary[]) => void;
  setRuns: (runs: DurableRunListResult) => void;
}

export const AppDataContext = createContext<AppDataContextValue>({
  projects: null,
  sessions: null,
  tasks: null,
  runs: null,
  setProjects: () => {},
  setSessions: () => {},
  setTasks: () => {},
  setRuns: () => {},
});

export function useAppData() {
  return useContext(AppDataContext);
}

interface SystemStatusContextValue {
  daemon: DaemonState | null;
  setDaemon: (value: DaemonState) => void;
}

export const SystemStatusContext = createContext<SystemStatusContextValue>({
  daemon: null,
  setDaemon: () => {},
});

