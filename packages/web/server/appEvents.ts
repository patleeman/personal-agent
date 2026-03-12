import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  resolveActivityReadStatePath,
  resolveConversationAttentionStatePath,
  resolveDeferredResumeStateFile,
  resolveProfileActivityConversationLinksDir,
  resolveProfileActivityDir,
  resolveProfileProjectsDir,
} from '@personal-agent/core';
import { logWarn } from './logging.js';

export type AppEventTopic = 'activity' | 'projects' | 'sessions' | 'tasks';

export type AppEvent =
  | { type: 'connected' }
  | { type: 'invalidate'; topics: AppEventTopic[] }
  | { type: 'live_title'; sessionId: string; title: string };

export interface AppEventMonitorOptions {
  repoRoot: string;
  sessionsDir: string;
  taskStateFile: string;
  getCurrentProfile: () => string;
  intervalMs?: number;
}

type TopicSignatures = Record<AppEventTopic, string>;

type AppEventListener = (event: AppEvent) => void;

const DEFAULT_INTERVAL_MS = 2_000;
const listeners = new Set<AppEventListener>();
let monitorHandle: ReturnType<typeof setInterval> | undefined;
let lastProfile: string | null = null;
let lastSignatures: TopicSignatures | null = null;

function readPathSnapshot(path: string): string {
  if (!existsSync(path)) {
    return 'missing';
  }

  const stats = statSync(path);
  if (!stats.isDirectory()) {
    return `file:${stats.size}:${stats.mtimeMs}`;
  }

  const parts: string[] = [];

  const walk = (dirPath: string, relativePath: string) => {
    const dirStats = statSync(dirPath);
    parts.push(`d:${relativePath}:${dirStats.mtimeMs}`);

    const entries = readdirSync(dirPath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const entryPath = join(dirPath, entry.name);
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(entryPath, entryRelativePath);
        continue;
      }

      const entryStats = statSync(entryPath);
      parts.push(`f:${entryRelativePath}:${entryStats.size}:${entryStats.mtimeMs}`);
    }
  };

  walk(path, '');
  return parts.join('|');
}

function createTopicSignatures(options: AppEventMonitorOptions, profile: string): TopicSignatures {
  const activityDir = resolveProfileActivityDir({ profile });
  const activityConversationLinksDir = resolveProfileActivityConversationLinksDir({ profile });
  const projectsDir = resolveProfileProjectsDir({ repoRoot: options.repoRoot, profile });
  const tasksDir = join(options.repoRoot, 'profiles', profile, 'agent', 'tasks');
  const readStateFile = resolveActivityReadStatePath({ profile });
  const conversationAttentionStateFile = resolveConversationAttentionStatePath({ profile });
  const deferredResumeStateFile = resolveDeferredResumeStateFile();

  const activitySignature = `activity:${readPathSnapshot(activityDir)}|links:${readPathSnapshot(activityConversationLinksDir)}|read:${readPathSnapshot(readStateFile)}`;

  return {
    activity: activitySignature,
    projects: `projects:${readPathSnapshot(projectsDir)}`,
    sessions: `sessions:${readPathSnapshot(options.sessionsDir)}|attention:${readPathSnapshot(conversationAttentionStateFile)}|deferred:${readPathSnapshot(deferredResumeStateFile)}|${activitySignature}`,
    tasks: `tasks:${readPathSnapshot(tasksDir)}|state:${readPathSnapshot(options.taskStateFile)}`,
  };
}

export function diffTopicSignatures(previous: TopicSignatures | null, next: TopicSignatures): AppEventTopic[] {
  if (!previous) {
    return [];
  }

  const changed: AppEventTopic[] = [];
  for (const topic of Object.keys(next) as AppEventTopic[]) {
    if (previous[topic] !== next[topic]) {
      changed.push(topic);
    }
  }

  return changed;
}

export function publishAppEvent(event: AppEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

export function invalidateAppTopics(...topics: AppEventTopic[]): void {
  const uniqueTopics = [...new Set(topics)].sort();
  if (uniqueTopics.length === 0) {
    return;
  }

  publishAppEvent({ type: 'invalidate', topics: uniqueTopics });
}

export function subscribeAppEvents(listener: AppEventListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startAppEventMonitor(options: AppEventMonitorOptions): void {
  if (monitorHandle) {
    return;
  }

  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;

  const tick = () => {
    const profile = options.getCurrentProfile();
    const nextSignatures = createTopicSignatures(options, profile);

    if (lastProfile !== profile) {
      lastProfile = profile;
      lastSignatures = nextSignatures;
      invalidateAppTopics('activity', 'projects', 'sessions', 'tasks');
      return;
    }

    const changedTopics = diffTopicSignatures(lastSignatures, nextSignatures);
    lastSignatures = nextSignatures;
    if (changedTopics.length > 0) {
      invalidateAppTopics(...changedTopics);
    }
  };

  tick();
  monitorHandle = setInterval(() => {
    try {
      tick();
    } catch (error) {
      logWarn('app event monitor failed', {
        message: (error as Error).message,
      });
    }
  }, intervalMs);
}
