import { dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  directories,
  entriesByDir,
  existingPaths,
  existsSyncMock,
  getDaemonConfigFilePathMock,
  getDurableTasksDirMock,
  getMachineConfigFilePathMock,
  getStateRootMock,
  loadDaemonConfigMock,
  clearDurableRunsListCacheMock,
  logWarnMock,
  readKnownSessionIdByFilePathMock,
  readdirSyncMock,
  resolveConversationAttentionStatePathMock,
  resolveDaemonPathsMock,
  resolveDeferredResumeStateFileMock,
  resolveDurableRunsRootMock,
  resolveProfileActivityConversationLinksDirMock,
  resolveProfileActivityStateDirMock,
  resolveProfileAlertsStateFileMock,
  resolveProfileConversationArtifactsDirMock,
  resolveProfileConversationAttachmentsDirMock,
  resolveProfileConversationCommitCheckpointsDirMock,
  statSyncMock,
  unsupportedRecursivePaths,
  watchErrorsByPath,
  watchRegistrations,
  watchMock,
} = vi.hoisted(() => {
  const directories = new Set<string>();
  const existingPaths = new Set<string>();
  const entriesByDir = new Map<string, Array<{ name: string; isDirectory: () => boolean }>>();
  const unsupportedRecursivePaths = new Set<string>();
  const watchErrorsByPath = new Map<string, Error>();
  const watchRegistrations: Array<{
    path: string;
    options: Record<string, unknown>;
    callback: (eventType: string, filename?: string | Buffer | null) => void;
    close: ReturnType<typeof vi.fn>;
  }> = [];

  const existsSyncMock = vi.fn((path: string) => existingPaths.has(path));
  const statSyncMock = vi.fn((path: string) => {
    if (!existingPaths.has(path)) {
      throw new Error(`ENOENT: ${path}`);
    }

    return {
      isDirectory: () => directories.has(path),
    };
  });
  const readdirSyncMock = vi.fn((path: string) => entriesByDir.get(path) ?? []);
  const watchMock = vi.fn((path: string, options: Record<string, unknown>, callback: (eventType: string, filename?: string | Buffer | null) => void) => {
    if (options.recursive && unsupportedRecursivePaths.has(path)) {
      const error = new Error(`recursive watch unsupported for ${path}`) as Error & { code?: string };
      error.code = 'ERR_FEATURE_UNAVAILABLE_ON_PLATFORM';
      throw error;
    }

    const explicitError = watchErrorsByPath.get(path);
    if (explicitError) {
      throw explicitError;
    }

    const close = vi.fn();
    watchRegistrations.push({ path, options, callback, close });
    return { close };
  });

  return {
    directories,
    entriesByDir,
    existingPaths,
    existsSyncMock,
    getDaemonConfigFilePathMock: vi.fn(() => '/daemon/config.json'),
    getDurableTasksDirMock: vi.fn(() => '/tasks'),
    getMachineConfigFilePathMock: vi.fn(() => '/machine/config.json'),
    getStateRootMock: vi.fn(() => '/state'),
    loadDaemonConfigMock: vi.fn(() => ({ ipc: { socketPath: '/daemon/socket.sock' } })),
    clearDurableRunsListCacheMock: vi.fn(),
    logWarnMock: vi.fn(),
    readKnownSessionIdByFilePathMock: vi.fn((filePath: string) => (filePath.includes('conv-1') ? ' conv-1 ' : undefined)),
    readdirSyncMock,
    resolveConversationAttentionStatePathMock: vi.fn(({ profile }: { profile: string }) => `/attention/${profile}.json`),
    resolveDaemonPathsMock: vi.fn(() => ({ root: '/daemon-root', socketPath: '/daemon/socket.sock' })),
    resolveDeferredResumeStateFileMock: vi.fn(() => '/state/deferred.json'),
    resolveDurableRunsRootMock: vi.fn(() => '/runs'),
    resolveProfileActivityConversationLinksDirMock: vi.fn(({ stateRoot, profile }: { stateRoot?: string; profile: string }) => `${stateRoot ?? '/state'}/activity-links/${profile}`),
    resolveProfileActivityStateDirMock: vi.fn(({ stateRoot, profile }: { stateRoot?: string; profile: string }) => `${stateRoot ?? '/state'}/activity/${profile}`),
    resolveProfileAlertsStateFileMock: vi.fn(({ profile }: { profile: string }) => `/alerts/${profile}.json`),
    resolveProfileConversationArtifactsDirMock: vi.fn(({ profile }: { profile: string }) => `/artifacts/${profile}`),
    resolveProfileConversationAttachmentsDirMock: vi.fn(({ profile }: { profile: string }) => `/attachments/${profile}`),
    resolveProfileConversationCommitCheckpointsDirMock: vi.fn(({ profile }: { profile: string }) => `/commit-checkpoints/${profile}`),
    statSyncMock,
    unsupportedRecursivePaths,
    watchErrorsByPath,
    watchRegistrations,
    watchMock,
  };
});

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
  readdirSync: readdirSyncMock,
  statSync: statSyncMock,
  watch: watchMock,
}));

vi.mock('@personal-agent/core', () => ({
  getDurableTasksDir: getDurableTasksDirMock,
  getMachineConfigFilePath: getMachineConfigFilePathMock,
  getStateRoot: getStateRootMock,
  resolveConversationAttentionStatePath: resolveConversationAttentionStatePathMock,
  resolveDeferredResumeStateFile: resolveDeferredResumeStateFileMock,
  resolveProfileAlertsStateFile: resolveProfileAlertsStateFileMock,
  resolveProfileConversationAttachmentsDir: resolveProfileConversationAttachmentsDirMock,
  resolveProfileConversationCommitCheckpointsDir: resolveProfileConversationCommitCheckpointsDirMock,
  resolveProfileActivityConversationLinksDir: resolveProfileActivityConversationLinksDirMock,
  resolveProfileActivityStateDir: resolveProfileActivityStateDirMock,
  resolveProfileConversationArtifactsDir: resolveProfileConversationArtifactsDirMock,
}));

vi.mock('@personal-agent/daemon', () => ({
  getDaemonConfigFilePath: getDaemonConfigFilePathMock,
  loadDaemonConfig: loadDaemonConfigMock,
  resolveDaemonPaths: resolveDaemonPathsMock,
  resolveDurableRunsRoot: resolveDurableRunsRootMock,
}));

vi.mock('../automation/durableRuns.js', () => ({
  clearDurableRunsListCache: clearDurableRunsListCacheMock,
}));

vi.mock('../conversations/sessions.js', () => ({
  readKnownSessionIdByFilePath: readKnownSessionIdByFilePathMock,
}));

vi.mock('./logging.js', () => ({
  logWarn: logWarnMock,
}));

import {
  invalidateAppTopics,
  publishAppEvent,
  startAppEventMonitor,
  stopAppEventMonitor,
  subscribeAppEvents,
} from './appEvents.js';

function markDirectory(path: string): void {
  let current = path;
  let complete = false;
  while (!complete) {
    directories.add(current);
    existingPaths.add(current);
    if (current === '/') {
      complete = true;
    } else {
      current = dirname(current);
    }
  }
}

function markFile(path: string): void {
  markDirectory(dirname(path));
  existingPaths.add(path);
}

function seedBaseFs(): void {
  markDirectory('/sessions');
  markDirectory('/state/activity/assistant');
  markDirectory('/daemon-root/activity/assistant');
  markDirectory('/state/activity-links/assistant');
  markDirectory('/daemon-root/activity-links/assistant');
  markDirectory('/artifacts/assistant');
  markDirectory('/attachments/assistant');
  markDirectory('/tasks');
  markDirectory('/runs');
  markDirectory('/state/web');
  markFile('/state/daemon/task-state.json');
  markFile('/state/daemon/task-state.json-wal');
  markFile('/state/daemon/task-state.json-shm');
  markFile('/attention/assistant.json');
  markFile('/state/deferred.json');
  markFile('/alerts/assistant.json');
  markFile('/daemon/config.json');
  markFile('/daemon/socket.sock');
  markFile('/machine/config.json');
  markFile('/state/web/deploy-state.json');
  markFile('/state/web/app-restart.lock.json');
  markFile('/config/profile.json');
}

function getLatestWatch(path: string, predicate?: (registration: (typeof watchRegistrations)[number]) => boolean) {
  const registration = [...watchRegistrations].reverse().find((entry) => entry.path === path && (!predicate || predicate(entry)));
  expect(registration).toBeDefined();
  return registration!;
}

describe('appEvents mocked behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    directories.clear();
    entriesByDir.clear();
    existingPaths.clear();
    unsupportedRecursivePaths.clear();
    watchErrorsByPath.clear();
    watchRegistrations.splice(0);
    existsSyncMock.mockClear();
    getDaemonConfigFilePathMock.mockClear();
    getDurableTasksDirMock.mockClear();
    getMachineConfigFilePathMock.mockClear();
    getStateRootMock.mockClear();
    loadDaemonConfigMock.mockClear();
    clearDurableRunsListCacheMock.mockClear();
    logWarnMock.mockReset();
    readKnownSessionIdByFilePathMock.mockClear();
    readdirSyncMock.mockClear();
    resolveConversationAttentionStatePathMock.mockClear();
    resolveDaemonPathsMock.mockClear();
    resolveDeferredResumeStateFileMock.mockClear();
    resolveDurableRunsRootMock.mockClear();
    resolveProfileActivityConversationLinksDirMock.mockClear();
    resolveProfileActivityStateDirMock.mockClear();
    resolveProfileAlertsStateFileMock.mockClear();
    resolveProfileConversationArtifactsDirMock.mockClear();
    resolveProfileConversationAttachmentsDirMock.mockClear();
    statSyncMock.mockClear();
    watchMock.mockClear();
    seedBaseFs();
  });

  afterEach(() => {
    stopAppEventMonitor();
    vi.useRealTimers();
  });

  it('dedupes invalidation events and stops delivering after unsubscribe', () => {
    const events: unknown[] = [];
    const unsubscribe = subscribeAppEvents((event) => {
      events.push(event);
    });

    invalidateAppTopics('runs', 'tasks', 'runs');
    invalidateAppTopics();
    unsubscribe();
    publishAppEvent({ type: 'connected' });

    expect(events).toEqual([
      { type: 'invalidate', topics: ['runs', 'tasks'] },
    ]);
    expect(clearDurableRunsListCacheMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to manual directory tree watches and emits session file changes from buffer filenames', () => {
    unsupportedRecursivePaths.add('/sessions');
    markDirectory('/sessions/nested');
    entriesByDir.set('/sessions', [{ name: 'nested', isDirectory: () => true }]);
    entriesByDir.set('/sessions/nested', []);

    const events: unknown[] = [];
    const unsubscribe = subscribeAppEvents((event) => {
      events.push(event);
    });

    startAppEventMonitor({
      repoRoot: '/repo',
      sessionsDir: '/sessions',
      taskStateFile: '/state/daemon/task-state.json',
      profileConfigFile: '/config/profile.json',
      getCurrentProfile: () => 'assistant',
    });

    const nestedWatcher = getLatestWatch('/sessions/nested');
    nestedWatcher.callback('change', Buffer.from('conv-1.jsonl'));
    vi.advanceTimersByTime(80);

    expect(events).toContainEqual({ type: 'invalidate', topics: ['sessionFiles'] });
    expect(events).toContainEqual({ type: 'session_file_changed', sessionId: 'conv-1' });
    expect(readKnownSessionIdByFilePathMock).toHaveBeenCalledWith('/sessions/nested/conv-1.jsonl');
    unsubscribe();
  });

  it('logs refresh failures triggered by the profile config watcher', () => {
    let throwOnRefresh = false;
    startAppEventMonitor({
      repoRoot: '/repo',
      sessionsDir: '/sessions',
      taskStateFile: '/state/daemon/task-state.json',
      profileConfigFile: '/config/profile.json',
      getCurrentProfile: () => {
        if (throwOnRefresh) {
          throw new Error('profile lookup failed');
        }
        return 'assistant';
      },
    });

    throwOnRefresh = true;
    const profileWatcher = getLatestWatch('/config', (registration) => !registration.options.recursive);
    profileWatcher.callback('change', 'profile.json');
    vi.advanceTimersByTime(80);

    expect(logWarnMock).toHaveBeenCalledWith('app event watch refresh failed', {
      message: 'profile lookup failed',
    });
  });

  it('clears pending invalidation and rebuild timers when the monitor stops', () => {
    const events: unknown[] = [];
    const unsubscribe = subscribeAppEvents((event) => {
      events.push(event);
    });

    startAppEventMonitor({
      repoRoot: '/repo',
      sessionsDir: '/sessions',
      taskStateFile: '/state/daemon/task-state.json',
      profileConfigFile: '/config/profile.json',
      getCurrentProfile: () => 'assistant',
    });

    getLatestWatch('/sessions', (registration) => registration.options.recursive === true)
      .callback('change', 'conv-1.jsonl');
    getLatestWatch('/config', (registration) => !registration.options.recursive)
      .callback('change', 'profile.json');

    stopAppEventMonitor();
    vi.advanceTimersByTime(100);

    expect(events).toEqual([]);
    expect(watchRegistrations.some((registration) => registration.close.mock.calls.length > 0)).toBe(true);
    unsubscribe();
  });
});
