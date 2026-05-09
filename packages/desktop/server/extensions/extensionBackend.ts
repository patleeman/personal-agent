import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { getStateRoot } from '@personal-agent/core';
import { build, type Plugin } from 'esbuild';

import type { ServerRouteContext } from '../routes/context.js';
import { invalidateAppTopics } from '../shared/appEvents.js';
import { createExtensionAutomationsCapability } from './extensionAutomations.js';
import { createExtensionConversationsCapability } from './extensionConversations.js';
import { findExtensionEntry } from './extensionRegistry.js';
import { createExtensionRunsCapability } from './extensionRuns.js';
import { createExtensionGitCapability, createExtensionShellCapability } from './extensionShell.js';
import { deleteExtensionState, listExtensionState, readExtensionState, writeExtensionState } from './extensionStorage.js';
import { createExtensionVaultCapability } from './extensionVault.js';
import { createExtensionWorkspaceCapability } from './extensionWorkspace.js';

export interface ExtensionBackendContext {
  extensionId: string;
  profile: string;
  toolContext?: {
    conversationId?: string;
    cwd?: string;
    sessionFile?: string;
    sessionId?: string;
    preferredVisionModel?: string;
  };
  agentToolContext?: unknown;
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    put(key: string, value: unknown): Promise<{ ok: true }>;
    delete(key: string): Promise<{ ok: true; deleted: boolean }>;
    list<T = unknown>(prefix?: string): Promise<Array<{ key: string; value: T }>>;
  };
  automations: ReturnType<typeof createExtensionAutomationsCapability>;
  runs: ReturnType<typeof createExtensionRunsCapability>;
  vault: ReturnType<typeof createExtensionVaultCapability>;
  conversations: ReturnType<typeof createExtensionConversationsCapability>;
  workspace: ReturnType<typeof createExtensionWorkspaceCapability>;
  git: ReturnType<typeof createExtensionGitCapability>;
  shell: ReturnType<typeof createExtensionShellCapability>;
  ui: {
    invalidate(topics: string | string[]): void;
  };
  log: {
    info(message: string, fields?: Record<string, unknown>): void;
    warn(message: string, fields?: Record<string, unknown>): void;
    error(message: string, fields?: Record<string, unknown>): void;
  };
}

type ExtensionBackendModule = Record<string, unknown>;

const EXTENSION_BACKEND_BUILD_CACHE_VERSION = 'bundle-host-runtime-externals-v3';
const HOST_RUNTIME_EXTERNAL_IMPORT_RE =
  /^(@personal-agent\/(core|daemon)|@earendil-works\/pi-coding-agent|@xenova\/transformers|better-sqlite3|esbuild|jsdom)(\/.*)?$/;

interface ExtensionBackendBuildResult {
  path: string;
  rebuilt: boolean;
  stale: boolean;
}

export interface ExtensionActionInvokeResult {
  ok: true;
  result: unknown;
}

function getExtensionCacheRoot(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'extension-cache');
}

function assertInside(root: string, candidate: string): void {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error('Path escapes extension root.');
  }
}

function createStorage(extensionId: string): ExtensionBackendContext['storage'] {
  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      return readExtensionState<T>(extensionId, key)?.value ?? null;
    },
    async put(key: string, value: unknown): Promise<{ ok: true }> {
      writeExtensionState(extensionId, key, value);
      return { ok: true };
    },
    async delete(key: string): Promise<{ ok: true; deleted: boolean }> {
      return deleteExtensionState(extensionId, key);
    },
    async list<T = unknown>(prefix = ''): Promise<Array<{ key: string; value: T }>> {
      return listExtensionState<T>(extensionId, prefix).map((document) => ({ key: document.key, value: document.value }));
    },
  };
}

function createBackendContext(
  extensionId: string,
  serverContext?: Pick<ServerRouteContext, 'getCurrentProfile'>,
  toolContext?: ExtensionBackendContext['toolContext'],
  agentToolContext?: unknown,
): ExtensionBackendContext {
  return {
    extensionId,
    profile: serverContext?.getCurrentProfile() ?? 'shared',
    ...(toolContext ? { toolContext } : {}),
    ...(agentToolContext ? { agentToolContext } : {}),
    storage: createStorage(extensionId),
    automations: createExtensionAutomationsCapability(serverContext),
    runs: createExtensionRunsCapability(extensionId),
    vault: createExtensionVaultCapability(),
    conversations: createExtensionConversationsCapability(serverContext),
    workspace: createExtensionWorkspaceCapability(),
    git: createExtensionGitCapability(),
    shell: createExtensionShellCapability(),
    ui: {
      invalidate: (topics) => invalidateAppTopics(...(Array.isArray(topics) ? topics : [topics])),
    },
    log: {
      info: (message, fields) => console.log(`[extension:${extensionId}] ${message}`, fields ?? {}),
      warn: (message, fields) => console.warn(`[extension:${extensionId}] ${message}`, fields ?? {}),
      error: (message, fields) => console.error(`[extension:${extensionId}] ${message}`, fields ?? {}),
    },
  };
}

function hashFileInto(hash: ReturnType<typeof createHash>, root: string, entryPath: string, namespace: string): void {
  const relativePath = relative(root, entryPath);
  if (relativePath.startsWith('..')) {
    return;
  }

  hash.update(namespace);
  hash.update('\0');
  hash.update(relativePath);
  hash.update('\0');
  hash.update(readFileSync(entryPath));
  hash.update('\0');
}

function hashDirectoryInto(hash: ReturnType<typeof createHash>, root: string, directory: string, namespace: string): void {
  for (const entryName of readdirSync(directory).sort((left, right) => left.localeCompare(right))) {
    if (entryName === 'node_modules' || entryName === '.git') {
      continue;
    }

    const entryPath = join(directory, entryName);
    const stat = readdirSafeStat(entryPath);
    if (!stat) {
      continue;
    }

    if (stat.isDirectory()) {
      hashDirectoryInto(hash, root, entryPath, namespace);
      continue;
    }
    if (!stat.isFile()) {
      continue;
    }

    hashFileInto(hash, root, entryPath, namespace);
  }
}

function hashExtensionBackendInputs(packageRoot: string): string {
  const hash = createHash('sha256');
  hash.update(EXTENSION_BACKEND_BUILD_CACHE_VERSION);
  hash.update('\0');
  hashDirectoryInto(hash, packageRoot, packageRoot, 'extension');

  const backendApiPath = resolveExtensionBackendApiPath();
  const backendApiRoot = dirname(backendApiPath);
  hashFileInto(hash, backendApiRoot, backendApiPath, 'backend-api');

  const backendApiDirectory = resolve(backendApiRoot, 'backendApi');
  if (existsSync(backendApiDirectory)) {
    hashDirectoryInto(hash, backendApiRoot, backendApiDirectory, 'backend-api');
  }

  return hash.digest('hex');
}

function readdirSafeStat(entryPath: string) {
  try {
    return statSync(entryPath);
  } catch {
    return null;
  }
}

function resolveExtensionBackendApiPath(): string {
  // When loaded from source: import.meta.url points to extensionBackend.ts, same dir as backendApi.ts
  // When bundled into dist/app/localApi.js: import.meta.url points to dist/app/
  // so we try multiple candidate paths.
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(currentDir, 'backendApi.ts'),
    resolve(currentDir, '../../extensions/backendApi.ts'),
    resolve(currentDir, '../extensions/backendApi.ts'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Fallback to compiled .js in same locations
  for (const candidate of candidates) {
    const jsPath = candidate.replace(/\.ts$/, '.js');
    if (existsSync(jsPath)) {
      return jsPath;
    }
  }

  throw new Error(
    'Could not find extension backend API source (backendApi.ts). ' +
      'Ensure the server source files are available, or set PERSONAL_AGENT_REPO_ROOT.',
  );
}

function createExtensionBackendApiPlugin(): Plugin {
  const backendApiPath = resolveExtensionBackendApiPath();
  return {
    name: 'personal-agent-extension-backend-api',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^@personal-agent\/extensions\/backend$/ }, () => ({ path: backendApiPath }));
    },
  };
}

function createHostRuntimeExternalPlugin(): Plugin {
  return {
    name: 'personal-agent-extension-host-runtime-externals',
    setup(buildContext) {
      buildContext.onResolve({ filter: HOST_RUNTIME_EXTERNAL_IMPORT_RE }, async (args) => {
        const resolveImport = (import.meta as ImportMeta & { resolve(specifier: string): string | Promise<string> }).resolve;
        const resolvedUrl = await Promise.resolve(resolveImport(args.path));
        return { path: fileURLToPath(resolvedUrl), external: true };
      });
    },
  };
}

async function buildExtensionBackend(
  extensionId: string,
  packageRoot: string,
  entryPath: string,
  options: { allowStaleOnFailure?: boolean } = {},
): Promise<ExtensionBackendBuildResult> {
  const cacheDir = join(getExtensionCacheRoot(), extensionId);
  const outfile = join(cacheDir, 'backend.mjs');
  const hashFile = join(cacheDir, 'backend.hash');
  const packageHash = hashExtensionBackendInputs(packageRoot);
  await mkdir(cacheDir, { recursive: true });

  if (existsSync(outfile) && existsSync(hashFile) && readFileSync(hashFile, 'utf-8').trim() === packageHash) {
    return { path: outfile, rebuilt: false, stale: false };
  }

  const candidate = join(cacheDir, `backend.${packageHash}.candidate.mjs`);
  try {
    rmSync(candidate, { force: true });
    await build({
      entryPoints: [entryPath],
      outfile: candidate,
      bundle: true,
      platform: 'node',
      format: 'esm',
      target: 'node20',
      sourcemap: 'inline',
      logLevel: 'silent',
      banner: {
        js: 'import { createRequire as __paCreateRequire } from "node:module"; const require = __paCreateRequire(import.meta.url);',
      },
      external: ['electron'],
      plugins: [createExtensionBackendApiPlugin(), createHostRuntimeExternalPlugin()],
    });
    renameSync(candidate, outfile);
    writeFileSync(hashFile, `${packageHash}\n`);
    return { path: outfile, rebuilt: true, stale: false };
  } catch (error) {
    rmSync(candidate, { force: true });
    if (options.allowStaleOnFailure && existsSync(outfile)) {
      return { path: outfile, rebuilt: false, stale: true };
    }
    throw error;
  }
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
  const compiled = await buildExtensionBackend(extensionId, packageRoot, entryPath, { allowStaleOnFailure: true });
  if (compiled.stale) {
    console.warn(`[extension:${extensionId}] backend build failed; using previous compiled backend`);
  }
  return import(`${pathToFileURL(compiled.path).href}?t=${Date.now()}`) as Promise<ExtensionBackendModule>;
}

export async function loadExtensionAgentFactory(extensionId: string, exportName = 'default'): Promise<ExtensionFactory> {
  const backend = await loadExtensionBackend(extensionId);
  const candidate = exportName === 'default' ? backend.default : backend[exportName];
  if (typeof candidate !== 'function') {
    throw new Error(`Extension agent factory export not found: ${exportName}`);
  }
  return candidate as ExtensionFactory;
}

export async function invokeExtensionAction(
  extensionId: string,
  actionId: string,
  input: unknown,
  serverContext?: Pick<ServerRouteContext, 'getCurrentProfile'>,
  toolContext?: ExtensionBackendContext['toolContext'],
  agentToolContext?: unknown,
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
    createBackendContext(extensionId, serverContext, toolContext, agentToolContext),
  );
  return { ok: true, result };
}

export async function reloadExtensionBackend(extensionId: string): Promise<{ ok: true; extensionId: string; rebuilt: boolean }> {
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
  const compiled = await buildExtensionBackend(extensionId, packageRoot, entryPath, { allowStaleOnFailure: false });
  await import(`${pathToFileURL(compiled.path).href}?t=${Date.now()}`);
  return { ok: true, extensionId, rebuilt: compiled.rebuilt };
}
