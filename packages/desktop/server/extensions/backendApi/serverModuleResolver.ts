import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dynamicImport = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;

interface ResolveServerModuleSpecifierOptions {
  importMetaUrl: string;
  relativeSpecifier: string;
  normalize?: (relativeSpecifier: string) => string;
}

export function normalizeServerModuleSpecifier(relativeSpecifier: string): string {
  return relativeSpecifier.replace(/^\.\.\/\.\.\//, '').replace(/^\/+/, '');
}

export function normalizeServerExtensionModuleSpecifier(relativeSpecifier: string): string {
  return relativeSpecifier.replace(/^\.\.\//, 'extensions/').replace(/^\/+/, '');
}

export function resolveServerModuleSpecifierFrom({
  importMetaUrl,
  relativeSpecifier,
  normalize = normalizeServerModuleSpecifier,
}: ResolveServerModuleSpecifierOptions): string {
  if (!relativeSpecifier.startsWith('.')) return relativeSpecifier;

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
    ...(typeof process.resourcesPath === 'string'
      ? [
          resolve(process.resourcesPath, 'app.asar.unpacked/packages/desktop/server/dist', normalized),
          resolve(process.resourcesPath, 'app.asar.unpacked/packages/desktop/dist/server', normalized),
          resolve(process.resourcesPath, 'app.asar.unpacked/server/dist', normalized),
          resolve(process.resourcesPath, 'server/dist', normalized),
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
