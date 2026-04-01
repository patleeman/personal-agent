import { existsSync, readdirSync, statSync, watch, type Dirent, type FSWatcher } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import {
  getDurableTasksDir,
  getMachineConfigFilePath,
  getStateRoot,
  resolveActivityReadStatePath,
  resolveConversationAttentionStatePath,
  resolveDeferredResumeStateFile,
  resolveProfileAlertsStateFile,
  resolveProfileConversationAttachmentsDir,
  resolveExecutionTargetsFilePath,
  resolveProfileActivityConversationLinksDir,
  resolveProfileActivityDir,
  resolveProfileConversationArtifactsDir,
  resolveProfileConversationLinksDir,
  resolveProfileProjectsDir,
} from '@personal-agent/core';
import { getDaemonConfigFilePath, loadDaemonConfig, resolveDaemonPaths, resolveDurableRunsRoot } from '@personal-agent/daemon';
import { logWarn } from './logging.js';

export type AppEventTopic =
  | 'activity'
  | 'alerts'
  | 'projects'
  | 'sessions'
  | 'sessionFiles'
  | 'artifacts'
  | 'attachments'
  | 'tasks'
  | 'runs'
  | 'automation'
  | 'daemon'
  | 'sync'
  | 'webUi'
  | 'executionTargets'
  | 'workspace';

export type AppEvent =
  | { type: 'connected' }
  | { type: 'invalidate'; topics: AppEventTopic[] }
  | { type: 'live_title'; sessionId: string; title: string }
  | { type: 'session_meta_changed'; sessionId: string };

export interface AppEventMonitorOptions {
  repoRoot: string;
  sessionsDir: string;
  taskStateFile: string;
  profileConfigFile: string;
  getCurrentProfile: () => string;
  intervalMs?: number;
}

type AppEventWatchKind = 'change' | 'rename';

interface AppEventWatchSource {
  path: string;
  kind: 'file' | 'directory';
  eventKinds?: readonly AppEventWatchKind[];
}

type TopicSources = Record<AppEventTopic, AppEventWatchSource[]>;
type AppEventListener = (event: AppEvent) => void;
type WatchStop = () => void;

interface AppEventWatchTarget {
  path: string;
  topics: Set<AppEventTopic>;
  recursive: boolean;
  rebuildOnEvent: boolean;
  filterName?: string;
  eventKinds?: readonly AppEventWatchKind[];
}

const ALL_TOPICS: AppEventTopic[] = [
  'activity',
  'alerts',
  'projects',
  'sessions',
  'sessionFiles',
  'artifacts',
  'attachments',
  'tasks',
  'runs',
  'automation',
  'daemon',
  'sync',
  'webUi',
  'executionTargets',
  'workspace',
];
const listeners = new Set<AppEventListener>();
let monitorStop: WatchStop | undefined;

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function collectDirectoryTree(root: string): string[] {
  if (!isDirectory(root)) {
    return [];
  }

  const directories: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    directories.push(current);

    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      stack.push(join(current, entry.name));
    }
  }

  directories.sort((left, right) => left.localeCompare(right));
  return directories;
}

function normalizeWatchFilename(filename: string | Buffer | null | undefined): string | null {
  if (typeof filename === 'string') {
    return filename;
  }

  if (filename instanceof Buffer) {
    return filename.toString('utf-8');
  }

  return null;
}

function matchesWatchFilename(filename: string | Buffer | null | undefined, filterName: string | undefined): boolean {
  if (!filterName) {
    return true;
  }

  const normalized = normalizeWatchFilename(filename);
  if (!normalized) {
    return true;
  }

  return basename(normalized) === filterName;
}

function findNearestExistingDirectory(path: string): string {
  let current = path;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return current;
    }

    current = parent;
  }

  return isDirectory(current) ? current : dirname(current);
}

function createTopicSources(options: AppEventMonitorOptions, profile: string): TopicSources {
  const daemonConfig = loadDaemonConfig();
  const daemonPaths = resolveDaemonPaths(daemonConfig.ipc.socketPath);
  const daemonRoot = daemonPaths.root;
  const activityDirs = [
    resolveProfileActivityDir({ profile }),
    resolveProfileActivityDir({ stateRoot: daemonRoot, profile }),
  ];
  const activityConversationLinksDirs = [
    resolveProfileActivityConversationLinksDir({ profile }),
    resolveProfileActivityConversationLinksDir({ stateRoot: daemonRoot, profile }),
  ];
  const readStateFiles = [
    resolveActivityReadStatePath({ profile }),
    resolveActivityReadStatePath({ stateRoot: daemonRoot, profile }),
  ];
  const projectsDir = resolveProfileProjectsDir({ repoRoot: options.repoRoot, profile });
  const conversationLinksDir = resolveProfileConversationLinksDir({ profile });
  const conversationArtifactsDir = resolveProfileConversationArtifactsDir({ profile });
  const conversationAttachmentsDir = resolveProfileConversationAttachmentsDir({ profile });
  const tasksDir = getDurableTasksDir();
  const runsRoot = resolveDurableRunsRoot(dirname(options.taskStateFile));
  const conversationAttentionStateFile = resolveConversationAttentionStatePath({ profile });
  const deferredResumeStateFile = resolveDeferredResumeStateFile();
  const alertsStateFile = resolveProfileAlertsStateFile({ profile });
  const syncRepoDir = daemonConfig.modules.sync?.repoDir;
  const webStateDir = join(getStateRoot(), 'web');

  const activitySources: AppEventWatchSource[] = [
    ...activityDirs.map((path) => ({ path, kind: 'directory' as const })),
    ...activityConversationLinksDirs.map((path) => ({ path, kind: 'directory' as const })),
    ...readStateFiles.map((path) => ({ path, kind: 'file' as const })),
  ];

  return {
    activity: activitySources,
    alerts: [
      { path: alertsStateFile, kind: 'file' },
    ],
    projects: [
      { path: projectsDir, kind: 'directory' },
      { path: conversationLinksDir, kind: 'directory' },
    ],
    sessions: [
      { path: conversationAttentionStateFile, kind: 'file' },
      { path: deferredResumeStateFile, kind: 'file' },
      { path: alertsStateFile, kind: 'file' },
      ...activitySources,
    ],
    sessionFiles: [
      { path: options.sessionsDir, kind: 'directory', eventKinds: ['change', 'rename'] },
    ],
    artifacts: [
      { path: conversationArtifactsDir, kind: 'directory' },
    ],
    attachments: [
      { path: conversationAttachmentsDir, kind: 'directory' },
    ],
    tasks: [
      { path: tasksDir, kind: 'directory' },
      { path: options.taskStateFile, kind: 'file' },
    ],
    runs: [{ path: runsRoot, kind: 'directory' }],
    automation: [],
    daemon: [
      { path: getDaemonConfigFilePath(), kind: 'file' },
      { path: daemonPaths.socketPath, kind: 'file' },
    ],
    sync: [
      { path: getDaemonConfigFilePath(), kind: 'file' },
      { path: daemonPaths.socketPath, kind: 'file' },
      ...(syncRepoDir ? [{ path: syncRepoDir, kind: 'directory' as const }] : []),
    ],
    webUi: [
      { path: getMachineConfigFilePath(), kind: 'file' },
      { path: join(webStateDir, 'deploy-state.json'), kind: 'file' },
      { path: join(webStateDir, 'app-restart.lock.json'), kind: 'file' },
    ],
    executionTargets: [{ path: resolveExecutionTargetsFilePath(), kind: 'file' }],
    workspace: [],
  };
}

function buildWatchTargets(options: AppEventMonitorOptions, profile: string): AppEventWatchTarget[] {
  const topicSources = createTopicSources(options, profile);
  const targets = new Map<string, AppEventWatchTarget>();

  const addTarget = (target: Omit<AppEventWatchTarget, 'topics'>, topic: AppEventTopic) => {
    const key = [
      target.path,
      target.recursive ? 'recursive' : 'basic',
      target.rebuildOnEvent ? 'rebuild' : 'steady',
      target.filterName ?? '*',
      target.eventKinds?.join(',') ?? '*',
    ].join('|');

    const existing = targets.get(key);
    if (existing) {
      existing.topics.add(topic);
      return;
    }

    targets.set(key, {
      ...target,
      topics: new Set([topic]),
    });
  };

  for (const topic of ALL_TOPICS) {
    for (const source of topicSources[topic]) {
      if (source.kind === 'file') {
        const parent = dirname(source.path);
        if (isDirectory(parent)) {
          addTarget({
            path: parent,
            recursive: false,
            rebuildOnEvent: false,
            filterName: basename(source.path),
            eventKinds: source.eventKinds,
          }, topic);
          continue;
        }

        addTarget({
          path: findNearestExistingDirectory(parent),
          recursive: true,
          rebuildOnEvent: true,
          filterName: basename(source.path),
          eventKinds: source.eventKinds,
        }, topic);
        continue;
      }

      if (isDirectory(source.path)) {
        addTarget({
          path: source.path,
          recursive: true,
          rebuildOnEvent: false,
          eventKinds: source.eventKinds,
        }, topic);

        const parent = dirname(source.path);
        if (isDirectory(parent)) {
          addTarget({
            path: parent,
            recursive: false,
            rebuildOnEvent: true,
            filterName: basename(source.path),
            eventKinds: source.eventKinds,
          }, topic);
        }
        continue;
      }

      const parent = dirname(source.path);
      if (isDirectory(parent)) {
        addTarget({
          path: parent,
          recursive: false,
          rebuildOnEvent: true,
          filterName: basename(source.path),
          eventKinds: source.eventKinds,
        }, topic);
        continue;
      }

      addTarget({
        path: findNearestExistingDirectory(parent),
        recursive: true,
        rebuildOnEvent: true,
        filterName: basename(source.path),
        eventKinds: source.eventKinds,
      }, topic);
    }
  }

  return [...targets.values()];
}

function startBasicWatch(path: string, onEvent: (eventKind: AppEventWatchKind, filename?: string | Buffer | null) => void): WatchStop {
  const watcher = watch(path, { persistent: false }, (eventType, filename) => {
    onEvent(eventType === 'rename' ? 'rename' : 'change', filename);
  });

  return () => watcher.close();
}

function startManualDirectoryTreeWatch(path: string, onEvent: (eventKind: AppEventWatchKind, filename?: string | Buffer | null) => void): WatchStop {
  const watchers = new Map<string, FSWatcher>();
  let syncTimer: ReturnType<typeof setTimeout> | undefined;

  const sync = () => {
    const nextDirectories = new Set(collectDirectoryTree(path));

    for (const [directory, watcher] of watchers) {
      if (nextDirectories.has(directory)) {
        continue;
      }

      watcher.close();
      watchers.delete(directory);
    }

    for (const directory of nextDirectories) {
      if (watchers.has(directory)) {
        continue;
      }

      try {
        const watcher = watch(directory, { persistent: false }, (eventType, filename) => {
          onEvent(eventType === 'rename' ? 'rename' : 'change', filename);
          scheduleSync();
        });
        watchers.set(directory, watcher);
      } catch (error) {
        logWarn('app event watch registration failed', {
          path: directory,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  };

  const scheduleSync = () => {
    if (syncTimer) {
      return;
    }

    syncTimer = setTimeout(() => {
      syncTimer = undefined;
      sync();
    }, 75);
  };

  sync();

  return () => {
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = undefined;
    }

    for (const watcher of watchers.values()) {
      watcher.close();
    }
    watchers.clear();
  };
}

function startDirectoryTreeWatch(path: string, onEvent: (eventKind: AppEventWatchKind, filename?: string | Buffer | null) => void): WatchStop {
  try {
    const watcher = watch(path, { persistent: false, recursive: true }, (eventType, filename) => {
      onEvent(eventType === 'rename' ? 'rename' : 'change', filename);
    });

    return () => watcher.close();
  } catch (error) {
    const code = typeof error === 'object' && error && 'code' in error
      ? String((error as { code?: unknown }).code)
      : '';
    if (code !== 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM') {
      throw error;
    }
  }

  return startManualDirectoryTreeWatch(path, onEvent);
}

function startWatchTarget(
  target: AppEventWatchTarget,
  onTopics: (topics: Iterable<AppEventTopic>) => void,
  scheduleRebuild: () => void,
): WatchStop {
  const handleEvent = (eventKind: AppEventWatchKind, filename?: string | Buffer | null) => {
    if (!matchesWatchFilename(filename, target.filterName)) {
      return;
    }

    if (target.eventKinds && !target.eventKinds.includes(eventKind)) {
      return;
    }

    onTopics(target.topics);
    if (target.rebuildOnEvent) {
      scheduleRebuild();
    }
  };

  try {
    return target.recursive
      ? startDirectoryTreeWatch(target.path, handleEvent)
      : startBasicWatch(target.path, handleEvent);
  } catch (error) {
    logWarn('app event watch registration failed', {
      path: target.path,
      message: error instanceof Error ? error.message : String(error),
    });
    scheduleRebuild();
    return () => {};
  }
}

function startProfileConfigWatch(profileConfigFile: string, onChange: () => void): WatchStop {
  const parent = dirname(profileConfigFile);
  if (isDirectory(parent)) {
    return startBasicWatch(parent, (_eventKind, filename) => {
      if (!matchesWatchFilename(filename, basename(profileConfigFile))) {
        return;
      }

      onChange();
    });
  }

  const ancestor = findNearestExistingDirectory(parent);
  return startDirectoryTreeWatch(ancestor, () => {
    onChange();
  });
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

export function stopAppEventMonitor(): void {
  monitorStop?.();
}

export function startAppEventMonitor(options: AppEventMonitorOptions): void {
  if (monitorStop) {
    return;
  }

  let watcherStops: WatchStop[] = [];
  let profileWatcherStop: WatchStop | undefined;
  let currentProfile = options.getCurrentProfile();
  let invalidateTimer: ReturnType<typeof setTimeout> | undefined;
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  const pendingTopics = new Set<AppEventTopic>();

  const flushInvalidations = () => {
    invalidateTimer = undefined;
    if (pendingTopics.size === 0) {
      return;
    }

    const topics = [...pendingTopics];
    pendingTopics.clear();
    invalidateAppTopics(...topics);
  };

  const queueInvalidation = (topics: Iterable<AppEventTopic>) => {
    for (const topic of topics) {
      pendingTopics.add(topic);
    }

    if (invalidateTimer) {
      return;
    }

    invalidateTimer = setTimeout(flushInvalidations, 75);
  };

  const rebuildWatchers = () => {
    for (const stop of watcherStops) {
      stop();
    }
    watcherStops = buildWatchTargets(options, currentProfile)
      .map((target) => startWatchTarget(target, queueInvalidation, scheduleRebuild));
  };

  const refreshProfile = () => {
    const nextProfile = options.getCurrentProfile();
    const profileChanged = nextProfile !== currentProfile;
    currentProfile = nextProfile;
    rebuildWatchers();

    if (profileChanged) {
      queueInvalidation(ALL_TOPICS);
    }
  };

  const scheduleRebuild = () => {
    if (rebuildTimer) {
      return;
    }

    rebuildTimer = setTimeout(() => {
      rebuildTimer = undefined;
      try {
        refreshProfile();
      } catch (error) {
        logWarn('app event watch refresh failed', {
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }, 75);
  };

  rebuildWatchers();
  profileWatcherStop = startProfileConfigWatch(options.profileConfigFile, scheduleRebuild);

  monitorStop = () => {
    if (invalidateTimer) {
      clearTimeout(invalidateTimer);
      invalidateTimer = undefined;
    }
    if (rebuildTimer) {
      clearTimeout(rebuildTimer);
      rebuildTimer = undefined;
    }

    for (const stop of watcherStops) {
      stop();
    }
    watcherStops = [];
    profileWatcherStop?.();
    profileWatcherStop = undefined;
    pendingTopics.clear();
    monitorStop = undefined;
  };
}
