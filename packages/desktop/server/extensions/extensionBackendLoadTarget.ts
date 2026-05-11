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

function buildPrebuiltExtensionBackendLoadTarget(path: string): PrebuiltExtensionBackendLoadTarget | null {
  if (!existsSync(path) || !statSync(path).isFile()) {
    return null;
  }

  const stats = statSync(path);
  return {
    path,
    hash: `prebuilt:${stats.size}:${stats.mtimeMs}`,
  };
}

export function isPrebuiltOnlyExtensionRuntime(
  options: {
    resourcesPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): boolean {
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const env = options.env ?? process.env;
  return typeof resourcesPath === 'string' && resourcesPath.trim().length > 0 && env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE !== '1';
}

export function shouldPreferPrebuiltSystemExtensionBackend(
  options: {
    resourcesPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): boolean {
  return isPrebuiltOnlyExtensionRuntime(options);
}

export function resolvePackagedExtensionBackendLoadTarget(
  entry: ExtensionBackendLoadTargetEntry,
  backendEntry: string,
  options: {
    resourcesPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): PrebuiltExtensionBackendLoadTarget | null {
  if (!isPrebuiltOnlyExtensionRuntime(options) || !entry.packageRoot) {
    return null;
  }

  const normalizedBackendEntry = backendEntry.trim();
  if (normalizedBackendEntry.length === 0) {
    return null;
  }

  if (entry.source === 'system' && normalizedBackendEntry.startsWith('src/')) {
    return buildPrebuiltExtensionBackendLoadTarget(resolve(entry.packageRoot, 'dist', 'backend.mjs'));
  }

  if (normalizedBackendEntry.startsWith('src/') || normalizedBackendEntry.endsWith('.ts')) {
    return null;
  }

  return buildPrebuiltExtensionBackendLoadTarget(resolve(entry.packageRoot, normalizedBackendEntry));
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

  return buildPrebuiltExtensionBackendLoadTarget(resolve(entry.packageRoot, 'dist', 'backend.mjs'));
}
