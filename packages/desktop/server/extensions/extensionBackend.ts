import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { getStateRoot } from '@personal-agent/core';
import { build, type Plugin } from 'esbuild';

import type { LiveSessionResourceOptions, ServerRouteContext } from '../routes/context.js';
import { invalidateAppTopics } from '../shared/appEvents.js';
import { createExtensionAutomationsCapability } from './extensionAutomations.js';
import { createExtensionConversationsCapability } from './extensionConversations.js';
import { publishExtensionEvent, subscribeExtensionEvents } from './extensionEventBus.js';
import { isSystemNotificationAvailable, sendNotifyAsSystemNotification, setExtensionBadge } from './extensionNotifications.js';
import { findExtensionEntry, listExtensionInstallSummaries } from './extensionRegistry.js';
import { createExtensionRunsCapability } from './extensionRuns.js';
import { createExtensionGitCapability, createExtensionShellCapability } from './extensionShell.js';
import { deleteExtensionState, listExtensionState, readExtensionState, writeExtensionState } from './extensionStorage.js';
import { createExtensionVaultCapability } from './extensionVault.js';
import { createExtensionWorkspaceCapability } from './extensionWorkspace.js';

export interface ExtensionBackendNotifyInput {
  /** Primary notification text. */
  message: string;
  /** Optional notification title (defaults to extension name). */
  title?: string;
  /** Optional subtitle (macOS only). */
  subtitle?: string;
  /** If true, the notification persists until acknowledged. */
  persistent?: boolean;
  /** Optional payload delivered on notification click. */
  actionPayload?: unknown;
}

export interface ExtensionBackendEventPublishInput {
  /** Event name, e.g. "task:completed". */
  event: string;
  /** Free-form payload. */
  payload: unknown;
}

export interface ExtensionBackendContext {
  extensionId: string;
  profile: string;
  toolContext?: {
    conversationId?: string;
    cwd?: string;
    sessionFile?: string;
    sessionId?: string;
    preferredVisionModel?: string;
    /** Streaming update callback for long-running tool operations. */
    onUpdate?: (update: { content?: Array<{ type: string; text: string }>; isError?: boolean }) => void;
  };
  agentToolContext?: unknown;
  runtime: {
    getLiveSessionResourceOptions(): LiveSessionResourceOptions;
    getRepoRoot(): string;
  };
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
  /** Notification and UI capabilities. */
  notify: {
    /** Show an in-app toast notification. */
    toast(message: string, type?: 'info' | 'warning' | 'error'): void;
    /**
     * Send a system/OS notification.
     * Returns true if the notification was delivered.
     */
    system(input: ExtensionBackendNotifyInput): boolean;
    /** Set the dock badge count (accumulated across all extensions). */
    setBadge(count: number): { badge: number; aggregated: number };
    /** Clear this extension's badge contribution. */
    clearBadge(): void;
    /** Check if system notification support is available. */
    isSystemAvailable(): boolean;
  };
  /** Inter-extension event bus. */
  events: {
    /** Publish an event that other extensions can subscribe to. */
    publish(input: ExtensionBackendEventPublishInput): Promise<void>;
    /** Subscribe to events matching a pattern. */
    subscribe(
      pattern: string,
      handler: (event: { event: string; payload: unknown; sourceExtensionId: string; publishedAt: string }) => void | Promise<void>,
    ): { unsubscribe: () => void };
  };
  /** Call actions exposed by other extensions. */
  extensions: {
    /** Invoke an action on another extension by its id and action id. */
    callAction(extensionId: string, actionId: string, input?: unknown): Promise<unknown>;
    /** List all installed extensions and their actions. */
    listActions(): Array<{
      extensionId: string;
      extensionName: string;
      actions: Array<{ id: string; title?: string; description?: string }>;
    }>;
    getStatus(extensionId: string): { enabled: boolean; healthy: boolean; errors?: string[] };
  };
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
const backendModuleCache = new Map<string, { cacheKey: string; module: Promise<ExtensionBackendModule> }>();
const HOST_RUNTIME_EXTERNAL_IMPORT_RE =
  /^(@personal-agent\/(core|daemon)|@earendil-works\/pi-coding-agent|@xenova\/transformers|better-sqlite3|esbuild|jsdom)(\/.*)?$/;

interface ExtensionBackendBuildResult {
  path: string;
  hash: string;
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

type ExtensionBackendServerContext = Pick<ServerRouteContext, 'getCurrentProfile'> &
  Partial<Pick<ServerRouteContext, 'buildLiveSessionResourceOptions' | 'getRepoRoot'>>;

function createBackendContext(
  extensionId: string,
  serverContext?: ExtensionBackendServerContext,
  toolContext?: ExtensionBackendContext['toolContext'],
  agentToolContext?: unknown,
): ExtensionBackendContext {
  return {
    extensionId,
    profile: serverContext?.getCurrentProfile() ?? 'shared',
    ...(toolContext ? { toolContext } : {}),
    ...(agentToolContext ? { agentToolContext } : {}),
    runtime: {
      getLiveSessionResourceOptions: () => {
        if (!serverContext?.buildLiveSessionResourceOptions) {
          throw new Error('Live session resource option builder is not available for this extension action.');
        }
        return serverContext.buildLiveSessionResourceOptions(serverContext.getCurrentProfile());
      },
      getRepoRoot: () => serverContext?.getRepoRoot?.() ?? process.cwd(),
    },
    storage: createStorage(extensionId),
    automations: createExtensionAutomationsCapability(serverContext),
    runs: createExtensionRunsCapability(extensionId),
    vault: createExtensionVaultCapability(),
    conversations: createExtensionConversationsCapability(serverContext),
    workspace: createExtensionWorkspaceCapability(),
    git: createExtensionGitCapability(),
    shell: createExtensionShellCapability(),
    notify: {
      toast: (message, type = 'info') => {
        console.log(`[extension:${extensionId}] [${type}] ${message}`);
        invalidateAppTopics('notifications');
      },
      system: (input) => sendNotifyAsSystemNotification(extensionId, input),
      setBadge: (count) => setExtensionBadge(extensionId, count),
      clearBadge: () => setExtensionBadge(extensionId, 0),
      isSystemAvailable: () => isSystemNotificationAvailable(),
    },
    events: {
      publish: async (input) => {
        await publishExtensionEvent(extensionId, input.event, input.payload);
      },
      subscribe: (pattern, handler) => {
        return subscribeExtensionEvents(extensionId, pattern, handler);
      },
    },
    extensions: {
      callAction: async (targetExtensionId, actionId, input) => {
        const entry = findExtensionEntry(targetExtensionId);
        if (!entry) throw new Error(`Extension "${targetExtensionId}" not found.`);
        const action = entry.manifest.backend?.actions?.find((candidate) => candidate.id === actionId);
        if (!action) throw new Error(`Action "${actionId}" not found on extension "${targetExtensionId}".`);
        const result = await invokeExtensionAction(targetExtensionId, actionId, input, serverContext, toolContext, agentToolContext);
        return result.result;
      },
      listActions: () =>
        listExtensionInstallSummaries()
          .filter((summary) => summary.status === 'enabled' && summary.backendActions.length > 0)
          .map((summary) => ({
            extensionId: summary.id,
            extensionName: summary.name,
            actions: summary.backendActions!.map((action) => ({
              id: action.id,
              title: action.title,
              description: action.description,
            })),
          })),
      getStatus: (targetExtensionId) => {
        const summary = listExtensionInstallSummaries().find((e) => e.id === targetExtensionId);
        if (!summary) return { enabled: false, healthy: false };
        const enabled = summary.status === 'enabled';
        return {
          enabled,
          healthy: enabled && (!summary.errors || summary.errors.length === 0),
          ...(summary.errors?.length ? { errors: summary.errors } : {}),
        };
      },
    },
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

  // Directory-based backend API (refactored to backendApi/index.ts): hash the whole directory
  // Flat file backend API (backendApi.ts): hash the file and check for sibling backendApi/ dir
  if (backendApiPath.endsWith(`${sep}index.ts`) || backendApiPath.endsWith(`${sep}index.js`)) {
    hashDirectoryInto(hash, backendApiRoot, backendApiRoot, 'backend-api');
  } else {
    hashFileInto(hash, backendApiRoot, backendApiPath, 'backend-api');
    const backendApiDirectory = resolve(backendApiRoot, 'backendApi');
    if (existsSync(backendApiDirectory)) {
      hashDirectoryInto(hash, backendApiRoot, backendApiDirectory, 'backend-api');
    }
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

  // Check flat .ts files
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Flat .js fallbacks
  for (const candidate of candidates) {
    const jsPath = candidate.replace(/\.ts$/, '.js');
    if (existsSync(jsPath)) {
      return jsPath;
    }
  }

  // Check directory-based backendApi/index.ts (refactored from flat file to directory)
  for (const candidate of candidates) {
    const dirPath = candidate.replace(/\.ts$/, '');
    const indexPath = resolve(dirPath, 'index.ts');
    if (existsSync(indexPath)) {
      return indexPath;
    }
  }

  // Directory-based backendApi/index.js
  for (const candidate of candidates) {
    const dirPath = candidate.replace(/\.ts$/, '');
    const indexJsPath = resolve(dirPath, 'index.js');
    if (existsSync(indexJsPath)) {
      return indexJsPath;
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
    return { path: outfile, hash: packageHash, rebuilt: false, stale: false };
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
    return { path: outfile, hash: packageHash, rebuilt: true, stale: false };
  } catch (error) {
    rmSync(candidate, { force: true });
    if (options.allowStaleOnFailure && existsSync(outfile)) {
      const staleHash = existsSync(hashFile) ? readFileSync(hashFile, 'utf-8').trim() : `stale-${statSync(outfile).mtimeMs}`;
      return { path: outfile, hash: staleHash, rebuilt: false, stale: true };
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

  const cacheKey = `${compiled.path}:${compiled.hash}`;
  const cached = backendModuleCache.get(extensionId);
  if (cached?.cacheKey === cacheKey) {
    return cached.module;
  }

  const module = import(`${pathToFileURL(compiled.path).href}?v=${encodeURIComponent(compiled.hash)}`) as Promise<ExtensionBackendModule>;
  backendModuleCache.set(extensionId, { cacheKey, module });
  return module;
}

export async function loadExtensionAgentFactory(extensionId: string, exportName = 'default'): Promise<ExtensionFactory> {
  const backend = await loadExtensionBackend(extensionId);
  const candidate = exportName === 'default' ? backend.default : backend[exportName];
  if (typeof candidate !== 'function') {
    throw new Error(`Extension agent factory export not found: ${exportName}`);
  }

  // Agent extensions in manifests use two shapes in practice:
  // - direct ExtensionFactory: export default function extension(pi) { ... }
  // - factory builder: export function createExtension(): (pi) => void { ... }
  // Normalize both so the SDK always receives the actual (pi) => void factory.
  if (candidate.length === 0) {
    const built = (candidate as () => unknown)();
    if (typeof built !== 'function') {
      throw new Error(`Extension agent factory builder did not return a function: ${exportName}`);
    }
    return built as ExtensionFactory;
  }

  return candidate as ExtensionFactory;
}

export async function invokeExtensionAction(
  extensionId: string,
  actionId: string,
  input: unknown,
  serverContext?: ExtensionBackendServerContext,
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
  const cacheKey = `${compiled.path}:${compiled.hash}`;
  const module = import(`${pathToFileURL(compiled.path).href}?v=${encodeURIComponent(compiled.hash)}`) as Promise<ExtensionBackendModule>;
  backendModuleCache.set(extensionId, { cacheKey, module });
  await module;
  return { ok: true, extensionId, rebuilt: compiled.rebuilt };
}
