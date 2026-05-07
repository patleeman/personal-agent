import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

import { getStateRoot } from '@personal-agent/core';
import { build } from 'esbuild';

import type { ServerRouteContext } from '../routes/context.js';
import { createExtensionAutomationsCapability } from './extensionAutomations.js';
import { findExtensionEntry } from './extensionRegistry.js';

export interface ExtensionBackendContext {
  extensionId: string;
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    put(key: string, value: unknown): Promise<{ ok: true }>;
    delete(key: string): Promise<{ ok: true; deleted: boolean }>;
    list<T = unknown>(prefix?: string): Promise<Array<{ key: string; value: T }>>;
  };
  automations: ReturnType<typeof createExtensionAutomationsCapability>;
  log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
}

type ExtensionBackendModule = Record<string, unknown>;

export interface ExtensionActionInvokeResult {
  ok: true;
  result: unknown;
}

function getExtensionCacheRoot(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'extension-cache');
}

function getExtensionStateRoot(extensionId: string, stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'extension-state', extensionId);
}

function assertInside(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Path escapes extension root.');
  }
}

function normalizeStorageKey(key: string): string {
  const normalized = key.trim().replace(/^\/+/, '');
  if (!normalized || normalized.includes('\0')) {
    throw new Error('Storage key is required.');
  }
  return normalized.endsWith('.json') ? normalized : `${normalized}.json`;
}

function resolveStoragePath(extensionId: string, key: string): { root: string; filePath: string; normalizedKey: string } {
  const root = join(getExtensionStateRoot(extensionId), 'kv');
  const normalizedKey = normalizeStorageKey(key);
  const filePath = resolve(root, normalizedKey);
  assertInside(root, filePath);
  return { root, filePath, normalizedKey };
}

function createStorage(extensionId: string): ExtensionBackendContext['storage'] {
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      const { filePath } = resolveStoragePath(extensionId, key);
      if (!existsSync(filePath)) return null;
      return JSON.parse(await readFile(filePath, 'utf-8')) as T;
    },
    async put(key: string, value: unknown): Promise<{ ok: true }> {
      const { filePath } = resolveStoragePath(extensionId, key);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
      return { ok: true };
    },
    async delete(key: string): Promise<{ ok: true; deleted: boolean }> {
      const { filePath } = resolveStoragePath(extensionId, key);
      const deleted = existsSync(filePath);
      await rm(filePath, { force: true });
      return { ok: true, deleted };
    },
    async list<T = unknown>(prefix = ''): Promise<Array<{ key: string; value: T }>> {
      const root = join(getExtensionStateRoot(extensionId), 'kv');
      if (!existsSync(root)) return [];
      const normalizedPrefix = prefix.trim().replace(/^\/+/, '');
      const items: Array<{ key: string; value: T }> = [];

      async function visit(dir: string): Promise<void> {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          const entryPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            await visit(entryPath);
            continue;
          }
          if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
          const relativeKey = entryPath.slice(root.length + 1).replace(/\.json$/, '');
          if (normalizedPrefix && !relativeKey.startsWith(normalizedPrefix)) continue;
          items.push({ key: relativeKey, value: JSON.parse(await readFile(entryPath, 'utf-8')) as T });
        }
      }

      await visit(root);
      return items.sort((left, right) => left.key.localeCompare(right.key));
    },
  };
}

function createBackendContext(extensionId: string, serverContext?: Pick<ServerRouteContext, 'getCurrentProfile'>): ExtensionBackendContext {
  return {
    extensionId,
    storage: createStorage(extensionId),
    automations: createExtensionAutomationsCapability(serverContext),
    log: {
      info: (message, fields) => console.log(`[extension:${extensionId}] ${message}`, fields ?? {}),
      warn: (message, fields) => console.warn(`[extension:${extensionId}] ${message}`, fields ?? {}),
      error: (message, fields) => console.error(`[extension:${extensionId}] ${message}`, fields ?? {}),
    },
  };
}

async function buildExtensionBackend(extensionId: string, entryPath: string): Promise<string> {
  const outfile = join(getExtensionCacheRoot(), extensionId, 'backend.mjs');
  await mkdir(dirname(outfile), { recursive: true });
  await build({
    entryPoints: [entryPath],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    sourcemap: 'inline',
    logLevel: 'silent',
    external: ['@personal-agent/*', 'electron'],
  });
  return outfile;
}

export async function loadExtensionBackend(extensionId: string): Promise<ExtensionBackendModule> {
  const entry = findExtensionEntry(extensionId);
  if (!entry) {
    throw new Error('Extension not found.');
  }
  if (!entry.packageRoot) {
    throw new Error('Extension backend code is only available for runtime extensions.');
  }
  const backendEntry = entry.manifest.backend?.entry;
  if (!backendEntry) {
    throw new Error('Extension has no backend entry.');
  }

  const packageRoot = resolve(entry.packageRoot);
  const entryPath = resolve(packageRoot, backendEntry);
  assertInside(packageRoot, entryPath);
  const compiledPath = await buildExtensionBackend(extensionId, entryPath);
  return import(`${pathToFileURL(compiledPath).href}?t=${Date.now()}`) as Promise<ExtensionBackendModule>;
}

export async function invokeExtensionAction(
  extensionId: string,
  actionId: string,
  input: unknown,
  serverContext?: Pick<ServerRouteContext, 'getCurrentProfile'>,
): Promise<ExtensionActionInvokeResult> {
  const entry = findExtensionEntry(extensionId);
  if (!entry) {
    throw new Error('Extension not found.');
  }
  const action = entry.manifest.backend?.actions?.find((candidate) => candidate.id === actionId);
  const handlerName = action?.handler ?? actionId;
  const backend = await loadExtensionBackend(extensionId);
  const handler = backend[handlerName];
  if (typeof handler !== 'function') {
    throw new Error(`Extension action handler not found: ${handlerName}`);
  }

  const result = await (handler as (input: unknown, ctx: ExtensionBackendContext) => unknown | Promise<unknown>)(
    input,
    createBackendContext(extensionId, serverContext),
  );
  return { ok: true, result };
}

export async function reloadExtensionBackend(extensionId: string): Promise<{ ok: true; extensionId: string; rebuilt: boolean }> {
  await loadExtensionBackend(extensionId);
  return { ok: true, extensionId, rebuilt: true };
}
