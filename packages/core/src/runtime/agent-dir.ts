import { copyFile, mkdir, stat } from 'fs/promises';
import { cpSync, existsSync, lstatSync, readlinkSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, relative, resolve } from 'path';
import {
  getDurablePiAgentDir,
  getDurableSessionsDir,
  getPiAgentRuntimeDir,
  getPiAgentStateDir,
  type RuntimeStatePaths,
} from './paths.js';

const GENERATED_RUNTIME_ARTIFACTS = [
  'AGENTS.md',
  'APPEND_SYSTEM.md',
  'SYSTEM.md',
] as const;

const MIGRATABLE_RUNTIME_ARTIFACTS = [
  'auth.json',
  'models.json',
  'settings.json',
  'session-meta-index.json',
  'bin',
] as const;

const STALE_SYNCED_RUNTIME_ARTIFACTS = [
  ...GENERATED_RUNTIME_ARTIFACTS,
  ...MIGRATABLE_RUNTIME_ARTIFACTS,
] as const;

export interface PreparePiAgentDirOptions {
  statePaths: RuntimeStatePaths;
  legacyAgentDir?: string;
  copyLegacyAuth?: boolean;
}

export interface PreparePiAgentDirResult {
  agentDir: string;
  authFile: string;
  sessionsDir: string;
  copiedLegacyAuth: boolean;
}

function lstatSyncSafe(path: string) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function ensureDirectorySymlink(linkPath: string, targetPath: string): void {
  const existing = lstatSyncSafe(linkPath);

  if (existing?.isSymbolicLink()) {
    const existingTarget = resolve(dirname(linkPath), readlinkSync(linkPath));
    if (existingTarget === targetPath) {
      return;
    }

    unlinkSync(linkPath);
  } else if (existing) {
    rmSync(linkPath, { recursive: true, force: true });
  }

  const relativeTarget = relative(dirname(linkPath), targetPath);
  symlinkSync(relativeTarget, linkPath, 'dir');
}

function migrateRuntimeArtifactsToLocalAgentDir(agentStateDir: string, agentDir: string): void {
  for (const relativePath of MIGRATABLE_RUNTIME_ARTIFACTS) {
    const sourcePath = join(agentStateDir, relativePath);
    const targetPath = join(agentDir, relativePath);
    const sourceStats = lstatSyncSafe(sourcePath);

    if (!sourceStats) {
      continue;
    }

    const targetStats = lstatSyncSafe(targetPath);
    if (!targetStats) {
      try {
        renameSync(sourcePath, targetPath);
      } catch {
        cpSync(sourcePath, targetPath, { recursive: sourceStats.isDirectory(), force: true });
        rmSync(sourcePath, { recursive: true, force: true });
      }
      continue;
    }

    if (sourceStats.isDirectory() && targetStats.isDirectory()) {
      cpSync(sourcePath, targetPath, { recursive: true, force: true });
    }

    rmSync(sourcePath, { recursive: true, force: true });
  }
}

function removeStaleRuntimeArtifactsFromStateDir(agentStateDir: string): void {
  for (const relativePath of STALE_SYNCED_RUNTIME_ARTIFACTS) {
    const targetPath = join(agentStateDir, relativePath);
    if (!lstatSyncSafe(targetPath)) {
      continue;
    }

    rmSync(targetPath, { recursive: true, force: true });
  }
}

function migrateLegacySessionsToDurableDir(legacySessionsDir: string, durableSessionsDir: string): void {
  const legacyStats = lstatSyncSafe(legacySessionsDir);
  if (!legacyStats || legacyStats.isSymbolicLink()) {
    return;
  }

  if (!legacyStats.isDirectory()) {
    rmSync(legacySessionsDir, { recursive: true, force: true });
    return;
  }

  for (const entryName of readdirSync(legacySessionsDir)) {
    const sourcePath = join(legacySessionsDir, entryName);
    const targetPath = join(durableSessionsDir, entryName);
    const targetStats = lstatSyncSafe(targetPath);

    if (!targetStats) {
      try {
        renameSync(sourcePath, targetPath);
      } catch {
        cpSync(sourcePath, targetPath, { recursive: true, force: true });
        rmSync(sourcePath, { recursive: true, force: true });
      }
      continue;
    }

    const sourceStats = lstatSyncSafe(sourcePath);
    if (sourceStats?.isDirectory() && targetStats.isDirectory()) {
      migrateLegacySessionsToDurableDir(sourcePath, targetPath);
      rmSync(sourcePath, { recursive: true, force: true });
      continue;
    }

    rmSync(sourcePath, { recursive: true, force: true });
  }

  if (readdirSync(legacySessionsDir).length === 0) {
    rmSync(legacySessionsDir, { recursive: true, force: true });
  }
}

export async function preparePiAgentDir(
  options: PreparePiAgentDirOptions,
): Promise<PreparePiAgentDirResult> {
  const legacyAgentDir = options.legacyAgentDir ?? join(homedir(), '.pi', 'agent');
  const copyLegacyAuth = options.copyLegacyAuth ?? true;

  const legacyLocalPiAgentDir = getPiAgentStateDir(options.statePaths.root);
  const durablePiAgentDir = getDurablePiAgentDir(options.statePaths.root);
  const durableSessionsDir = getDurableSessionsDir(options.statePaths.root);
  const agentDir = getPiAgentRuntimeDir(options.statePaths.root);
  const authFile = join(agentDir, 'auth.json');
  const sessionsDir = join(agentDir, 'sessions');

  await mkdir(legacyLocalPiAgentDir, { recursive: true, mode: 0o700 });
  await mkdir(durablePiAgentDir, { recursive: true, mode: 0o700 });
  await mkdir(durableSessionsDir, { recursive: true, mode: 0o700 });
  await mkdir(agentDir, { recursive: true, mode: 0o700 });

  migrateRuntimeArtifactsToLocalAgentDir(durablePiAgentDir, agentDir);
  removeStaleRuntimeArtifactsFromStateDir(durablePiAgentDir);
  migrateLegacySessionsToDurableDir(join(legacyLocalPiAgentDir, 'sessions'), durableSessionsDir);
  ensureDirectorySymlink(sessionsDir, durableSessionsDir);

  let copiedLegacyAuth = false;

  if (copyLegacyAuth) {
    const legacyAuthFile = join(legacyAgentDir, 'auth.json');
    if (!existsSync(authFile) && existsSync(legacyAuthFile)) {
      await copyFile(legacyAuthFile, authFile);
      copiedLegacyAuth = true;
    }
  }

  await stat(agentDir);
  await stat(durableSessionsDir);

  return {
    agentDir,
    authFile,
    sessionsDir,
    copiedLegacyAuth,
  };
}
