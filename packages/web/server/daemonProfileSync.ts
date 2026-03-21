import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getDurableTasksDir, getProfilesRoot } from '@personal-agent/core';
import {
  getDaemonConfigFilePath,
  getDaemonStatus,
  pingDaemon,
  startDaemonDetached,
  stopDaemonGracefully,
  type DaemonStatus,
} from '@personal-agent/daemon';

export interface SyncDaemonTaskScopeOptions {
  profile: string;
  repoRoot: string;
  daemonConfigFile?: string;
}

export interface SyncDaemonTaskScopeResult {
  configUpdated: boolean;
  daemonWasRunning: boolean;
  daemonRestarted: boolean;
  desiredTaskDir: string;
  runningTaskDir?: string;
}

export interface SyncDaemonTaskScopeDependencies {
  pingDaemon: typeof pingDaemon;
  getDaemonStatus: typeof getDaemonStatus;
  stopDaemonGracefully: typeof stopDaemonGracefully;
  startDaemonDetached: typeof startDaemonDetached;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePath(value: string): string {
  return resolve(value).replace(/\\/g, '/').replace(/\/+$/, '');
}

export function resolveProfileTaskDir(_repoRoot: string, _profile: string): string {
  return getDurableTasksDir();
}

export function classifyRepoManagedTaskDir(taskDir: string | undefined, repoRoot: string): 'missing' | 'profiles-root' | 'profile-task-dir' | 'other' {
  if (!taskDir || taskDir.trim().length === 0) {
    return 'missing';
  }

  const normalizedTaskDir = normalizePath(taskDir);
  const candidateProfilesRoots = [...new Set([
    normalizePath(getProfilesRoot()),
    normalizePath(join(repoRoot, 'profiles')),
  ])];

  for (const profilesRoot of candidateProfilesRoots) {
    if (normalizedTaskDir === profilesRoot) {
      return 'profiles-root';
    }

    const relativeToProfiles = normalizedTaskDir.startsWith(`${profilesRoot}/`)
      ? normalizedTaskDir.slice(profilesRoot.length + 1)
      : undefined;

    if (relativeToProfiles && /^[^/]+\/agent\/tasks(?:\/.*)?$/.test(relativeToProfiles)) {
      return 'profile-task-dir';
    }
  }

  return 'other';
}

function readJsonObject(filePath: string): Record<string, unknown> {
  const raw = readFileSync(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Daemon config at ${filePath} must contain a JSON object`);
  }

  return parsed;
}

function writeJsonObject(filePath: string, value: Record<string, unknown>): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

export function normalizeDaemonTaskDirOverride(options: {
  repoRoot: string;
  daemonConfigFile?: string;
}): { changed: boolean } {
  const daemonConfigFile = options.daemonConfigFile ?? getDaemonConfigFilePath();
  if (!existsSync(daemonConfigFile)) {
    return { changed: false };
  }

  const config = readJsonObject(daemonConfigFile);
  const modules = isRecord(config.modules) ? { ...config.modules } : undefined;
  const tasks = modules && isRecord(modules.tasks) ? { ...modules.tasks } : undefined;
  const taskDir = typeof tasks?.taskDir === 'string' ? tasks.taskDir : undefined;
  const scope = classifyRepoManagedTaskDir(taskDir, options.repoRoot);

  if (scope !== 'profiles-root' && scope !== 'profile-task-dir') {
    return { changed: false };
  }

  if (!modules || !tasks || !('taskDir' in tasks)) {
    return { changed: false };
  }

  delete tasks.taskDir;

  if (Object.keys(tasks).length > 0) {
    modules.tasks = tasks;
  } else {
    delete modules.tasks;
  }

  const nextConfig: Record<string, unknown> = {
    ...config,
  };

  if (Object.keys(modules).length > 0) {
    nextConfig.modules = modules;
  } else {
    delete nextConfig.modules;
  }

  writeJsonObject(daemonConfigFile, nextConfig);
  return { changed: true };
}

export function readRunningDaemonTaskDir(status: DaemonStatus): string | undefined {
  const tasksModule = status.modules.find((module) => module.name === 'tasks');
  const detail = tasksModule?.detail;
  if (!detail || typeof detail.taskDir !== 'string' || detail.taskDir.trim().length === 0) {
    return undefined;
  }

  return resolve(detail.taskDir);
}

export async function syncDaemonTaskScopeToProfile(
  options: SyncDaemonTaskScopeOptions,
  dependencies: Partial<SyncDaemonTaskScopeDependencies> = {},
): Promise<SyncDaemonTaskScopeResult> {
  const resolvedDependencies: SyncDaemonTaskScopeDependencies = {
    pingDaemon,
    getDaemonStatus,
    stopDaemonGracefully,
    startDaemonDetached,
    ...dependencies,
  };

  const desiredTaskDir = resolveProfileTaskDir(options.repoRoot, options.profile);
  const { changed: configUpdated } = normalizeDaemonTaskDirOverride({
    repoRoot: options.repoRoot,
    daemonConfigFile: options.daemonConfigFile,
  });

  const daemonWasRunning = await resolvedDependencies.pingDaemon();
  if (!daemonWasRunning) {
    return {
      configUpdated,
      daemonWasRunning: false,
      daemonRestarted: false,
      desiredTaskDir,
    };
  }

  const status = await resolvedDependencies.getDaemonStatus();
  const runningTaskDir = readRunningDaemonTaskDir(status);
  const runningScope = classifyRepoManagedTaskDir(runningTaskDir, options.repoRoot);
  const daemonRestarted = Boolean(
    runningTaskDir
      && normalizePath(runningTaskDir) !== normalizePath(desiredTaskDir)
      && (runningScope === 'profiles-root' || runningScope === 'profile-task-dir'),
  );

  if (daemonRestarted) {
    await resolvedDependencies.stopDaemonGracefully();
    await resolvedDependencies.startDaemonDetached();
  }

  return {
    configUpdated,
    daemonWasRunning,
    daemonRestarted,
    desiredTaskDir,
    runningTaskDir,
  };
}
