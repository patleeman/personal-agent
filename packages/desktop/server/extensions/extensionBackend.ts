import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { getStateRoot } from '@personal-agent/core';
import type { Plugin } from 'esbuild';

import type { LiveSessionResourceOptions, ServerRouteContext } from '../routes/context.js';
import { invalidateAppTopics, publishAppEvent } from '../shared/appEvents.js';
import { logError, logInfo, logWarn } from '../shared/logging.js';
import { createExtensionAutomationsCapability } from './extensionAutomations.js';
import { isPrebuiltOnlyExtensionRuntime, resolvePackagedExtensionBackendLoadTarget } from './extensionBackendLoadTarget.js';
import { createExtensionConversationsCapability } from './extensionConversations.js';
import { publishExtensionEvent, subscribeExtensionEvents } from './extensionEventBus.js';
import { createExtensionModelsCapability } from './extensionModels.js';
import { isSystemNotificationAvailable, sendNotifyAsSystemNotification, setExtensionBadge } from './extensionNotifications.js';
import {
  clearExtensionHealthError,
  findExtensionEntry,
  listExtensionInstallSummaries,
  setExtensionHealthError,
} from './extensionRegistry.js';
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
  models: ReturnType<typeof createExtensionModelsCapability>;
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

export interface ExtensionActionTelemetryEntry {
  extensionId: string;
  actionId: string;
  ok: boolean;
  durationMs: number;
  at: string;
  error?: string;
}

const actionTelemetry: ExtensionActionTelemetryEntry[] = [];

function recordActionTelemetry(entry: ExtensionActionTelemetryEntry): void {
  actionTelemetry.unshift(entry);
  actionTelemetry.splice(100);
}

export function listExtensionActionTelemetry(extensionId?: string): ExtensionActionTelemetryEntry[] {
  return actionTelemetry.filter((entry) => !extensionId || entry.extensionId === extensionId);
}

const EXTENSION_BACKEND_BUILD_CACHE_VERSION = 'bundle-host-runtime-externals-v3';
const backendModuleCache = new Map<string, { cacheKey: string; module: Promise<ExtensionBackendModule> }>();
const HOST_RUNTIME_EXTERNAL_IMPORT_RE =
  /^(@personal-agent\/(core|daemon)|@earendil-works\/pi-coding-agent|@xenova\/transformers|better-sqlite3|esbuild|jsdom|@sinclair\/typebox)(\/.*)?$/;

export class ExtensionLoadError extends Error {
  readonly extensionId: string;
  readonly code: 'build_failure' | 'load_failure' | 'handler_not_found' | 'module_not_found';

  constructor(opts: { extensionId: string; code: ExtensionLoadError['code']; message: string; cause?: unknown }) {
    super(opts.message);
    this.name = 'ExtensionLoadError';
    this.extensionId = opts.extensionId;
    this.code = opts.code;
    if (opts.cause instanceof Error) {
      this.cause = opts.cause;
    }
  }
}

export type ExtensionActionInvokeResult = { ok: true; result: unknown } | { ok: false; error: string };

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
    models: createExtensionModelsCapability(),
    vault: createExtensionVaultCapability(),
    conversations: createExtensionConversationsCapability(serverContext),
    workspace: createExtensionWorkspaceCapability(),
    git: createExtensionGitCapability(),
    shell: createExtensionShellCapability(),
    notify: {
      toast: (message, type = 'info') => {
        logInfo('extension notification', { extensionId, type, message });
        invalidateAppTopics('notifications');
        publishAppEvent({ type: 'notification', extensionId, message, severity: type });
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
        const actionResult = await invokeExtensionAction(targetExtensionId, actionId, input, serverContext, toolContext, agentToolContext);
        if (!actionResult.ok) throw new Error(actionResult.error);
        return actionResult.result;
      },
      listActions: () =>
        listExtensionInstallSummaries()
          .filter((summary) => summary.status === 'enabled' && (summary.backendActions?.length ?? 0) > 0)
          .map((summary) => ({
            extensionId: summary.id,
            extensionName: summary.name,
            actions: (summary.backendActions ?? []).map((action) => ({
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
      invalidate: (topics) => {
        const items = Array.isArray(topics) ? topics : [topics];
        invalidateAppTopics(...(items as import('../shared/appEvents.js').AppEventTopic[]));
      },
    },
    log: {
      info: (message, fields) => logInfo(`extension:${extensionId} ${message}`, fields),
      warn: (message, fields) => logWarn(`extension:${extensionId} ${message}`, fields),
      error: (message, fields) => logError(`extension:${extensionId} ${message}`, fields),
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
    // When running from the development repo, resolve relative to CWD
    ...(process.env.PERSONAL_AGENT_REPO_ROOT
      ? [resolve(process.env.PERSONAL_AGENT_REPO_ROOT, 'packages/desktop/server/extensions/backendApi.ts')]
      : []),
    resolve(process.cwd(), 'packages/desktop/server/extensions/backendApi.ts'),
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

function resolveExtensionBackendApiSubpath(subpath: string): string {
  const backendApiRoot = dirname(resolveExtensionBackendApiPath());
  const normalized = subpath.replace(/^\/+/, '').replace(/\.js$/, '');
  if (!normalized || normalized.includes('..')) throw new Error(`Invalid extension backend API subpath: ${subpath}`);
  const candidates = [resolve(backendApiRoot, `${normalized}.ts`), resolve(backendApiRoot, normalized, 'index.ts')];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  for (const candidate of candidates) {
    const jsPath = candidate.replace(/\.ts$/, '.js');
    if (existsSync(jsPath)) return jsPath;
  }
  throw new Error(`Could not find extension backend API subpath: ${subpath}`);
}

function createExtensionBackendApiPlugin(): Plugin {
  const backendApiPath = resolveExtensionBackendApiPath();
  return {
    name: 'personal-agent-extension-backend-api',
    setup(buildContext) {
      buildContext.onResolve({ filter: /^@personal-agent\/extensions\/backend$/ }, () => ({ path: backendApiPath }));
      buildContext.onResolve({ filter: /^@personal-agent\/extensions\/backend\/(.+)$/ }, (args) => {
        const match = args.path.match(/^@personal-agent\/extensions\/backend\/(.+)$/);
        return { path: resolveExtensionBackendApiSubpath(match?.[1] ?? '') };
      });
    },
  };
}

function findAppNodeModules(): string[] {
  const paths: string[] = [resolve(process.cwd(), 'node_modules')];
  if (typeof process.resourcesPath === 'string') {
    paths.push(resolve(process.resourcesPath, 'app.asar.unpacked/node_modules'));
  }
  const currentDir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 2; depth <= 5; depth++) {
    paths.push(resolve(currentDir, ...Array(depth).fill('..'), 'node_modules'));
  }
  return paths;
}

function createHostRuntimeExternalPlugin(): Plugin {
  return {
    name: 'personal-agent-extension-host-runtime-externals',
    setup(buildContext) {
      buildContext.onResolve({ filter: HOST_RUNTIME_EXTERNAL_IMPORT_RE }, async (args) => {
        if (args.path === '@personal-agent/daemon' && process.env.PERSONAL_AGENT_REPO_ROOT) {
          const daemonBundlePath = resolve(process.env.PERSONAL_AGENT_REPO_ROOT, 'packages/desktop/server/dist/daemon/index.js');
          if (existsSync(daemonBundlePath)) {
            return { path: daemonBundlePath, external: true };
          }
        }

        const resolveImport = (import.meta as ImportMeta & { resolve(specifier: string): string | Promise<string> }).resolve;
        const resolvedUrl = await Promise.resolve(resolveImport(args.path));
        return { path: fileURLToPath(resolvedUrl), external: true };
      });
    },
  };
}

interface ExtensionBackendBuildResult {
  path: string;
  hash: string;
  rebuilt: boolean;
  stale: boolean;
}

function loadCompiledExtensionBackendModule(
  extensionId: string,
  compiled: Pick<ExtensionBackendBuildResult, 'path' | 'hash'>,
): Promise<ExtensionBackendModule> {
  const cacheKey = `${compiled.path}:${compiled.hash}`;
  const cached = backendModuleCache.get(extensionId);
  if (cached?.cacheKey === cacheKey) {
    return cached.module;
  }

  const module = import(`${pathToFileURL(compiled.path).href}?v=${encodeURIComponent(compiled.hash)}`) as Promise<ExtensionBackendModule>;
  backendModuleCache.set(extensionId, { cacheKey, module });
  return module;
}

function renderPackagedExtensionBackendExpectation(
  entry: { source: 'system' | 'runtime'; packageRoot: string },
  backendEntry: string,
): string {
  if (entry.source === 'system' && backendEntry.startsWith('src/')) {
    return resolve(entry.packageRoot, 'dist', 'backend.mjs');
  }

  if (backendEntry.startsWith('src/') || backendEntry.endsWith('.ts')) {
    return resolve(entry.packageRoot, 'dist', 'backend.mjs');
  }

  return resolve(entry.packageRoot, backendEntry);
}

function createPackagedPrebuiltBackendError(
  extensionId: string,
  entry: { source: 'system' | 'runtime'; packageRoot: string },
  backendEntry: string,
): ExtensionLoadError {
  const expectedPath = renderPackagedExtensionBackendExpectation(entry, backendEntry);
  return new ExtensionLoadError({
    extensionId,
    code: 'build_failure',
    message:
      `Packaged desktop builds do not compile extensions at runtime. ` +
      `Extension "${extensionId}" must ship a prebuilt backend bundle at ${expectedPath}.`,
  });
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
    const { build } = await import('esbuild');
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
      nodePaths: findAppNodeModules(),
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
    throw new ExtensionLoadError({
      extensionId,
      code: 'module_not_found',
      message: `Extension "${extensionId}" is not installed or has been removed.`,
    });
  }
  if (!entry.packageRoot) {
    throw new ExtensionLoadError({
      extensionId,
      code: 'module_not_found',
      message: `Extension "${extensionId}" has no package root and cannot be loaded.`,
    });
  }
  const backendEntry = entry.manifest.backend?.entry;
  if (!backendEntry) {
    throw new ExtensionLoadError({
      extensionId,
      code: 'handler_not_found',
      message: `Extension "${extensionId}" has no backend entry in its manifest.`,
    });
  }

  const packagedPrebuilt = resolvePackagedExtensionBackendLoadTarget(entry, backendEntry);
  if (packagedPrebuilt) {
    return loadCompiledExtensionBackendModule(extensionId, packagedPrebuilt);
  }
  if (isPrebuiltOnlyExtensionRuntime()) {
    throw createPackagedPrebuiltBackendError(extensionId, { source: entry.source, packageRoot: entry.packageRoot }, backendEntry);
  }

  const packageRoot = resolve(entry.packageRoot);
  const entryPath = resolve(packageRoot, backendEntry);
  assertInside(packageRoot, entryPath);
  let compiled: ExtensionBackendBuildResult;
  try {
    compiled = await buildExtensionBackend(extensionId, packageRoot, entryPath, { allowStaleOnFailure: true });
    if (compiled.stale) {
      logWarn('extension backend build failed; using previous compiled backend', { extensionId });
    }
  } catch (buildError) {
    // Rebuild from source failed and no stale cache available.
    // Fall back to pre-built dist file if one exists (system extensions).
    const preBuiltEntry = resolve(packageRoot, 'dist', 'backend.mjs');
    if (existsSync(preBuiltEntry)) {
      logWarn('extension backend rebuild failed; falling back to pre-built dist/backend.mjs', { extensionId });
      compiled = { path: preBuiltEntry, hash: `prebuilt-${Date.now()}`, rebuilt: false, stale: false };
    } else {
      const causeMsg = buildError instanceof Error ? buildError.message : String(buildError);
      throw new ExtensionLoadError({
        extensionId,
        code: 'build_failure',
        message: `Extension "${extensionId}" failed to compile. This is usually because its source files or dependencies are missing. Error: ${causeMsg}`,
        cause: buildError,
      });
    }
  }

  return loadCompiledExtensionBackendModule(extensionId, compiled);
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
  const started = Date.now();
  try {
    const entry = findExtensionEntry(extensionId);
    if (!entry) {
      throw new ExtensionLoadError({
        extensionId,
        code: 'module_not_found',
        message: `Cannot invoke action "${actionId}": extension "${extensionId}" is not installed.`,
      });
    }
    const action = entry.manifest.backend?.actions?.find((candidate) => candidate.id === actionId);
    const handlerName = action?.handler ?? actionId;
    const backend = await loadExtensionBackend(extensionId);
    const handler = backend[handlerName];
    if (typeof handler !== 'function') {
      throw new ExtensionLoadError({
        extensionId,
        code: 'handler_not_found',
        message: `Extension "${extensionId}" backend does not export action handler "${handlerName}".`,
      });
    }

    const result = await (handler as (input: unknown, ctx: ExtensionBackendContext) => unknown | Promise<unknown>)(
      input,
      createBackendContext(extensionId, serverContext, toolContext, agentToolContext),
    );
    recordActionTelemetry({ extensionId, actionId, ok: true, durationMs: Date.now() - started, at: new Date().toISOString() });
    return { ok: true, result };
  } catch (error) {
    const message =
      error instanceof ExtensionLoadError
        ? error.message
        : `Extension "${extensionId}" action "${actionId}" failed: ${error instanceof Error ? error.message : String(error)}`;
    recordActionTelemetry({
      extensionId,
      actionId,
      ok: false,
      durationMs: Date.now() - started,
      at: new Date().toISOString(),
      error: message,
    });
    return { ok: false, error: message };
  }
}

export async function runExtensionSelfTest(
  extensionId: string,
): Promise<{ ok: boolean; extensionId: string; checks: Array<{ name: string; ok: boolean; error?: string }> }> {
  const checks: Array<{ name: string; ok: boolean; error?: string }> = [];
  const entry = findExtensionEntry(extensionId);
  if (!entry) throw new Error('Extension not found.');
  if (!entry.manifest.backend?.entry) return { ok: true, extensionId, checks: [{ name: 'backend', ok: true }] };

  try {
    const backend = await loadExtensionBackend(extensionId);
    clearExtensionHealthError(extensionId);
    checks.push({ name: 'backend import', ok: true });
    for (const action of entry.manifest.backend.actions ?? []) {
      const handlerName = action.handler ?? action.id;
      checks.push({
        name: `action export: ${action.id}`,
        ok: typeof backend[handlerName] === 'function',
        ...(typeof backend[handlerName] === 'function' ? {} : { error: `Missing export ${handlerName}` }),
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setExtensionHealthError(extensionId, message);
    checks.push({ name: 'backend import', ok: false, error: message });
  }
  invalidateAppTopics('extensions');
  return { ok: checks.every((check) => check.ok), extensionId, checks };
}

/**
 * Call the startupAction for every enabled extension that declares one.
 * Startup actions receive an empty object as input and run with the default
 * server context (no tool context). Errors are logged per-extension but do
 * not block other extensions from starting.
 */
export async function checkEnabledExtensionBackendHealth(): Promise<Array<{ extensionId: string; ok: boolean; error?: string }>> {
  const results: Array<{ extensionId: string; ok: boolean; error?: string }> = [];

  for (const summary of listExtensionInstallSummaries()) {
    if (summary.status !== 'enabled' || !summary.manifest.backend?.entry) continue;
    try {
      await loadExtensionBackend(summary.id);
      clearExtensionHealthError(summary.id);
      results.push({ extensionId: summary.id, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setExtensionHealthError(summary.id, message);
      logError('extension backend health check failed', { extensionId: summary.id, message });
      publishAppEvent({
        type: 'notification',
        extensionId: summary.id,
        message: `Extension backend failed to load: ${message}`,
        severity: 'error',
      });
      results.push({ extensionId: summary.id, ok: false, error: message });
    }
  }

  invalidateAppTopics('extensions');
  return results;
}

export async function startExtensionStartupActions(
  serverContext?: ExtensionBackendServerContext,
): Promise<Array<{ extensionId: string; ok: boolean; error?: string }>> {
  const results: Array<{ extensionId: string; ok: boolean; error?: string }> = [];

  for (const summary of listExtensionInstallSummaries()) {
    if (summary.status !== 'enabled') {
      continue;
    }

    const entry = findExtensionEntry(summary.id);
    const startupActionId = entry?.manifest.backend?.startupAction;
    if (!startupActionId) {
      continue;
    }

    try {
      await invokeExtensionAction(summary.id, startupActionId, {}, serverContext);
      results.push({ extensionId: summary.id, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError('extension startup action failed', { extensionId: summary.id, startupActionId, message });
      publishAppEvent({ type: 'notification', extensionId: summary.id, message: `Startup action failed: ${message}`, severity: 'error' });
      results.push({ extensionId: summary.id, ok: false, error: message });
    }
  }

  return results;
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

  const packagedPrebuilt = resolvePackagedExtensionBackendLoadTarget(entry, backendEntry);
  if (packagedPrebuilt) {
    await loadCompiledExtensionBackendModule(extensionId, packagedPrebuilt);
    clearExtensionHealthError(extensionId);
    return { ok: true, extensionId, rebuilt: false };
  }
  if (isPrebuiltOnlyExtensionRuntime()) {
    throw createPackagedPrebuiltBackendError(extensionId, { source: entry.source, packageRoot: entry.packageRoot }, backendEntry);
  }

  const packageRoot = resolve(entry.packageRoot);
  const entryPath = resolve(packageRoot, backendEntry);
  assertInside(packageRoot, entryPath);
  const compiled = await buildExtensionBackend(extensionId, packageRoot, entryPath, { allowStaleOnFailure: false });
  await loadCompiledExtensionBackendModule(extensionId, compiled);
  clearExtensionHealthError(extensionId);
  return { ok: true, extensionId, rebuilt: compiled.rebuilt };
}
