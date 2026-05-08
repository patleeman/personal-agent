import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { installProcessLogging } from '../middleware/index.js';
installProcessLogging();

import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
  getPiAgentRuntimeDir,
  getStateRoot,
  readKnowledgeBaseState,
  saveConversationCommitCheckpoint,
  startKnowledgeBaseSyncLoop,
  subscribeKnowledgeBaseState,
  syncKnowledgeBaseNow,
  updateKnowledgeBase,
} from '@personal-agent/core';
import { ensureAutomationThread } from '@personal-agent/daemon';
import { loadDaemonConfig, resolveDaemonPaths } from '@personal-agent/daemon';

import { readDaemonState } from '../automation/daemon.js';
import {
  cancelDurableRunCapability,
  listDurableRunsCapability,
  markDurableRunAttentionCapability,
  readDurableRunCapability,
  readDurableRunLogCapability,
} from '../automation/durableRunCapability.js';
import { getDurableRunSnapshot } from '../automation/durableRuns.js';
import {
  createScheduledTaskCapability,
  deleteScheduledTaskCapability,
  listScheduledTasksCapability,
  readScheduledTaskCapability,
  readScheduledTaskLogCapability,
  readScheduledTaskSchedulerHealth,
  runScheduledTaskCapability,
  updateScheduledTaskCapability,
} from '../automation/scheduledTaskCapability.js';
import { loadScheduledTasksForProfile } from '../automation/scheduledTasks.js';
import { buildScheduledTaskThreadDetail } from '../automation/scheduledTaskThreads.js';
import {
  createConversationAttachmentCapability,
  readConversationArtifactCapability,
  readConversationArtifactsCapability,
  readConversationAttachmentCapability,
  readConversationAttachmentDownloadCapability,
  readConversationAttachmentsCapability,
  readConversationCommitCheckpointCapability,
  readConversationCommitCheckpointsCapability,
  updateConversationAttachmentCapability,
} from '../conversations/conversationAssetsCapability.js';
import { isMissingConversationBootstrapState, readConversationBootstrapState } from '../conversations/conversationBootstrap.js';
import {
  createConversationCheckpointCommit,
  normalizeCheckpointPaths,
  readRequiredCheckpointString,
} from '../conversations/conversationCheckpointCommit.js';
import { resolveRequestedCwd } from '../conversations/conversationCwd.js';
import {
  cancelConversationDeferredResumeCapability,
  fireConversationDeferredResumeCapability,
  readConversationDeferredResumesCapability,
  scheduleConversationDeferredResumeCapability,
} from '../conversations/conversationDeferredResumeCapability.js';
import { applyConversationModelPreferencesToSessionManager } from '../conversations/conversationModelPreferences.js';
import { recoverConversationCapability } from '../conversations/conversationRecovery.js';
import {
  publishConversationSessionMetaChanged,
  readConversationModelPreferenceStateById,
  readConversationSessionSignature,
  readSessionDetailForRoute,
  resolveConversationSessionFile,
  toggleConversationAttention,
} from '../conversations/conversationService.js';
import {
  inlineConversationBootstrapAssetsCapability,
  inlineConversationSessionDetailAppendOnlyAssetsCapability,
  inlineConversationSessionDetailAssetsCapability,
  readConversationSessionBlockWithInlineAssetsCapability,
} from '../conversations/conversationSessionAssetCapability.js';
import {
  readConversationSessionMetaCapability,
  readConversationSessionsCapability,
  readConversationSessionSearchIndexCapability,
} from '../conversations/conversationSessionCapability.js';
import {
  applyDesktopConversationStreamEvent,
  type DesktopConversationState,
  readDesktopConversationState,
} from '../conversations/desktopConversationState.js';
import { createLiveDeferredResumeFlusher } from '../conversations/liveDeferredResumes.js';
import {
  abortLiveSessionCapability,
  branchLiveSessionCapability,
  compactLiveSessionCapability,
  createLiveSessionCapability,
  destroyLiveSessionCapability,
  forkLiveSessionCapability,
  type LiveSessionCapabilityContext,
  manageLiveSessionParallelJobCapability,
  reloadLiveSessionCapability,
  restoreQueuedLiveSessionMessageCapability,
  resumeLiveSessionCapability,
  submitLiveSessionParallelPromptCapability,
  submitLiveSessionPromptCapability,
  summarizeAndForkLiveSessionCapability,
  takeOverLiveSessionCapability,
} from '../conversations/liveSessionCapability.js';
import {
  exportSessionHtml,
  getLiveSessionForkEntries,
  getLiveSessions as getLocalLiveSessions,
  isLive as isLiveSession,
  promptSession,
  queuePromptContext,
  registry as liveRegistry,
  renameSession,
  resumeSession,
  subscribe as subscribeLiveSession,
} from '../conversations/liveSessions.js';
import {
  createSessionFromExisting,
  destroySession,
  getAvailableModelObjects,
  updateLiveSessionModelPreferences,
} from '../conversations/liveSessions.js';
import {
  appendConversationWorkspaceMetadata,
  buildAppendOnlySessionDetailResponse,
  readSessionBlocks,
  readSessionMeta,
  renameStoredSession,
} from '../conversations/sessions.js';
import { setWorkbenchBrowserToolHost, type WorkbenchBrowserToolHost } from '../extensions/workbenchBrowserToolHost.js';
import { listMemoryDocs, listSkillsForProfile } from '../knowledge/memoryDocs.js';
import { readSavedModelPreferences, writeSavedModelPreferences } from '../models/modelPreferences.js';
import { readModelState } from '../models/modelState.js';
import { getProviderOAuthLoginState, subscribeProviderOAuthLogin } from '../models/providerAuth.js';
import {
  cancelProviderOAuthLoginCapability,
  deleteModelProviderCapability,
  deleteModelProviderModelCapability,
  type ProviderDesktopCapabilityContext,
  readModelProvidersCapability,
  readProviderAuthCapability,
  readProviderOAuthLoginCapability,
  removeProviderCredentialCapability,
  saveModelProviderCapability,
  saveModelProviderModelCapability,
  setProviderApiKeyCapability,
  startProviderOAuthLoginCapability,
  submitProviderOAuthLoginInputCapability,
} from '../models/providerDesktopCapability.js';
import type { ServerRouteContext } from '../routes/context.js';
import { registerServerRoutes } from '../routes/registerAll.js';
import { buildSnapshotEventsForTopic, INITIAL_APP_EVENT_TOPICS } from '../routes/system.js';
import { invalidateAppTopics, subscribeAppEvents } from '../shared/appEvents.js';
import { readConversationPlansWorkspace } from '../ui/conversationPlanPreferences.js';
import { readSavedDefaultCwdPreferences, writeSavedDefaultCwdPreference } from '../ui/defaultCwdPreferences.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE, persistSettingsWrite } from '../ui/settingsPersistence.js';
import { readSavedUiPreferences, writeSavedUiPreferences } from '../ui/uiPreferences.js';
import { readGitStatusSummaryWithTelemetry } from '../workspace/gitStatus.js';
import { pickFolderCapability, readVaultFilesCapability } from '../workspace/workspaceDesktopCapability.js';
import { startConversationRecovery, startDeferredResumeLoop } from './bootstrap.js';
import { type DesktopLocalApiStreamEvent, subscribeDesktopLocalApiStreamByUrl } from './localApiStreams.js';
import { createServerRouteContext } from './routeContext.js';
import { createRuntimeState } from './runtimeState.js';

type RouteHandler = (req: LocalApiRequest, res: LocalApiResponse) => unknown;

interface RegisteredRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  pattern: RegExp;
  keys: string[];
  handler: RouteHandler;
}

interface LocalApiRequest extends EventEmitter {
  method: string;
  path: string;
  url: string;
  originalUrl: string;
  query: Record<string, string | string[]>;
  params: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
  protocol: string;
  ip: string;
  socket: { remoteAddress: string };
  get(name: string): string | undefined;
}

export interface DesktopLocalApiDispatchResult {
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export type DesktopConversationStateBridgeEvent =
  | { type: 'open' }
  | { type: 'state'; state: DesktopConversationState }
  | { type: 'error'; message: string }
  | { type: 'close' };

type DesktopAppBridgeEvent = { type: 'open' } | { type: 'event'; event: unknown } | { type: 'error'; message: string } | { type: 'close' };

export function setDesktopWorkbenchBrowserToolHost(host: WorkbenchBrowserToolHost | null): void {
  setWorkbenchBrowserToolHost(host);
}

class LocalApiResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  bodyChunks: Uint8Array[] = [];
  ended = false;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(value: unknown): this {
    this.setHeader('Content-Type', 'application/json; charset=utf-8');
    this.bodyChunks = [Buffer.from(JSON.stringify(value), 'utf-8')];
    this.ended = true;
    return this;
  }

  send(value: unknown): this {
    if (typeof value === 'string') {
      this.bodyChunks.push(Buffer.from(value, 'utf-8'));
      this.ended = true;
      return this;
    }

    if (value instanceof Uint8Array) {
      this.bodyChunks.push(value);
      this.ended = true;
      return this;
    }

    if (value instanceof ArrayBuffer) {
      this.bodyChunks.push(new Uint8Array(value));
      this.ended = true;
      return this;
    }

    if (value === undefined || value === null) {
      this.ended = true;
      return this;
    }

    return this.json(value);
  }

  sendFile(path: string): this {
    this.bodyChunks.push(readFileSync(path));
    this.ended = true;
    return this;
  }

  type(value: string): this {
    this.setHeader('Content-Type', value);
    return this;
  }

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  flushHeaders(): void {
    // No-op for in-process local requests.
  }

  write(chunk: string | Uint8Array): void {
    if (typeof chunk === 'string') {
      this.bodyChunks.push(Buffer.from(chunk, 'utf-8'));
      return;
    }

    this.bodyChunks.push(chunk);
  }

  end(chunk?: string | Uint8Array): void {
    if (typeof chunk === 'string') {
      this.bodyChunks.push(Buffer.from(chunk, 'utf-8'));
    } else if (chunk instanceof Uint8Array) {
      this.bodyChunks.push(chunk);
    }

    this.ended = true;
  }

  cookie(): this {
    return this;
  }

  clearCookie(): this {
    return this;
  }

  getBody(): Uint8Array {
    if (this.bodyChunks.length === 0) {
      return new Uint8Array();
    }

    return Buffer.concat(this.bodyChunks.map((chunk) => Buffer.from(chunk)));
  }
}

let localRoutesPromise: Promise<RegisteredRoute[]> | null = null;
let localServerRouteContext: ServerRouteContext | null = null;
let localLiveSessionCapabilityContext: LiveSessionCapabilityContext | null = null;
let localProviderDesktopCapabilityContext: ProviderDesktopCapabilityContext | null = null;

const LOCAL_API_DEFERRED_RESUME_POLL_MS = 3_000;
const MAX_DESKTOP_ROLLBACK_TURNS = 100;

function resolveRepoRoot(): string {
  const defaultRepoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  return process.env.PERSONAL_AGENT_REPO_ROOT ?? defaultRepoRoot;
}

function resolveDaemonRoot(): string {
  return resolveDaemonPaths(loadDaemonConfig().ipc.socketPath).root;
}

function buildRoutePattern(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const escaped = path
    .split('/')
    .map((segment) => {
      if (!segment) {
        return '';
      }

      if (segment === '*') {
        keys.push('0');
        return '(.+)';
      }

      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }

      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');

  return {
    pattern: new RegExp(`^${escaped}$`),
    keys,
  };
}

function buildQueryObject(searchParams: URLSearchParams): Record<string, string | string[]> {
  const query: Record<string, string | string[]> = {};

  for (const [key, value] of searchParams.entries()) {
    const existing = query[key];
    if (existing === undefined) {
      query[key] = value;
      continue;
    }

    query[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }

  return query;
}

function createLocalApiRequest(input: {
  method: string;
  url: URL;
  params: Record<string, string>;
  body: unknown;
  headers?: Record<string, string>;
}): LocalApiRequest {
  const request = new EventEmitter() as LocalApiRequest;
  const normalizedHeaders = Object.fromEntries(Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
  request.method = input.method;
  request.path = input.url.pathname;
  request.url = `${input.url.pathname}${input.url.search}`;
  request.originalUrl = request.url;
  request.query = buildQueryObject(input.url.searchParams);
  request.params = input.params;
  request.body = input.body;
  request.headers = normalizedHeaders;
  request.protocol = 'desktop';
  request.ip = '127.0.0.1';
  request.socket = { remoteAddress: '127.0.0.1' };
  request.get = (name: string) => normalizedHeaders[name.toLowerCase()];
  return request;
}

function createRouteCollector(
  routes: RegisteredRoute[],
): Pick<
  { get: unknown; put: unknown; post: unknown; patch: unknown; delete: unknown; use: unknown },
  'get' | 'put' | 'post' | 'patch' | 'delete' | 'use'
> {
  const register =
    (method: RegisteredRoute['method']) =>
    (path: string, ...handlers: RouteHandler[]) => {
      const handler = handlers[handlers.length - 1];
      if (!handler) {
        return;
      }

      const { pattern, keys } = buildRoutePattern(path);
      routes.push({ method, path, pattern, keys, handler });
    };

  return {
    get: register('GET'),
    put: register('PUT'),
    post: register('POST'),
    patch: register('PATCH'),
    delete: register('DELETE'),
    use: () => {
      // Local desktop routes bypass HTTP auth middleware and other Express-only app.use chains.
    },
  };
}

async function buildLocalRoutes(): Promise<RegisteredRoute[]> {
  const repoRoot = resolveRepoRoot();
  const agentDir = getPiAgentRuntimeDir();
  const authFile = join(agentDir, 'auth.json');
  const settingsFile = DEFAULT_RUNTIME_SETTINGS_FILE;

  const runtimeState = createRuntimeState({
    repoRoot,
    agentDir,
    logger: {
      warn: () => {
        // Ignore local desktop route-context warnings here.
      },
    },
  });

  const flushLiveDeferredResumes = createLiveDeferredResumeFlusher({
    getCurrentProfile: runtimeState.getRuntimeScope,
    getRepoRoot: () => repoRoot,
    getStateRoot,
    resolveDaemonRoot,
    publishConversationSessionMetaChanged,
  });

  startDeferredResumeLoop({
    flushLiveDeferredResumes,
    pollMs: LOCAL_API_DEFERRED_RESUME_POLL_MS,
  });

  const context = createServerRouteContext({
    repoRoot,
    settingsFile,
    authFile,
    getCurrentProfile: runtimeState.getRuntimeScope,
    materializeWebProfile: () => runtimeState.materializeRuntimeResources(),
    getStateRoot,
    serverPort: 0,
    getDefaultWebCwd: () => process.cwd(),
    resolveRequestedCwd,
    buildLiveSessionResourceOptions: runtimeState.buildLiveSessionResourceOptions,
    buildLiveSessionExtensionFactories: runtimeState.buildLiveSessionExtensionFactories,
    flushLiveDeferredResumes,
    getSavedUiPreferences: () => readSavedUiPreferences(settingsFile),
    listTasksForCurrentProfile: () => {
      const loaded = loadScheduledTasksForProfile(runtimeState.getRuntimeScope());
      const runtimeById = new Map(loaded.runtimeEntries.flatMap((task) => (task.id ? [[task.id, task] as const] : [])));

      return loaded.tasks.map((task) => {
        const taskWithThread = task.threadMode === 'dedicated' && !task.threadConversationId ? ensureAutomationThread(task.id) : task;
        const runtime = loaded.runtimeState[task.id] ?? runtimeById.get(task.id);
        const threadDetail = buildScheduledTaskThreadDetail(taskWithThread);
        return {
          id: taskWithThread.id,
          title: taskWithThread.title,
          filePath: taskWithThread.legacyFilePath,
          scheduleType: taskWithThread.schedule.type,
          running: runtime?.running ?? false,
          enabled: taskWithThread.enabled,
          cron: taskWithThread.schedule.type === 'cron' ? taskWithThread.schedule.expression : undefined,
          at: taskWithThread.schedule.type === 'at' ? taskWithThread.schedule.at : undefined,
          prompt: taskWithThread.prompt.split('\n')[0]?.slice(0, 120) ?? '',
          model: taskWithThread.modelRef,
          cwd: taskWithThread.cwd,
          ...(taskWithThread.catchUpWindowSeconds !== undefined ? { catchUpWindowSeconds: taskWithThread.catchUpWindowSeconds } : {}),
          threadConversationId: threadDetail.threadConversationId,
          threadTitle: threadDetail.threadTitle,
          lastStatus: runtime?.lastStatus,
          lastRunAt: runtime?.lastRunAt,
          lastSuccessAt: runtime?.lastSuccessAt,
          lastAttemptCount: runtime?.lastAttemptCount,
        };
      });
    },
    listMemoryDocs: () =>
      listMemoryDocs().map((doc) => ({
        id: doc.id,
        title: doc.title,
        summary: doc.summary,
        description: doc.description,
        path: doc.path,
        updated: doc.updated,
      })),
    listSkillsForCurrentProfile: () =>
      listSkillsForProfile(runtimeState.getRuntimeScope()).map((skill) => ({
        name: skill.name,
        source: skill.source,
        description: skill.description,
        path: skill.path,
      })),
    listProfileAgentItems: () => [],
    withTemporaryProfileAgentDir: (_profile, run) => runtimeState.withTemporaryRuntimeAgentDir(run),
    getDurableRunSnapshot: async (runId: string, tail: number) => (await getDurableRunSnapshot(runId, tail)) ?? null,
  });

  startConversationRecovery({
    flushLiveDeferredResumes,
    buildLiveSessionResourceOptions: context.buildLiveSessionResourceOptions,
    buildLiveSessionExtensionFactories: context.buildLiveSessionExtensionFactories,
    isLive: isLiveSession,
    resumeSession,
    queuePromptContext,
    promptSession,
  });

  localServerRouteContext = context;

  localLiveSessionCapabilityContext = {
    getCurrentProfile: context.getCurrentProfile,
    getRepoRoot: context.getRepoRoot,
    getDefaultWebCwd: context.getDefaultWebCwd,
    buildLiveSessionResourceOptions: context.buildLiveSessionResourceOptions,
    buildLiveSessionExtensionFactories: context.buildLiveSessionExtensionFactories,
    flushLiveDeferredResumes: context.flushLiveDeferredResumes,
    listTasksForCurrentProfile: context.listTasksForCurrentProfile,
    listMemoryDocs: context.listMemoryDocs,
  };

  localProviderDesktopCapabilityContext = {
    getCurrentProfile: context.getCurrentProfile,
    materializeWebProfile: context.materializeWebProfile,
    getAuthFile: context.getAuthFile,
  };

  const routes: RegisteredRoute[] = [];
  const appRouter = createRouteCollector(routes);
  registerServerRoutes({
    app: appRouter as never,
    context,
  });

  return routes;
}

async function getLocalRoutes(): Promise<RegisteredRoute[]> {
  if (!localRoutesPromise) {
    localRoutesPromise = buildLocalRoutes();
  }

  return localRoutesPromise;
}

async function getLocalServerRouteContext(): Promise<ServerRouteContext> {
  await getLocalRoutes();
  if (!localServerRouteContext) {
    throw new Error('Local server route context is not initialized.');
  }

  return localServerRouteContext;
}

async function getLocalLiveSessionCapabilityContext(): Promise<LiveSessionCapabilityContext> {
  await getLocalRoutes();
  if (!localLiveSessionCapabilityContext) {
    throw new Error('Local live-session capability context is not initialized.');
  }

  return localLiveSessionCapabilityContext;
}

async function getLocalProviderDesktopCapabilityContext(): Promise<ProviderDesktopCapabilityContext> {
  await getLocalRoutes();
  if (!localProviderDesktopCapabilityContext) {
    throw new Error('Local provider/model capability context is not initialized.');
  }

  return localProviderDesktopCapabilityContext;
}

subscribeKnowledgeBaseState(() => {
  invalidateAppTopics('knowledgeBase');
});

// The desktop shell serves local API routes directly inside Electron. Running the
// managed knowledge-base sync loop there shells out to git on a timer and can
// block the app while the user is clicking around. Keep the loop in the managed
// web service, but skip it for the embedded desktop runtime and its worker
// helpers.
if (process.env.PERSONAL_AGENT_DESKTOP_RUNTIME !== '1') {
  startKnowledgeBaseSyncLoop();
}

function renderStatusText(statusCode: number): string {
  switch (statusCode) {
    case 400:
      return 'Bad Request';
    case 401:
      return 'Unauthorized';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not Found';
    case 409:
      return 'Conflict';
    case 500:
      return 'Internal Server Error';
    default:
      return 'Error';
  }
}

function decodeBody(body: Uint8Array): string {
  return Buffer.from(body).toString('utf-8');
}

function readLocalApiError(response: DesktopLocalApiDispatchResult): string {
  const contentType = response.headers['content-type'] ?? '';
  const bodyText = decodeBody(response.body);

  if (contentType.toLowerCase().includes('application/json')) {
    try {
      const payload = JSON.parse(bodyText) as { error?: string };
      if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
        return payload.error;
      }
    } catch {
      // Ignore malformed local JSON error bodies.
    }
  }

  return bodyText.trim() || `${response.statusCode} ${renderStatusText(response.statusCode)}`;
}

function findMatchingRoute(
  routes: RegisteredRoute[],
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  pathname: string,
): RegisteredRoute | undefined {
  return routes.find((candidate) => candidate.method === method && candidate.pattern.test(pathname));
}

function mapSnapshotEventToDesktopAppEvent(event: unknown): unknown | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const typedEvent = event as {
    type?: string;
    sessions?: unknown;
    tasks?: unknown;
    result?: unknown;
    state?: unknown;
  };

  switch (typedEvent.type) {
    case 'sessions_snapshot':
      return {
        type: 'sessions',
        sessions: Array.isArray(typedEvent.sessions) ? typedEvent.sessions : [],
      };
    case 'tasks_snapshot':
      return {
        type: 'tasks',
        tasks: Array.isArray(typedEvent.tasks) ? typedEvent.tasks : [],
      };
    case 'runs_snapshot':
      return {
        type: 'runs',
        result: typedEvent.result ?? null,
      };
    case 'daemon_snapshot':
      return {
        type: 'daemon',
        state: typedEvent.state ?? null,
      };
    default:
      return null;
  }
}

async function buildDesktopAppEventsForTopics(topics: readonly string[]): Promise<unknown[]> {
  const events: unknown[] = [];
  const seen = new Set<string>();

  for (const topic of topics) {
    if (seen.has(topic)) {
      continue;
    }

    seen.add(topic);
    const snapshotEvents = await buildSnapshotEventsForTopic(topic as Parameters<typeof buildSnapshotEventsForTopic>[0]);
    for (const snapshotEvent of snapshotEvents) {
      const mappedEvent = mapSnapshotEventToDesktopAppEvent(snapshotEvent);
      if (mappedEvent) {
        events.push(mappedEvent);
      }
    }
  }

  return events;
}

export async function subscribeDesktopAppEvents(onEvent: (event: DesktopAppBridgeEvent) => void): Promise<() => void> {
  await getLocalRoutes();

  let closed = false;
  let writeQueue = Promise.resolve();

  const emitEvent = (event: unknown) => {
    if (closed) {
      return;
    }

    onEvent({ type: 'event', event });
  };

  const enqueueWrite = (task: () => Promise<void> | void) => {
    writeQueue = writeQueue
      .then(async () => {
        if (closed) {
          return;
        }

        await task();
      })
      .catch((error) => {
        if (closed) {
          return;
        }

        onEvent({
          type: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      });
  };

  onEvent({ type: 'open' });
  enqueueWrite(async () => {
    const bootstrapEvents = await buildDesktopAppEventsForTopics(INITIAL_APP_EVENT_TOPICS);
    for (const event of bootstrapEvents) {
      emitEvent(event);
    }
  });

  const unsubscribe = subscribeAppEvents((event) => {
    if (event.type === 'invalidate') {
      enqueueWrite(async () => {
        const mappedEvents = await buildDesktopAppEventsForTopics(event.topics);
        for (const mappedEvent of mappedEvents) {
          emitEvent(mappedEvent);
        }
        emitEvent(event);
      });
      return;
    }

    emitEvent(event);
  });

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    unsubscribe();
    onEvent({ type: 'close' });
  };
}

function shouldRefreshDesktopConversationStateForAppEvent(
  conversationId: string,
  event: { type?: string; topics?: unknown; sessionId?: unknown },
): boolean {
  if (event.type === 'invalidate') {
    const topics = Array.isArray(event.topics) ? event.topics : [];
    return topics.includes('sessions') || topics.includes('sessionFiles');
  }

  if (
    (event.type === 'live_title' || event.type === 'session_meta_changed' || event.type === 'session_file_changed') &&
    typeof event.sessionId === 'string'
  ) {
    return event.sessionId === conversationId;
  }

  return false;
}

export function normalizeDesktopLocalApiTailBlocks(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(1000, value) : undefined;
}

export async function subscribeDesktopConversationState(
  input: {
    conversationId: string;
    tailBlocks?: number;
    surfaceId?: string;
    surfaceType?: 'desktop_web' | 'mobile_web';
  },
  onEvent: (event: DesktopConversationStateBridgeEvent) => void,
): Promise<() => void> {
  const capabilityContext = await getLocalLiveSessionCapabilityContext();
  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new Error('conversationId required');
  }
  const tailBlocks = normalizeDesktopLocalApiTailBlocks(input.tailBlocks);

  let closed = false;
  let liveUnsubscribe: (() => void) | null = null;
  let appUnsubscribe: (() => void) | null = null;
  let currentState = await readDesktopConversationState({
    conversationId,
    profile: capabilityContext.getCurrentProfile(),
    tailBlocks,
  });
  let lastSerializedState = '';

  const ensureCurrentStateIsLive = async () => {
    if (closed || currentState.liveSession.live || !currentState.sessionDetail) {
      return;
    }

    await recoverConversationCapability(conversationId, {
      getCurrentProfile: capabilityContext.getCurrentProfile,
      buildLiveSessionResourceOptions: capabilityContext.buildLiveSessionResourceOptions,
      buildLiveSessionExtensionFactories: capabilityContext.buildLiveSessionExtensionFactories,
      flushLiveDeferredResumes: capabilityContext.flushLiveDeferredResumes,
    });

    currentState = await readDesktopConversationState({
      conversationId,
      profile: capabilityContext.getCurrentProfile(),
      tailBlocks,
    });
  };

  const emitState = (state: DesktopConversationState) => {
    if (closed) {
      return;
    }

    const serialized = JSON.stringify(state);
    if (serialized === lastSerializedState) {
      return;
    }

    lastSerializedState = serialized;
    onEvent({ type: 'state', state });
  };

  const closeLiveSubscription = () => {
    liveUnsubscribe?.();
    liveUnsubscribe = null;
  };

  const syncLiveSubscription = () => {
    closeLiveSubscription();

    if (!currentState.liveSession.live) {
      return;
    }

    liveUnsubscribe = subscribeLiveSession(
      conversationId,
      (event) => {
        if (closed) {
          return;
        }

        currentState = {
          ...currentState,
          liveSession: currentState.liveSession.live
            ? {
                ...currentState.liveSession,
                ...(event.type === 'title_update' ? { title: event.title } : {}),
              }
            : currentState.liveSession,
          stream: applyDesktopConversationStreamEvent(currentState.stream, event),
        };

        if (currentState.liveSession.live) {
          currentState = {
            ...currentState,
            liveSession: {
              ...currentState.liveSession,
              isStreaming: currentState.stream.isStreaming,
            },
          };
        }

        emitState(currentState);
      },
      {
        ...(tailBlocks !== undefined ? { tailBlocks } : {}),
        ...(input.surfaceId && input.surfaceType ? { surface: { surfaceId: input.surfaceId, surfaceType: input.surfaceType } } : {}),
      },
    );
  };

  const refreshState = async () => {
    currentState = await readDesktopConversationState({
      conversationId,
      profile: capabilityContext.getCurrentProfile(),
      tailBlocks,
    });
    await ensureCurrentStateIsLive();
    syncLiveSubscription();
    emitState(currentState);
  };

  onEvent({ type: 'open' });
  await ensureCurrentStateIsLive();
  emitState(currentState);
  syncLiveSubscription();

  appUnsubscribe = subscribeAppEvents((event) => {
    if (
      !shouldRefreshDesktopConversationStateForAppEvent(conversationId, event as { type?: string; topics?: unknown; sessionId?: unknown })
    ) {
      return;
    }

    void refreshState().catch((error) => {
      if (closed) {
        return;
      }

      onEvent({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    });
  });

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    closeLiveSubscription();
    appUnsubscribe?.();
    appUnsubscribe = null;
    onEvent({ type: 'close' });
  };
}

export async function subscribeDesktopLocalApiStream(
  path: string,
  onEvent: (event: DesktopLocalApiStreamEvent) => void,
): Promise<() => void> {
  await getLocalRoutes();
  const url = new URL(path, 'http://desktop.local');
  return subscribeDesktopLocalApiStreamByUrl(url, onEvent);
}

export async function dispatchDesktopLocalApiRequest(input: {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<DesktopLocalApiDispatchResult> {
  const routes = await getLocalRoutes();
  const url = new URL(input.path, 'http://desktop.local');
  const route = findMatchingRoute(routes, input.method, url.pathname);

  if (!route) {
    throw new Error(`No local API route for ${input.method} ${url.pathname}`);
  }

  const match = route.pattern.exec(url.pathname);
  const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeURIComponent(match?.[index + 1] ?? '')]));
  const req = createLocalApiRequest({
    method: input.method,
    url,
    params,
    body: input.body,
    headers: input.headers,
  });
  const res = new LocalApiResponse();

  await route.handler(req, res);

  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ended) {
    if (contentType.toLowerCase().includes('text/event-stream')) {
      throw new Error(`Local API stream requires subscribeDesktopLocalApiStream for ${input.method} ${url.pathname}`);
    }

    throw new Error(`Local API route did not complete for ${input.method} ${url.pathname}`);
  }

  return {
    statusCode: res.statusCode,
    headers: Object.fromEntries(res.headers.entries()),
    body: res.getBody(),
  };
}

export async function invokeDesktopLocalApi<T = unknown>(input: {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<T> {
  const response = await dispatchDesktopLocalApiRequest(input);

  if (response.statusCode >= 400) {
    throw new Error(readLocalApiError(response));
  }

  const contentType = response.headers['content-type'] ?? '';
  const bodyText = decodeBody(response.body);
  if (contentType.toLowerCase().includes('application/json')) {
    return (bodyText.length > 0 ? JSON.parse(bodyText) : null) as T;
  }

  return bodyText as T;
}

export async function readDesktopAppStatus() {
  const context = await getLocalServerRouteContext();
  return {
    profile: 'shared',
    repoRoot: context.getRepoRoot(),
    appRevision: process.env.PERSONAL_AGENT_APP_REVISION,
  };
}

export async function readDesktopDaemonState() {
  return readDaemonState();
}

export async function readDesktopSessions() {
  await getLocalRoutes();
  return readConversationSessionsCapability();
}

export async function readDesktopSessionMeta(sessionId: string) {
  await getLocalRoutes();

  const session = readConversationSessionMetaCapability(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  return session;
}

export async function readDesktopSessionSearchIndex(sessionIds: string[]) {
  await getLocalRoutes();
  return readConversationSessionSearchIndexCapability({ sessionIds });
}

export async function readDesktopModels() {
  return readModelState(DEFAULT_RUNTIME_SETTINGS_FILE);
}

export async function updateDesktopModelPreferences(input: {
  model?: string | null;
  visionModel?: string | null;
  thinkingLevel?: string | null;
  serviceTier?: string | null;
}) {
  if (
    typeof input.model !== 'string' &&
    typeof input.visionModel !== 'string' &&
    typeof input.thinkingLevel !== 'string' &&
    typeof input.serviceTier !== 'string'
  ) {
    throw new Error('model, visionModel, thinkingLevel, or serviceTier required');
  }

  const models = readModelState(DEFAULT_RUNTIME_SETTINGS_FILE).models;
  persistSettingsWrite(
    (settingsFile) => {
      writeSavedModelPreferences(
        {
          model: input.model,
          visionModel: input.visionModel,
          thinkingLevel: input.thinkingLevel,
          serviceTier: input.serviceTier,
        },
        settingsFile,
        models,
      );
    },
    {
      runtimeSettingsFile: DEFAULT_RUNTIME_SETTINGS_FILE,
    },
  );
  return { ok: true as const };
}

export async function readDesktopDefaultCwd() {
  return readSavedDefaultCwdPreferences(DEFAULT_RUNTIME_SETTINGS_FILE, process.cwd());
}

export async function updateDesktopDefaultCwd(cwd: string | null) {
  const state = persistSettingsWrite(
    (settingsFile) => writeSavedDefaultCwdPreference({ cwd }, settingsFile, { baseDir: process.cwd(), validate: true }),
    {
      runtimeSettingsFile: DEFAULT_RUNTIME_SETTINGS_FILE,
    },
  );
  return state;
}

export async function readDesktopVaultFiles() {
  return readVaultFilesCapability();
}

export async function readDesktopKnowledgeBase() {
  return readKnowledgeBaseState();
}

export async function updateDesktopKnowledgeBase(input: { repoUrl?: string | null; branch?: string | null }) {
  const state = updateKnowledgeBase(input);
  const context = await getLocalServerRouteContext();
  context.materializeWebProfile(context.getCurrentProfile());
  invalidateAppTopics('knowledgeBase');
  return state;
}

export async function syncDesktopKnowledgeBase() {
  const state = syncKnowledgeBaseNow();
  invalidateAppTopics('knowledgeBase');
  return state;
}

export async function pickDesktopFolder(input: { cwd?: string | null; prompt?: string | null } = {}) {
  const context = await getLocalServerRouteContext();
  return pickFolderCapability(input, {
    getDefaultWebCwd: context.getDefaultWebCwd,
    resolveRequestedCwd: context.resolveRequestedCwd,
  });
}

export async function readDesktopConversationPlansWorkspace() {
  return readConversationPlansWorkspace(DEFAULT_RUNTIME_SETTINGS_FILE);
}

export async function readDesktopOpenConversationTabs() {
  const context = await getLocalServerRouteContext();
  const saved = readSavedUiPreferences(context.getSettingsFile());
  return {
    sessionIds: saved.openConversationIds,
    pinnedSessionIds: saved.pinnedConversationIds,
    archivedSessionIds: saved.archivedConversationIds,
    workspacePaths: saved.workspacePaths,
  };
}

export async function updateDesktopOpenConversationTabs(input: {
  sessionIds?: string[];
  pinnedSessionIds?: string[];
  archivedSessionIds?: string[];
  workspacePaths?: string[];
}) {
  const { sessionIds, pinnedSessionIds, archivedSessionIds, workspacePaths } = input;

  if (sessionIds !== undefined && !Array.isArray(sessionIds)) {
    throw new Error('sessionIds must be an array when provided');
  }

  if (pinnedSessionIds !== undefined && !Array.isArray(pinnedSessionIds)) {
    throw new Error('pinnedSessionIds must be an array when provided');
  }

  if (archivedSessionIds !== undefined && !Array.isArray(archivedSessionIds)) {
    throw new Error('archivedSessionIds must be an array when provided');
  }

  if (workspacePaths !== undefined && !Array.isArray(workspacePaths)) {
    throw new Error('workspacePaths must be an array when provided');
  }

  if (sessionIds === undefined && pinnedSessionIds === undefined && archivedSessionIds === undefined && workspacePaths === undefined) {
    throw new Error('sessionIds, pinnedSessionIds, archivedSessionIds, or workspacePaths required');
  }

  const context = await getLocalServerRouteContext();
  const saved = persistSettingsWrite(
    (settingsFile) =>
      writeSavedUiPreferences(
        {
          openConversationIds: sessionIds,
          pinnedConversationIds: pinnedSessionIds,
          archivedConversationIds: archivedSessionIds,
          workspacePaths,
        },
        settingsFile,
      ),
    { runtimeSettingsFile: context.getSettingsFile() },
  );

  if (sessionIds !== undefined || pinnedSessionIds !== undefined || archivedSessionIds !== undefined) {
    invalidateAppTopics('sessions');
  }
  if (workspacePaths !== undefined) {
    invalidateAppTopics('workspace');
  }
  return {
    ok: true as const,
    sessionIds: saved.openConversationIds,
    pinnedSessionIds: saved.pinnedConversationIds,
    archivedSessionIds: saved.archivedConversationIds,
    workspacePaths: saved.workspacePaths,
  };
}

export async function readDesktopModelProviders() {
  return readModelProvidersCapability(await getLocalProviderDesktopCapabilityContext());
}

export async function readDesktopProviderAuth() {
  return readProviderAuthCapability(await getLocalProviderDesktopCapabilityContext());
}

export async function saveDesktopModelProvider(input: {
  provider: string;
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  modelOverrides?: Record<string, unknown>;
}) {
  return saveModelProviderCapability(await getLocalProviderDesktopCapabilityContext(), input);
}

export async function deleteDesktopModelProvider(provider: string) {
  return deleteModelProviderCapability(await getLocalProviderDesktopCapabilityContext(), provider);
}

export async function saveDesktopModelProviderModel(input: {
  provider: string;
  modelId: string;
  name?: string;
  api?: string;
  baseUrl?: string;
  reasoning?: boolean;
  input?: Array<'text' | 'image'>;
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  compat?: Record<string, unknown>;
}) {
  return saveModelProviderModelCapability(await getLocalProviderDesktopCapabilityContext(), input);
}

export async function deleteDesktopModelProviderModel(input: { provider: string; modelId: string }) {
  return deleteModelProviderModelCapability(await getLocalProviderDesktopCapabilityContext(), input.provider, input.modelId);
}

export async function setDesktopProviderApiKey(input: { provider: string; apiKey: string }) {
  return setProviderApiKeyCapability(await getLocalProviderDesktopCapabilityContext(), input.provider, input.apiKey);
}

export async function removeDesktopProviderCredential(provider: string) {
  return removeProviderCredentialCapability(await getLocalProviderDesktopCapabilityContext(), provider);
}

export async function startDesktopProviderOAuthLogin(provider: string) {
  return startProviderOAuthLoginCapability(await getLocalProviderDesktopCapabilityContext(), provider);
}

export async function readDesktopProviderOAuthLogin(loginId: string) {
  return readProviderOAuthLoginCapability(loginId);
}

export async function submitDesktopProviderOAuthLoginInput(input: { loginId: string; value: string }) {
  return submitProviderOAuthLoginInputCapability(input.loginId, input.value);
}

export async function cancelDesktopProviderOAuthLogin(loginId: string) {
  return cancelProviderOAuthLoginCapability(loginId);
}

export async function subscribeDesktopProviderOAuthLogin(loginId: string, onState: (state: unknown) => void): Promise<() => void> {
  await getLocalRoutes();
  const normalizedLoginId = loginId.trim();
  if (!normalizedLoginId) {
    throw new Error('loginId required');
  }

  let closed = false;
  let unsubscribe = () => {};
  const handleState = (state: unknown) => {
    if (closed) {
      return;
    }

    onState(state);
    if (state && typeof state === 'object' && 'status' in state) {
      const status = typeof state.status === 'string' ? state.status : '';
      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        closed = true;
        unsubscribe();
      }
    }
  };

  unsubscribe = subscribeProviderOAuthLogin(normalizedLoginId, handleState);
  const current = getProviderOAuthLoginState(normalizedLoginId);
  if (current) {
    handleState(current);
  }

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    unsubscribe();
  };
}

export async function readDesktopScheduledTasks() {
  await getLocalRoutes();
  return listScheduledTasksCapability(localLiveSessionCapabilityContext?.getCurrentProfile() ?? 'assistant');
}

export async function readDesktopScheduledTaskDetail(taskId: string) {
  await getLocalRoutes();
  return readScheduledTaskCapability(localLiveSessionCapabilityContext?.getCurrentProfile() ?? 'assistant', taskId);
}

export async function readDesktopScheduledTaskSchedulerHealth() {
  await getLocalRoutes();
  return readScheduledTaskSchedulerHealth(localLiveSessionCapabilityContext?.getCurrentProfile() ?? 'assistant');
}

export async function readDesktopScheduledTaskLog(taskId: string) {
  await getLocalRoutes();
  return readScheduledTaskLogCapability(localLiveSessionCapabilityContext?.getCurrentProfile() ?? 'assistant', taskId);
}

export async function createDesktopScheduledTask(input: {
  title?: string;
  enabled?: boolean;
  cron?: string | null;
  at?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  cwd?: string | null;
  timeoutSeconds?: number | null;
  catchUpWindowSeconds?: number | null;
  prompt?: string;
  targetType?: 'background-agent' | 'conversation' | null;
  conversationBehavior?: 'steer' | 'followUp' | null;
  callbackConversationId?: string | null;
  deliverOnSuccess?: boolean | null;
  deliverOnFailure?: boolean | null;
  notifyOnSuccess?: 'none' | 'passive' | 'disruptive' | null;
  notifyOnFailure?: 'none' | 'passive' | 'disruptive' | null;
  requireAck?: boolean | null;
  autoResumeIfOpen?: boolean | null;
  threadMode?: 'dedicated' | 'existing' | 'none' | null;
  threadConversationId?: string | null;
}) {
  await getLocalRoutes();
  return createScheduledTaskCapability(localLiveSessionCapabilityContext?.getCurrentProfile() ?? 'assistant', {
    ...input,
    title: input.title ?? '',
    prompt: input.prompt ?? '',
  });
}

export async function updateDesktopScheduledTask(input: {
  taskId: string;
  title?: string;
  enabled?: boolean;
  cron?: string | null;
  at?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  cwd?: string | null;
  timeoutSeconds?: number | null;
  catchUpWindowSeconds?: number | null;
  prompt?: string;
  targetType?: 'background-agent' | 'conversation' | null;
  conversationBehavior?: 'steer' | 'followUp' | null;
  callbackConversationId?: string | null;
  deliverOnSuccess?: boolean | null;
  deliverOnFailure?: boolean | null;
  notifyOnSuccess?: 'none' | 'passive' | 'disruptive' | null;
  notifyOnFailure?: 'none' | 'passive' | 'disruptive' | null;
  requireAck?: boolean | null;
  autoResumeIfOpen?: boolean | null;
  threadMode?: 'dedicated' | 'existing' | 'none' | null;
  threadConversationId?: string | null;
}) {
  await getLocalRoutes();
  return updateScheduledTaskCapability(localLiveSessionCapabilityContext?.getCurrentProfile() ?? 'assistant', input);
}

export async function runDesktopScheduledTask(taskId: string) {
  await getLocalRoutes();
  return runScheduledTaskCapability(localLiveSessionCapabilityContext?.getCurrentProfile() ?? 'assistant', taskId);
}

export async function deleteDesktopScheduledTask(taskId: string) {
  await getLocalRoutes();
  return deleteScheduledTaskCapability(localLiveSessionCapabilityContext?.getCurrentProfile() ?? 'assistant', taskId);
}

export async function markDesktopConversationAttention(input: { conversationId: string; read?: boolean }) {
  const context = await getLocalServerRouteContext();
  const updated = toggleConversationAttention({
    profile: context.getCurrentProfile(),
    conversationId: input.conversationId,
    read: input.read !== false,
  });
  if (!updated) {
    throw new Error('Conversation not found');
  }

  invalidateAppTopics('sessions');
  return { ok: true as const };
}

export async function readDesktopDurableRuns() {
  return listDurableRunsCapability();
}

export async function readDesktopDurableRun(runId: string) {
  return readDurableRunCapability(runId);
}

export async function readDesktopDurableRunLog(input: { runId: string; tail?: number }) {
  return readDurableRunLogCapability(input);
}

export async function cancelDesktopDurableRun(runId: string) {
  return cancelDurableRunCapability(runId);
}

export async function markDesktopDurableRunAttention(input: { runId: string; read?: boolean }) {
  return markDurableRunAttentionCapability(input);
}

export async function readDesktopConversationBootstrap(input: {
  conversationId: string;
  tailBlocks?: number;
  knownSessionSignature?: string;
  knownBlockOffset?: number;
  knownTotalBlocks?: number;
  knownLastBlockId?: string;
}) {
  const context = await getLocalLiveSessionCapabilityContext();
  const bootstrap = await readConversationBootstrapState({
    ...input,
    profile: context.getCurrentProfile(),
  });
  if (isMissingConversationBootstrapState(bootstrap.state)) {
    throw new Error('Conversation not found');
  }

  return inlineConversationBootstrapAssetsCapability(bootstrap.state);
}

export async function renameDesktopConversation(input: {
  conversationId: string;
  name: string;
  surfaceId?: string;
}): Promise<{ ok: true; title: string }> {
  await getLocalRoutes();

  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new Error('conversationId required');
  }

  const nextName = input.name.trim();
  if (!nextName) {
    throw new Error('name required');
  }

  if (isLiveSession(conversationId)) {
    renameSession(conversationId, nextName);
    return { ok: true, title: nextName };
  }

  const renamed = renameStoredSession(conversationId, nextName);
  publishConversationSessionMetaChanged(conversationId);
  return { ok: true, title: renamed.title };
}

export async function changeDesktopConversationCwd(input: { conversationId: string; cwd: string; surfaceId?: string }) {
  await getLocalRoutes();

  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new Error('conversationId required');
  }

  const liveEntry = liveRegistry.get(conversationId);
  const sessionDetail = readSessionBlocks(conversationId);
  const currentCwd = liveEntry?.cwd ?? sessionDetail?.meta.cwd;
  const sourceSessionFile = liveEntry?.session.sessionFile ?? sessionDetail?.meta.file;

  if (!currentCwd || !sourceSessionFile) {
    throw new Error('Conversation not found.');
  }

  if (liveEntry?.session.isStreaming) {
    throw new Error('Stop the current response before changing the working directory.');
  }

  const nextCwd = resolveRequestedCwd(input.cwd, currentCwd);
  if (!nextCwd) {
    throw new Error('cwd required');
  }

  if (!existsSync(nextCwd)) {
    throw new Error(`Directory does not exist: ${nextCwd}`);
  }

  if (!statSync(nextCwd).isDirectory()) {
    throw new Error(`Not a directory: ${nextCwd}`);
  }

  if (nextCwd === currentCwd) {
    return { id: conversationId, sessionFile: sourceSessionFile, cwd: currentCwd, changed: false };
  }

  const context = await getLocalLiveSessionCapabilityContext();
  const result = await createSessionFromExisting(sourceSessionFile, nextCwd, {
    ...context.buildLiveSessionResourceOptions(context.getCurrentProfile()),
    extensionFactories: context.buildLiveSessionExtensionFactories(),
  });

  appendConversationWorkspaceMetadata({
    sessionFile: result.sessionFile,
    previousCwd: currentCwd,
    previousWorkspaceCwd:
      sessionDetail?.meta && Object.prototype.hasOwnProperty.call(sessionDetail.meta, 'workspaceCwd')
        ? (sessionDetail.meta.workspaceCwd ?? null)
        : currentCwd,
    cwd: nextCwd,
    workspaceCwd: nextCwd,
    visibleMessage: true,
  });

  if (liveEntry) {
    destroySession(conversationId);
  }

  publishConversationSessionMetaChanged(conversationId, result.id);
  return { id: result.id, sessionFile: result.sessionFile, cwd: nextCwd, changed: true };
}

export async function createDesktopConversationCheckpoint(input: { conversationId: string; message: string; paths: string[] }) {
  const context = await getLocalServerRouteContext();
  const conversationId = input.conversationId.trim();
  const session = readConversationSessionMetaCapability(conversationId);
  if (!session) {
    throw new Error('Conversation not found.');
  }
  const cwd = readRequiredCheckpointString(session.cwd, 'cwd');
  const message = readRequiredCheckpointString(input.message, 'message');
  const paths = normalizeCheckpointPaths(cwd, input.paths);
  const created = createConversationCheckpointCommit({ cwd, message, paths });
  const record = saveConversationCommitCheckpoint({
    profile: context.getCurrentProfile(),
    conversationId,
    checkpointId: created.metadata.commitSha,
    title: created.metadata.subject,
    cwd,
    commitSha: created.metadata.commitSha,
    shortSha: created.metadata.shortSha,
    subject: created.metadata.subject,
    body: created.metadata.body,
    authorName: created.metadata.authorName,
    authorEmail: created.metadata.authorEmail,
    committedAt: created.metadata.committedAt,
    files: created.files,
    linesAdded: created.linesAdded,
    linesDeleted: created.linesDeleted,
  });
  invalidateAppTopics('checkpoints', 'sessions');
  return record;
}

export async function readDesktopConversationArtifacts(conversationId: string) {
  const context = await getLocalServerRouteContext();
  return readConversationArtifactsCapability(context.getCurrentProfile(), conversationId);
}

export async function readDesktopConversationArtifact(input: { conversationId: string; artifactId: string }) {
  const context = await getLocalServerRouteContext();
  return readConversationArtifactCapability(context.getCurrentProfile(), input);
}

export async function readDesktopConversationCheckpoints(conversationId: string) {
  const context = await getLocalServerRouteContext();
  return readConversationCommitCheckpointsCapability(context.getCurrentProfile(), conversationId);
}

export async function readDesktopConversationCheckpoint(input: { conversationId: string; checkpointId: string }) {
  const context = await getLocalServerRouteContext();
  return readConversationCommitCheckpointCapability(context.getCurrentProfile(), input);
}

export async function readDesktopConversationAttachments(conversationId: string) {
  const context = await getLocalServerRouteContext();
  return readConversationAttachmentsCapability(context.getCurrentProfile(), conversationId);
}

export async function readDesktopConversationAttachment(input: { conversationId: string; attachmentId: string }) {
  const context = await getLocalServerRouteContext();
  return readConversationAttachmentCapability(context.getCurrentProfile(), input);
}

export async function createDesktopConversationAttachment(input: {
  conversationId: string;
  kind?: 'excalidraw';
  title?: string;
  sourceData?: string;
  sourceName?: string;
  sourceMimeType?: string;
  previewData?: string;
  previewName?: string;
  previewMimeType?: string;
  note?: string;
}) {
  const context = await getLocalServerRouteContext();
  return createConversationAttachmentCapability(context.getCurrentProfile(), input);
}

export async function updateDesktopConversationAttachment(input: {
  conversationId: string;
  attachmentId: string;
  title?: string;
  sourceData?: string;
  sourceName?: string;
  sourceMimeType?: string;
  previewData?: string;
  previewName?: string;
  previewMimeType?: string;
  note?: string;
}) {
  const context = await getLocalServerRouteContext();
  return updateConversationAttachmentCapability(context.getCurrentProfile(), input);
}

export async function readDesktopConversationAttachmentAsset(input: {
  conversationId: string;
  attachmentId: string;
  asset: 'source' | 'preview';
  revision?: number;
}) {
  const context = await getLocalServerRouteContext();
  const download = readConversationAttachmentDownloadCapability(context.getCurrentProfile(), input);
  const data = readFileSync(download.filePath).toString('base64');

  return {
    dataUrl: `data:${download.mimeType};base64,${data}`,
    mimeType: download.mimeType,
    fileName: download.fileName,
  };
}

export async function readDesktopConversationDeferredResumes(conversationId: string) {
  return readConversationDeferredResumesCapability(conversationId);
}

export async function scheduleDesktopConversationDeferredResume(input: {
  conversationId: string;
  delay?: string;
  prompt?: string;
  behavior?: 'steer' | 'followUp';
}) {
  return scheduleConversationDeferredResumeCapability(input);
}

export async function cancelDesktopConversationDeferredResume(input: { conversationId: string; resumeId: string }) {
  return cancelConversationDeferredResumeCapability(input);
}

export async function fireDesktopConversationDeferredResume(input: { conversationId: string; resumeId: string }) {
  const context = await getLocalLiveSessionCapabilityContext();
  return fireConversationDeferredResumeCapability({
    ...input,
    flushLiveDeferredResumes: context.flushLiveDeferredResumes,
  });
}

export async function recoverDesktopConversation(conversationId: string) {
  const context = await getLocalLiveSessionCapabilityContext();
  return recoverConversationCapability(conversationId, {
    getCurrentProfile: context.getCurrentProfile,
    buildLiveSessionResourceOptions: context.buildLiveSessionResourceOptions,
    buildLiveSessionExtensionFactories: context.buildLiveSessionExtensionFactories,
    flushLiveDeferredResumes: context.flushLiveDeferredResumes,
  });
}

export async function readDesktopConversationModelPreferences(conversationId: string) {
  await getLocalRoutes();

  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    throw new Error('Conversation not found');
  }

  const state = await readConversationModelPreferenceStateById(normalizedConversationId);
  if (!state) {
    throw new Error('Conversation not found');
  }

  return state;
}

export async function updateDesktopConversationModelPreferences(input: {
  conversationId: string;
  model?: string | null;
  thinkingLevel?: string | null;
  serviceTier?: string | null;
  surfaceId?: string;
}) {
  await getLocalRoutes();

  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new Error('conversationId required');
  }

  const { model, thinkingLevel, serviceTier } = input;
  if (model === undefined && thinkingLevel === undefined && serviceTier === undefined) {
    throw new Error('model, thinkingLevel, or serviceTier required');
  }

  if (
    (model !== undefined && model !== null && typeof model !== 'string') ||
    (thinkingLevel !== undefined && thinkingLevel !== null && typeof thinkingLevel !== 'string') ||
    (serviceTier !== undefined && serviceTier !== null && typeof serviceTier !== 'string')
  ) {
    throw new Error('model, thinkingLevel, and serviceTier must be strings or null');
  }

  const nextInput = {
    ...(model !== undefined ? { model } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
    ...(serviceTier !== undefined ? { serviceTier } : {}),
  };

  if (isLiveSession(conversationId)) {
    return updateLiveSessionModelPreferences(conversationId, nextInput, getAvailableModelObjects());
  }

  const sessionFile = resolveConversationSessionFile(conversationId);
  if (!sessionFile || !existsSync(sessionFile)) {
    throw new Error('Conversation not found');
  }

  const availableModels = getAvailableModelObjects();
  const sessionManager = SessionManager.open(sessionFile);
  const state = applyConversationModelPreferencesToSessionManager(
    sessionManager,
    nextInput,
    readSavedModelPreferences(DEFAULT_RUNTIME_SETTINGS_FILE, availableModels),
    availableModels,
  );

  publishConversationSessionMetaChanged(conversationId);
  return state;
}

export async function readDesktopLiveSession(conversationId: string) {
  await getLocalRoutes();

  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId || !isLiveSession(normalizedConversationId)) {
    throw new Error('404 Not Found');
  }

  const entry = getLocalLiveSessions().find((session) => session.id === normalizedConversationId);
  if (!entry) {
    throw new Error('404 Not Found');
  }

  return { live: true as const, ...entry };
}

export async function readDesktopLiveSessionForkEntries(conversationId: string): Promise<Array<{ entryId: string; text: string }>> {
  await getLocalRoutes();

  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    throw new Error('Session not live');
  }

  const entries = getLiveSessionForkEntries(normalizedConversationId);
  if (!entries) {
    throw new Error('Session not live');
  }

  return entries as Array<{ entryId: string; text: string }>;
}

export async function readDesktopLiveSessionContext(conversationId: string) {
  await getLocalRoutes();

  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    throw new Error('Session not found');
  }

  const liveEntry = liveRegistry.get(normalizedConversationId);
  const storedSession = !liveEntry ? readSessionMeta(normalizedConversationId) : null;
  const cwd = liveEntry?.cwd ?? storedSession?.cwd;
  if (!cwd) {
    throw new Error('Session not found');
  }

  const gitSummary = readGitStatusSummaryWithTelemetry(cwd).summary;
  return {
    cwd,
    branch: gitSummary?.branch ?? null,
    git: gitSummary
      ? {
          changeCount: gitSummary.changeCount,
          linesAdded: gitSummary.linesAdded,
          linesDeleted: gitSummary.linesDeleted,
          changes: gitSummary.changes.map((change) => ({
            relativePath: change.relativePath,
            change: change.change,
          })),
        }
      : null,
  };
}

export async function readDesktopSessionDetail(input: {
  sessionId: string;
  tailBlocks?: number;
  knownSessionSignature?: string;
  knownBlockOffset?: number;
  knownTotalBlocks?: number;
  knownLastBlockId?: string;
}) {
  const context = await getLocalLiveSessionCapabilityContext();
  const sessionId = input.sessionId.trim();
  const currentSessionSignature = readConversationSessionSignature(sessionId);
  if (input.knownSessionSignature && currentSessionSignature && input.knownSessionSignature === currentSessionSignature) {
    return {
      unchanged: true as const,
      sessionId,
      signature: currentSessionSignature,
    };
  }

  const { sessionRead } = await readSessionDetailForRoute({
    conversationId: sessionId,
    profile: context.getCurrentProfile(),
    tailBlocks: input.tailBlocks,
  });
  if (!sessionRead.detail) {
    throw new Error('Session not found');
  }

  const appendOnly =
    input.knownSessionSignature && sessionRead.detail.signature && input.knownSessionSignature !== sessionRead.detail.signature
      ? buildAppendOnlySessionDetailResponse({
          detail: sessionRead.detail,
          knownBlockOffset: input.knownBlockOffset,
          knownTotalBlocks: input.knownTotalBlocks,
          knownLastBlockId: input.knownLastBlockId,
        })
      : null;

  if (appendOnly) {
    return inlineConversationSessionDetailAppendOnlyAssetsCapability(sessionId, appendOnly);
  }

  return inlineConversationSessionDetailAssetsCapability(sessionId, sessionRead.detail);
}

export async function readDesktopSessionBlock(input: { sessionId: string; blockId: string }) {
  await getLocalRoutes();

  const result = readConversationSessionBlockWithInlineAssetsCapability(input.sessionId, input.blockId);
  if (!result) {
    throw new Error('Session block not found');
  }

  return result;
}

function resolveDesktopConversationSource(conversationId: string): {
  sessionFile: string;
  cwd: string;
  live: boolean;
} {
  const trimmedConversationId = conversationId.trim();
  if (!trimmedConversationId) {
    throw new Error('conversationId required');
  }

  const liveEntry = liveRegistry.get(trimmedConversationId);
  const liveSessionFile = liveEntry?.session.sessionFile?.trim();
  if (liveEntry && liveSessionFile) {
    return {
      sessionFile: liveSessionFile,
      cwd: liveEntry.cwd,
      live: true,
    };
  }

  const sessionFile = resolveConversationSessionFile(trimmedConversationId)?.trim();
  if (!sessionFile || !existsSync(sessionFile)) {
    throw new Error('Conversation not found');
  }

  const sessionManager = SessionManager.open(sessionFile);
  return {
    sessionFile,
    cwd: sessionManager.getCwd(),
    live: false,
  };
}

function resolveRollbackLeafId(sessionFile: string, numTurns: number): string | null {
  const sessionManager = SessionManager.open(sessionFile);
  const branch = sessionManager.getBranch();
  const userMessageEntries = branch.filter((entry) => entry.type === 'message' && entry.message.role === 'user');

  if (userMessageEntries.length === 0) {
    throw new Error('No user turns are available to roll back.');
  }

  if (numTurns >= userMessageEntries.length) {
    return null;
  }

  const firstRemovedTurn = userMessageEntries[userMessageEntries.length - numTurns];
  if (!firstRemovedTurn) {
    throw new Error('Could not resolve rollback target.');
  }

  return firstRemovedTurn.parentId ?? null;
}

function rewriteConversationSessionToLeaf(sessionFile: string, leafId: string | null): void {
  const sessionManager = SessionManager.open(sessionFile);
  const header = sessionManager.getHeader();
  if (!header) {
    throw new Error('Conversation session header is missing.');
  }

  if (leafId === null) {
    writeFileSync(sessionFile, `${JSON.stringify(header)}\n`, 'utf-8');
    return;
  }

  const branchedSessionFile = sessionManager.createBranchedSession(leafId);
  if (!branchedSessionFile || !existsSync(branchedSessionFile)) {
    throw new Error('Unable to create rollback snapshot.');
  }

  try {
    const lines = readFileSync(branchedSessionFile, 'utf-8')
      .split(/\r?\n/)
      .filter((line) => line.trim().length > 0);

    if (lines.length === 0) {
      throw new Error('Rollback snapshot was empty.');
    }

    lines[0] = JSON.stringify(header);
    writeFileSync(sessionFile, `${lines.join('\n')}\n`, 'utf-8');
  } finally {
    try {
      unlinkSync(branchedSessionFile);
    } catch {
      // Ignore temporary rollback snapshot cleanup failures.
    }
  }
}

export async function createDesktopLiveSession(input: {
  cwd?: string;
  workspaceCwd?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  serviceTier?: string | null;
}): Promise<{ id: string; sessionFile: string; bootstrap?: unknown }> {
  return createLiveSessionCapability(input, await getLocalLiveSessionCapabilityContext());
}

export async function resumeDesktopLiveSession(input: { sessionFile: string; cwd?: string }): Promise<{ id: string }> {
  return resumeLiveSessionCapability(input, await getLocalLiveSessionCapabilityContext());
}

export async function submitDesktopLiveSessionPrompt(input: {
  conversationId: string;
  text?: string;
  behavior?: 'steer' | 'followUp';
  images?: Array<{ data: string; mimeType: string; name?: string }>;
  attachmentRefs?: unknown;
  contextMessages?: Array<{ customType: string; content: string }>;
  relatedConversationIds?: unknown;
  surfaceId?: string;
}): Promise<{
  ok: true;
  accepted: true;
  delivery: 'started' | 'queued';
  referencedTaskIds: string[];
  referencedMemoryDocIds: string[];
  referencedVaultFileIds: string[];
  referencedAttachmentIds: string[];
}> {
  return submitLiveSessionPromptCapability(input, await getLocalLiveSessionCapabilityContext());
}

export async function submitDesktopLiveSessionParallelPrompt(input: {
  conversationId: string;
  text?: string;
  images?: Array<{ data: string; mimeType: string; name?: string }>;
  attachmentRefs?: unknown;
  contextMessages?: Array<{ customType: string; content: string }>;
  relatedConversationIds?: unknown;
  surfaceId?: string;
}): Promise<{
  ok: true;
  accepted: true;
  jobId: string;
  childConversationId: string;
  referencedTaskIds: string[];
  referencedMemoryDocIds: string[];
  referencedVaultFileIds: string[];
  referencedAttachmentIds: string[];
}> {
  return submitLiveSessionParallelPromptCapability(input, await getLocalLiveSessionCapabilityContext());
}

export async function manageDesktopLiveSessionParallelJob(input: {
  conversationId: string;
  jobId: string;
  action: 'importNow' | 'skip' | 'cancel';
  surfaceId?: string;
}): Promise<{
  ok: true;
  status: 'imported' | 'queued' | 'skipped' | 'cancelled';
}> {
  return manageLiveSessionParallelJobCapability(input);
}

export async function takeOverDesktopLiveSession(input: { conversationId: string; surfaceId: string }) {
  return takeOverLiveSessionCapability(input);
}

export async function restoreDesktopQueuedLiveSessionMessage(input: {
  conversationId: string;
  behavior: 'steer' | 'followUp';
  index: number;
  previewId?: string;
}) {
  return restoreQueuedLiveSessionMessageCapability(input);
}

export async function compactDesktopLiveSession(input: { conversationId: string; customInstructions?: string }) {
  return compactLiveSessionCapability(input);
}

export async function exportDesktopLiveSession(input: {
  conversationId: string;
  outputPath?: string;
}): Promise<{ ok: true; path: string }> {
  await getLocalRoutes();

  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new Error('conversationId required');
  }

  const path = await exportSessionHtml(conversationId, input.outputPath?.trim() || undefined);
  return { ok: true, path };
}

export async function reloadDesktopLiveSession(input: { conversationId: string }) {
  return reloadLiveSessionCapability(input);
}

export async function destroyDesktopLiveSession(conversationId: string): Promise<{ ok: true }> {
  return destroyLiveSessionCapability({ conversationId });
}

export async function branchDesktopLiveSession(input: { conversationId: string; entryId: string }) {
  return branchLiveSessionCapability(input, await getLocalLiveSessionCapabilityContext());
}

export async function forkDesktopLiveSession(input: {
  conversationId: string;
  entryId: string;
  preserveSource?: boolean;
  beforeEntry?: boolean;
}) {
  return forkLiveSessionCapability(input, await getLocalLiveSessionCapabilityContext());
}

export async function summarizeAndForkDesktopLiveSession(input: { conversationId: string }) {
  return summarizeAndForkLiveSessionCapability(input, await getLocalLiveSessionCapabilityContext());
}

export async function forkDesktopConversation(input: {
  conversationId: string;
  cwd?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  serviceTier?: string | null;
}): Promise<{ id: string; sessionFile: string }> {
  const source = resolveDesktopConversationSource(input.conversationId);
  return createSessionFromExisting(source.sessionFile, input.cwd?.trim() || source.cwd, {
    ...(input.model !== undefined ? { initialModel: input.model } : {}),
    ...(input.thinkingLevel !== undefined ? { initialThinkingLevel: input.thinkingLevel } : {}),
    ...(input.serviceTier !== undefined ? { initialServiceTier: input.serviceTier } : {}),
  });
}

export async function rollbackDesktopConversation(input: {
  conversationId: string;
  numTurns: number;
}): Promise<{ id: string; sessionFile: string }> {
  if (!Number.isSafeInteger(input.numTurns) || input.numTurns <= 0 || input.numTurns > MAX_DESKTOP_ROLLBACK_TURNS) {
    throw new Error('numTurns must be a positive integer.');
  }

  const conversationId = input.conversationId.trim();
  const source = resolveDesktopConversationSource(conversationId);
  if (source.live) {
    const liveEntry = liveRegistry.get(conversationId);
    if (liveEntry?.session.isStreaming) {
      throw new Error('Cannot roll back a running conversation. Interrupt it first.');
    }
    destroySession(conversationId);
  }

  const leafId = resolveRollbackLeafId(source.sessionFile, input.numTurns);
  rewriteConversationSessionToLeaf(source.sessionFile, leafId);

  if (source.live) {
    await resumeLiveSessionCapability({ sessionFile: source.sessionFile, cwd: source.cwd }, await getLocalLiveSessionCapabilityContext());
  } else {
    publishConversationSessionMetaChanged(conversationId);
  }

  return {
    id: conversationId,
    sessionFile: source.sessionFile,
  };
}

export async function abortDesktopLiveSession(conversationId: string): Promise<{ ok: true }> {
  return abortLiveSessionCapability({ conversationId });
}
