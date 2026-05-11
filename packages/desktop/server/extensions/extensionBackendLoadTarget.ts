import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ExtensionBackendLoadTargetEntry {
  source: 'system' | 'runtime';
  packageRoot?: string;
}

export interface PrebuiltExtensionBackendLoadTarget {
  path: string;
  hash: string;
}

export function shouldPreferPrebuiltSystemExtensionBackend(
  options: {
    resourcesPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): boolean {
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const env = options.env ?? process.env;
  return typeof resourcesPath === 'string' && resourcesPath.trim().length > 0 && env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE !== '1';
}

export function resolvePrebuiltSystemExtensionBackend(
  entry: ExtensionBackendLoadTargetEntry,
  options: {
    resourcesPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): PrebuiltExtensionBackendLoadTarget | null {
  if (!shouldPreferPrebuiltSystemExtensionBackend(options) || entry.source !== 'system' || !entry.packageRoot) {
    return null;
  }

  const path = resolve(entry.packageRoot, 'dist', 'backend.mjs');
  if (!existsSync(path)) {
    return null;
  }

  const stats = statSync(path);
  return {
    path,
    hash: `prebuilt:${stats.size}:${stats.mtimeMs}`,
  };
}
