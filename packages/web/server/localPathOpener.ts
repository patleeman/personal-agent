import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export function resolveLocalPathOpenCommand(platform: NodeJS.Platform = process.platform): string | null {
  if (platform === 'darwin') {
    return 'open';
  }

  if (platform === 'linux') {
    return 'xdg-open';
  }

  return null;
}

export function normalizeRequestedLocalPath(path: string, homeDir = homedir()): string {
  const trimmed = path.trim();
  if (!trimmed) {
    throw new Error('Path must not be empty.');
  }

  const expanded = trimmed.startsWith('~/') ? resolve(homeDir, trimmed.slice(2)) : trimmed;
  if (!isAbsolute(expanded)) {
    throw new Error('Path must be absolute or start with ~/.');
  }

  return expanded;
}

export function openLocalPathOnHost(path: string, options: {
  platform?: NodeJS.Platform;
  homeDir?: string;
  runCommand?: (command: string, args: string[]) => SpawnSyncReturns<Buffer>;
} = {}): string {
  const normalized = normalizeRequestedLocalPath(path, options.homeDir);
  if (!existsSync(normalized)) {
    throw new Error(`Path not found: ${normalized}`);
  }

  const command = resolveLocalPathOpenCommand(options.platform);
  if (!command) {
    throw new Error(`Opening local paths is not supported on ${options.platform ?? process.platform}.`);
  }

  const result = (options.runCommand ?? ((resolvedCommand, args) => spawnSync(resolvedCommand, args, { stdio: 'ignore' })))(command, [normalized]);
  if (result.error) {
    throw result.error;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`Failed to open local path: ${normalized}`);
  }

  return normalized;
}
