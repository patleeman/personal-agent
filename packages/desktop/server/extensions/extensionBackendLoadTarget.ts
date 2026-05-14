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

function normalizeBackendEntry(backendEntry: string): string {
  return backendEntry.trim();
}

export function isSourceExtensionBackendEntry(backendEntry: string): boolean {
  const normalizedBackendEntry = normalizeBackendEntry(backendEntry);
  return (
    normalizedBackendEntry.startsWith('src/') ||
    normalizedBackendEntry.endsWith('.ts') ||
    normalizedBackendEntry.endsWith('.tsx') ||
    normalizedBackendEntry.endsWith('.mts') ||
    normalizedBackendEntry.endsWith('.cts')
  );
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
  const env = options.env ?? process.env;
  return env.PERSONAL_AGENT_EXTENSION_AUTHORING !== '1';
}

export function resolveExtensionBackendLoadTarget(
  entry: ExtensionBackendLoadTargetEntry,
  backendEntry: string,
  options: {
    resourcesPath?: string;
    env?: NodeJS.ProcessEnv;
  } = {},
): PrebuiltExtensionBackendLoadTarget | null {
  if (!entry.packageRoot) {
    return null;
  }

  const normalizedBackendEntry = normalizeBackendEntry(backendEntry);
  if (normalizedBackendEntry.length === 0) {
    return null;
  }

  if (
    entry.source === 'system' &&
    isSourceExtensionBackendEntry(normalizedBackendEntry) &&
    shouldPreferPrebuiltSystemExtensionBackend(options)
  ) {
    return buildPrebuiltExtensionBackendLoadTarget(resolve(entry.packageRoot, 'dist', 'backend.mjs'));
  }

  if (isSourceExtensionBackendEntry(normalizedBackendEntry)) {
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
