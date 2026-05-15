import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

interface ResolveServerModuleSpecifierOptions {
  importMetaUrl: string;
  relativeSpecifier: string;
  normalize?: (relativeSpecifier: string) => string;
  resourcesPath?: string;
}

export function normalizeServerModuleSpecifier(relativeSpecifier: string): string {
  return relativeSpecifier.replace(/^\.\.\/\.\.\//, '').replace(/^\/+/, '');
}

export function normalizeServerExtensionModuleSpecifier(relativeSpecifier: string): string {
  return relativeSpecifier.replace(/^\.\.\//, 'extensions/').replace(/^\/+/, '');
}

function packageEntryCandidates(specifier: string, resourcesPath: string | undefined): string[] {
  const repoRoots = [process.env.PERSONAL_AGENT_REPO_ROOT, process.cwd()].filter((value): value is string => Boolean(value));
  const candidates: string[] = [];
  const pushRepoPath = (relativePath: string) => {
    for (const repoRoot of repoRoots) candidates.push(resolve(repoRoot, relativePath));
  };
  const pushResourcePath = (relativePath: string) => {
    if (typeof resourcesPath !== 'string') return;
    candidates.push(resolve(resourcesPath, 'app.asar', relativePath));
    candidates.push(resolve(resourcesPath, 'app.asar.unpacked', relativePath));
  };

  if (specifier === '@personal-agent/core') {
    pushRepoPath('packages/desktop/server/dist/core/index.js');
    pushRepoPath('packages/desktop/dist/server/core/index.js');
    pushRepoPath('packages/core/dist/index.js');
    pushResourcePath('server/dist/core/index.js');
    pushResourcePath('packages/desktop/server/dist/core/index.js');
    pushResourcePath('packages/desktop/dist/server/core/index.js');
    pushResourcePath('packages/core/dist/index.js');
  } else if (specifier === '@personal-agent/daemon') {
    pushRepoPath('packages/desktop/server/dist/daemon/index.js');
    pushResourcePath('packages/desktop/server/dist/daemon/index.js');
    pushResourcePath('server/dist/daemon/index.js');
  } else if (specifier === '@earendil-works/pi-coding-agent') {
    pushRepoPath('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
    pushResourcePath('node_modules/@earendil-works/pi-coding-agent/dist/index.js');
  }

  return candidates;
}

export function resolveServerModuleSpecifierFrom({
  importMetaUrl,
  relativeSpecifier,
  normalize = normalizeServerModuleSpecifier,
  resourcesPath: providedResourcesPath,
}: ResolveServerModuleSpecifierOptions): string {
  const resourcesPath = providedResourcesPath ?? process.resourcesPath;
  if (!relativeSpecifier.startsWith('.')) {
    const foundPackageEntry = packageEntryCandidates(relativeSpecifier, resourcesPath).find((candidate) => existsSync(candidate));
    return foundPackageEntry ? pathToFileURL(foundPackageEntry).href : relativeSpecifier;
  }

  const normalized = normalize(relativeSpecifier);
  const currentDir = dirname(fileURLToPath(importMetaUrl));
  const candidates = [
    ...(process.env.PERSONAL_AGENT_REPO_ROOT
      ? [
          resolve(process.env.PERSONAL_AGENT_REPO_ROOT, 'packages/desktop/server/dist', normalized),
          resolve(process.env.PERSONAL_AGENT_REPO_ROOT, 'packages/desktop/dist/server', normalized),
        ]
      : []),
    resolve(process.cwd(), 'packages/desktop/server/dist', normalized),
    resolve(process.cwd(), 'packages/desktop/dist/server', normalized),
    resolve(currentDir, relativeSpecifier),
    ...(typeof resourcesPath === 'string'
      ? [
          resolve(resourcesPath, 'app.asar.unpacked/packages/desktop/server/dist', normalized),
          resolve(resourcesPath, 'app.asar.unpacked/packages/desktop/dist/server', normalized),
          resolve(resourcesPath, 'app.asar.unpacked/server/dist', normalized),
          resolve(resourcesPath, 'app.asar/server/dist', normalized),
          resolve(resourcesPath, 'server/dist', normalized),
        ]
      : []),
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  return found ? pathToFileURL(found).href : relativeSpecifier;
}

export function resolveServerModuleSpecifier(relativeSpecifier: string): string {
  return resolveServerModuleSpecifierFrom({ importMetaUrl: import.meta.url, relativeSpecifier });
}

export function resolveServerExtensionModuleSpecifier(relativeSpecifier: string): string {
  return resolveServerModuleSpecifierFrom({
    importMetaUrl: import.meta.url,
    relativeSpecifier,
    normalize: normalizeServerExtensionModuleSpecifier,
  });
}

export async function importServerModule<T = Record<string, unknown>>(relativeSpecifier: string): Promise<T> {
  return dynamicImport<T>(resolveServerModuleSpecifier(relativeSpecifier));
}

export async function importServerExtensionModule<T = Record<string, unknown>>(relativeSpecifier: string): Promise<T> {
  return dynamicImport<T>(resolveServerExtensionModuleSpecifier(relativeSpecifier));
}

export async function callServerModuleExport<T>(relativeSpecifier: string, name: string, ...args: unknown[]): Promise<T> {
  const module = await importServerModule<Record<string, unknown>>(relativeSpecifier);
  const fn = module[name];
  if (typeof fn !== 'function') throw new Error(`Backend API export ${name} is unavailable.`);
  return (fn as (...callArgs: unknown[]) => Promise<T> | T)(...args);
}
