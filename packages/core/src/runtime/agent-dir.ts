import { copyFile, mkdir, stat } from 'fs/promises';
import { existsSync, lstatSync, readlinkSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'fs';
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
}

export interface PreparePiAgentDirResult {
  agentDir: string;
  authFile: string;
  sessionsDir: string;
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

  try {
    symlinkSync(relativeTarget, linkPath, 'dir');
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') {
      throw error;
    }
  }

  const racedExisting = lstatSyncSafe(linkPath);
  if (racedExisting?.isSymbolicLink()) {
    const existingTarget = resolve(dirname(linkPath), readlinkSync(linkPath));
    if (existingTarget === targetPath) {
      return;
    }

    unlinkSync(linkPath);
  } else if (racedExisting) {
    rmSync(linkPath, { recursive: true, force: true });
  } else {
    return;
  }

  symlinkSync(relativeTarget, linkPath, 'dir');
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

export async function preparePiAgentDir(
  options: PreparePiAgentDirOptions,
): Promise<PreparePiAgentDirResult> {
  const durablePiAgentDir = getDurablePiAgentDir(options.statePaths.root);
  const durableSessionsDir = getDurableSessionsDir(options.statePaths.root);
  const agentDir = getPiAgentRuntimeDir(options.statePaths.root);
  const authFile = join(agentDir, 'auth.json');
  const sessionsDir = join(agentDir, 'sessions');

  await mkdir(durablePiAgentDir, { recursive: true, mode: 0o700 });
  await mkdir(durableSessionsDir, { recursive: true, mode: 0o700 });
  await mkdir(agentDir, { recursive: true, mode: 0o700 });

  removeStaleRuntimeArtifactsFromStateDir(durablePiAgentDir);
  ensureDirectorySymlink(sessionsDir, durableSessionsDir);

  await stat(agentDir);
  await stat(durableSessionsDir);

  return {
    agentDir,
    authFile,
    sessionsDir,
  };
}
