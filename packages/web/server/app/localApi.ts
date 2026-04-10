import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDefaultVaultRoot,
  getPiAgentRuntimeDir,
  getStateRoot,
  getVaultRoot,
  readMachineConfig,
  updateMachineConfig,
} from '@personal-agent/core';
import { readDaemonState } from '../automation/daemon.js';
import { loadScheduledTasksForProfile } from '../automation/scheduledTasks.js';
import { getDurableRunSnapshot } from '../automation/durableRuns.js';
import {
  activityCountCapability,
  clearInboxCapability,
  listActivityCapability,
  markActivityReadCapability,
  markConversationAttentionCapability,
  readActivityCapability,
  readSavedWebUiPreferencesCapability,
  startActivityConversationCapability,
} from '../automation/inboxCapability.js';
import {
  acknowledgeAlertCapability,
  dismissAlertCapability,
  readAlertSnapshotCapability,
  snoozeAlertCapability,
} from '../automation/alertCapability.js';
import {
  createScheduledTaskCapability,
  listScheduledTasksCapability,
  readScheduledTaskCapability,
  readScheduledTaskLogCapability,
  runScheduledTaskCapability,
  updateScheduledTaskCapability,
} from '../automation/scheduledTaskCapability.js';
import {
  cancelDurableRunCapability,
  listDurableRunsCapability,
  markDurableRunAttentionCapability,
  readDurableRunCapability,
  readDurableRunLogCapability,
} from '../automation/durableRunCapability.js';
import {
  exportSessionHtml,
  getLiveSessionForkEntries,
  getLiveSessions as getLocalLiveSessions,
  getSessionContextUsage,
  getSessionStats,
  isLive as isLiveSession,
  registry as liveRegistry,
  renameSession,
  subscribe as subscribeLiveSession,
} from '../conversations/liveSessions.js';
import {
  isMissingConversationBootstrapState,
  readConversationBootstrapState,
} from '../conversations/conversationBootstrap.js';
import {
  readConversationSessionMetaCapability,
  readConversationSessionSearchIndexCapability,
  readConversationSessionsCapability,
} from '../conversations/conversationSessionCapability.js';
import {
  inlineConversationBootstrapAssetsCapability,
  inlineConversationSessionDetailAssetsCapability,
  inlineConversationSessionDetailAppendOnlyAssetsCapability,
  inlineConversationSessionSnapshotAssetsCapability,
  readConversationSessionBlockWithInlineAssetsCapability,
} from '../conversations/conversationSessionAssetCapability.js';
import { SessionManager } from '@mariozechner/pi-coding-agent';
import {
  publishConversationSessionMetaChanged,
  readConversationModelPreferenceStateById,
  readConversationSessionSignature,
  readSessionDetailForRoute,
  resolveConversationSessionFile,
} from '../conversations/conversationService.js';
import { resolveRequestedCwd } from '../conversations/conversationCwd.js';
import {
  buildAppendOnlySessionDetailResponse,
  readSessionBlocks,
  readSessionMeta,
  renameStoredSession,
  type DisplayBlock,
} from '../conversations/sessions.js';
import { readGitStatusSummaryWithTelemetry } from '../workspace/gitStatus.js';
import { listMemoryDocs, listSkillsForProfile } from '../knowledge/memoryDocs.js';
import { runShellCommandCapability } from '../workspace/shellRunCapability.js';
import { readVaultFilesCapability, pickFolderCapability } from '../workspace/workspaceDesktopCapability.js';
import type { ServerRouteContext } from '../routes/context.js';
import {
  getProviderOAuthLoginState,
  subscribeProviderOAuthLogin,
} from '../models/providerAuth.js';
import {
  cancelProviderOAuthLoginCapability,
  deleteModelProviderCapability,
  deleteModelProviderModelCapability,
  readCodexPlanUsageCapability,
  readModelProvidersCapability,
  readProviderAuthCapability,
  readProviderOAuthLoginCapability,
  removeProviderCredentialCapability,
  saveModelProviderCapability,
  saveModelProviderModelCapability,
  setProviderApiKeyCapability,
  startProviderOAuthLoginCapability,
  submitProviderOAuthLoginInputCapability,
  type ProviderDesktopCapabilityContext,
} from '../models/providerDesktopCapability.js';
import { readModelState } from '../models/modelState.js';
import { registerServerRoutes } from '../routes/registerAll.js';
import { buildSnapshotEventsForTopic, INITIAL_APP_EVENT_TOPICS } from '../routes/system.js';
import { invalidateAppTopics, subscribeAppEvents } from '../shared/appEvents.js';
import {
  getProfileConfigFilePath,
} from '../ui/profilePreferences.js';
import {
  readSavedConversationTitlePreferences,
  writeSavedConversationTitlePreferences,
} from '../ui/conversationTitlePreferences.js';
import {
  readConversationPlanDefaults,
  readConversationPlanLibrary,
  readConversationPlansWorkspace,
  writeConversationPlanDefaults,
  writeConversationPlanLibrary,
} from '../ui/conversationPlanPreferences.js';
import {
  readSavedDefaultCwdPreferences,
  writeSavedDefaultCwdPreference,
} from '../ui/defaultCwdPreferences.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE, persistSettingsWrite } from '../ui/settingsPersistence.js';
import { readSavedWebUiPreferences, writeSavedWebUiPreferences } from '../ui/webUiPreferences.js';
import { readWebUiState, syncConfiguredWebUiTailscaleServe, writeWebUiConfig } from '../ui/webUi.js';
import { readSavedModelPreferences, writeSavedModelPreferences } from '../models/modelPreferences.js';
import {
  abortLiveSessionCapability,
  branchLiveSessionCapability,
  compactLiveSessionCapability,
  createLiveSessionCapability,
  destroyLiveSessionCapability,
  forkLiveSessionCapability,
  reloadLiveSessionCapability,
  restoreQueuedLiveSessionMessageCapability,
  resumeLiveSessionCapability,
  submitLiveSessionPromptCapability,
  summarizeAndForkLiveSessionCapability,
  takeOverLiveSessionCapability,
  type LiveSessionCapabilityContext,
} from '../conversations/liveSessionCapability.js';
import {
  createSessionFromExisting,
  destroySession,
  getAvailableModelObjects,
  updateLiveSessionModelPreferences,
} from '../conversations/liveSessions.js';
import {
  applyConversationModelPreferencesToSessionManager,
} from '../conversations/conversationModelPreferences.js';
import { recoverConversationCapability } from '../conversations/conversationRecovery.js';
import {
  cancelConversationDeferredResumeCapability,
  fireConversationDeferredResumeCapability,
  readConversationDeferredResumesCapability,
  scheduleConversationDeferredResumeCapability,
} from '../conversations/conversationDeferredResumeCapability.js';
import {
  createConversationAttachmentCapability,
  deleteConversationArtifactCapability,
  deleteConversationAttachmentCapability,
  readConversationArtifactCapability,
  readConversationArtifactsCapability,
  readConversationAttachmentCapability,
  readConversationAttachmentDownloadCapability,
  readConversationAttachmentsCapability,
  updateConversationAttachmentCapability,
} from '../conversations/conversationAssetsCapability.js';
import {
  createRemoteAccessPairingCode,
  readRemoteAccessAdminState,
  revokeRemoteAccessSession,
} from '../ui/remoteAccessAuth.js';
import { createProfileState } from './profileState.js';
import { createServerRouteContext } from './routeContext.js';

type RouteHandler = (req: LocalApiRequest, res: LocalApiResponse) => unknown;

interface RegisteredRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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

type DesktopLocalApiStreamEvent =
  | { type: 'open' }
  | { type: 'message'; data: string }
  | { type: 'error'; message: string }
  | { type: 'close' };

type DesktopAppBridgeEvent =
  | { type: 'open' }
  | { type: 'event'; event: unknown }
  | { type: 'error'; message: string }
  | { type: 'close' };

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
let localInboxCapabilityContext: {
  getCurrentProfile: () => string;
  getRepoRoot: () => string;
  getDefaultWebCwd: () => string;
  buildLiveSessionResourceOptions: LiveSessionCapabilityContext['buildLiveSessionResourceOptions'];
  buildLiveSessionExtensionFactories: LiveSessionCapabilityContext['buildLiveSessionExtensionFactories'];
  getSavedWebUiPreferences: () => ReturnType<typeof readSavedWebUiPreferences>;
} | null = null;

function resolveRepoRoot(): string {
  const defaultRepoRoot = fileURLToPath(new URL('../../..', import.meta.url));
  return process.env.PERSONAL_AGENT_REPO_ROOT ?? defaultRepoRoot;
}

function buildRoutePattern(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const escaped = path
    .split('/')
    .map((segment) => {
      if (!segment) {
        return '';
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

    query[key] = Array.isArray(existing)
      ? [...existing, value]
      : [existing, value];
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
  const normalizedHeaders = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
  );
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

function createRouteCollector(routes: RegisteredRoute[]): Pick<{ get: unknown; post: unknown; patch: unknown; delete: unknown; use: unknown }, 'get' | 'post' | 'patch' | 'delete' | 'use'> {
  const register = (method: RegisteredRoute['method']) => (path: string, ...handlers: RouteHandler[]) => {
    const handler = handlers[handlers.length - 1];
    if (!handler) {
      return;
    }

    const { pattern, keys } = buildRoutePattern(path);
    routes.push({ method, path, pattern, keys, handler });
  };

  return {
    get: register('GET'),
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
  const profileConfigFile = getProfileConfigFilePath();
  const settingsFile = DEFAULT_RUNTIME_SETTINGS_FILE;

  const profileState = createProfileState({
    repoRoot,
    agentDir,
    profileConfigFile,
    logger: {
      warn: () => {
        // Ignore local desktop route-context warnings here.
      },
    },
  });

  const context = createServerRouteContext({
    repoRoot,
    settingsFile,
    authFile,
    getCurrentProfile: profileState.getCurrentProfile,
    setCurrentProfile: profileState.setCurrentProfile,
    listAvailableProfiles: profileState.listAvailableProfiles,
    getCurrentProfileSettingsFile: profileState.getCurrentProfileSettingsFile,
    materializeWebProfile: profileState.materializeWebProfile,
    getStateRoot,
    serverPort: 0,
    getDefaultWebCwd: () => process.cwd(),
    resolveRequestedCwd,
    buildLiveSessionResourceOptions: profileState.buildLiveSessionResourceOptions,
    buildLiveSessionExtensionFactories: profileState.buildLiveSessionExtensionFactories,
    flushLiveDeferredResumes: async () => {},
    getSavedWebUiPreferences: () => readSavedWebUiPreferences(settingsFile),
    listActivityForCurrentProfile: () => listActivityCapability(profileState.getCurrentProfile()),
    listTasksForCurrentProfile: () => {
      const loaded = loadScheduledTasksForProfile(profileState.getCurrentProfile());
      const runtimeById = new Map(
        loaded.runtimeEntries.flatMap((task) => task.id ? [[task.id, task] as const] : []),
      );

      return loaded.tasks.map((task) => {
        const runtime = loaded.runtimeState[task.id] ?? runtimeById.get(task.id);
        return {
          id: task.id,
          title: task.title,
          filePath: task.legacyFilePath,
          scheduleType: task.schedule.type,
          running: runtime?.running ?? false,
          enabled: task.enabled,
          cron: task.schedule.type === 'cron' ? task.schedule.expression : undefined,
          at: task.schedule.type === 'at' ? task.schedule.at : undefined,
          prompt: task.prompt.split('\n')[0]?.slice(0, 120) ?? '',
          model: task.modelRef,
          cwd: task.cwd,
          lastStatus: runtime?.lastStatus,
          lastRunAt: runtime?.lastRunAt,
          lastSuccessAt: runtime?.lastSuccessAt,
          lastAttemptCount: runtime?.lastAttemptCount,
        };
      });
    },
    listMemoryDocs: () => listMemoryDocs().map((doc) => ({
      id: doc.id,
      title: doc.title,
      summary: doc.summary,
      description: doc.description,
      path: doc.path,
      updated: doc.updated,
    })),
    listSkillsForCurrentProfile: () => listSkillsForProfile(profileState.getCurrentProfile()).map((skill) => ({
      name: skill.name,
      source: skill.source,
      description: skill.description,
      path: skill.path,
    })),
    listProfileAgentItems: () => [],
    withTemporaryProfileAgentDir: profileState.withTemporaryProfileAgentDir,
    getDurableRunSnapshot: async (runId: string, tail: number) => (await getDurableRunSnapshot(runId, tail)) ?? null,
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

  localInboxCapabilityContext = {
    getCurrentProfile: context.getCurrentProfile,
    getRepoRoot: context.getRepoRoot,
    getDefaultWebCwd: context.getDefaultWebCwd,
    buildLiveSessionResourceOptions: context.buildLiveSessionResourceOptions,
    buildLiveSessionExtensionFactories: context.buildLiveSessionExtensionFactories,
    getSavedWebUiPreferences: context.getSavedWebUiPreferences,
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

async function getLocalInboxCapabilityContext() {
  await getLocalRoutes();
  if (!localInboxCapabilityContext) {
    throw new Error('Local inbox capability context is not initialized.');
  }

  return localInboxCapabilityContext;
}

function expandHomePath(value: string): string {
  if (value === '~') {
    return process.env.HOME ?? value;
  }

  if (value.startsWith('~/')) {
    const home = process.env.HOME;
    return home ? join(home, value.slice(2)) : value;
  }

  return value;
}

function readConfiguredVaultRoot(): string {
  const config = readMachineConfig() as { vaultRoot?: unknown };
  return typeof config.vaultRoot === 'string' ? config.vaultRoot : '';
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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  pathname: string,
): RegisteredRoute | undefined {
  return routes.find((candidate) => candidate.method === method && candidate.pattern.test(pathname));
}

function emitStreamMessage(
  onEvent: (event: DesktopLocalApiStreamEvent) => void,
  payload: unknown,
): void {
  onEvent({ type: 'message', data: JSON.stringify(payload) });
}

function parsePositiveInteger(raw: string | null, options?: { minimum?: number; maximum?: number }): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed)) {
    return undefined;
  }

  const minimum = options?.minimum ?? 1;
  if (parsed < minimum) {
    return undefined;
  }

  const maximum = options?.maximum;
  if (typeof maximum === 'number' && parsed > maximum) {
    return maximum;
  }

  return parsed;
}

function mapSnapshotEventToDesktopAppEvent(event: unknown): unknown | null {
  if (!event || typeof event !== 'object') {
    return null;
  }

  const typedEvent = event as {
    type?: string;
    entries?: unknown;
    unreadCount?: unknown;
    activeCount?: unknown;
    sessions?: unknown;
    tasks?: unknown;
    state?: unknown;
  };

  switch (typedEvent.type) {
    case 'activity_snapshot':
      return {
        type: 'activity',
        snapshot: {
          entries: Array.isArray(typedEvent.entries) ? typedEvent.entries : [],
          unreadCount: typeof typedEvent.unreadCount === 'number' ? typedEvent.unreadCount : 0,
        },
      };
    case 'alerts_snapshot':
      return {
        type: 'alerts',
        snapshot: {
          entries: Array.isArray(typedEvent.entries) ? typedEvent.entries : [],
          activeCount: typeof typedEvent.activeCount === 'number' ? typedEvent.activeCount : 0,
        },
      };
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
    case 'daemon_snapshot':
      return {
        type: 'daemon',
        state: typedEvent.state ?? null,
      };
    case 'web_ui_snapshot':
      return {
        type: 'webUi',
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
    if (seen.has(topic) || topic === 'runs') {
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

async function subscribeDesktopAppEventStream(
  onEvent: (event: DesktopLocalApiStreamEvent) => void,
): Promise<() => void> {
  await getLocalRoutes();

  let closed = false;
  let writeQueue = Promise.resolve();

  const writeEvent = (event: unknown) => {
    if (closed) {
      return;
    }

    emitStreamMessage(onEvent, event);
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
  writeEvent({ type: 'connected' });
  enqueueWrite(async () => {
    const bootstrapEvents = await buildDesktopAppEventsForTopics(INITIAL_APP_EVENT_TOPICS);
    for (const event of bootstrapEvents) {
      writeEvent(event);
    }
  });

  const unsubscribe = subscribeAppEvents((event) => {
    if (event.type === 'invalidate') {
      const snapshotTopics = event.topics.filter((topic) => topic !== 'runs');
      enqueueWrite(async () => {
        const mappedEvents = await buildDesktopAppEventsForTopics(snapshotTopics);
        for (const mappedEvent of mappedEvents) {
          writeEvent(mappedEvent);
        }
        writeEvent(event);
      });
      return;
    }

    writeEvent(event);
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

export async function subscribeDesktopAppEvents(
  onEvent: (event: DesktopAppBridgeEvent) => void,
): Promise<() => void> {
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
      const snapshotTopics = event.topics.filter((topic) => topic !== 'runs');
      enqueueWrite(async () => {
        const mappedEvents = await buildDesktopAppEventsForTopics(snapshotTopics);
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

async function subscribeDesktopLiveSessionStream(
  url: URL,
  onEvent: (event: DesktopLocalApiStreamEvent) => void,
): Promise<() => void> {
  const match = /^\/api\/live-sessions\/([^/]+)\/events$/.exec(url.pathname);
  const sessionId = decodeURIComponent(match?.[1] ?? '');
  if (!sessionId) {
    throw new Error('Live session id is required.');
  }

  const tailBlocks = parsePositiveInteger(url.searchParams.get('tailBlocks'));
  const surfaceId = url.searchParams.get('surfaceId')?.trim() ?? '';
  const surfaceType = url.searchParams.get('surfaceType') === 'mobile_web'
    ? 'mobile_web'
    : 'desktop_web';

  const pendingPayloads: unknown[] = [];
  let opened = false;
  let closed = false;
  const writeEvent = (event: unknown) => {
    if (closed) {
      return;
    }

    const payload = event && typeof event === 'object' && (event as { type?: unknown }).type === 'snapshot'
      ? inlineConversationSessionSnapshotAssetsCapability(sessionId, event as {
          type: 'snapshot';
          blocks: DisplayBlock[];
          blockOffset: number;
          totalBlocks: number;
        })
      : event;

    if (!opened) {
      pendingPayloads.push(payload);
      return;
    }

    emitStreamMessage(onEvent, payload);
  };

  const unsubscribe = subscribeLiveSession(sessionId, writeEvent, {
    ...(tailBlocks ? { tailBlocks } : {}),
    ...(surfaceId ? { surface: { surfaceId, surfaceType } } : {}),
  });

  if (!unsubscribe) {
    throw new Error('Not a live session');
  }

  onEvent({ type: 'open' });
  opened = true;
  for (const payload of pendingPayloads) {
    emitStreamMessage(onEvent, payload);
  }

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    unsubscribe();
    onEvent({ type: 'close' });
  };
}

async function subscribeDesktopRunStream(
  url: URL,
  onEvent: (event: DesktopLocalApiStreamEvent) => void,
): Promise<() => void> {
  await getLocalRoutes();

  const match = /^\/api\/runs\/([^/]+)\/events$/.exec(url.pathname);
  const runId = decodeURIComponent(match?.[1] ?? '');
  if (!runId) {
    throw new Error('Run id is required.');
  }

  const tail = parsePositiveInteger(url.searchParams.get('tail'), { minimum: 1, maximum: 1000 }) ?? 120;
  const initial = await getDurableRunSnapshot(runId, tail);
  if (!initial) {
    throw new Error('Run not found');
  }

  let closed = false;
  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    clearInterval(pollInterval);
    onEvent({ type: 'close' });
  };

  onEvent({ type: 'open' });
  emitStreamMessage(onEvent, {
    type: 'snapshot',
    detail: initial.detail,
    log: initial.log,
  });

  const pollInterval = setInterval(async () => {
    if (closed) {
      return;
    }

    try {
      const next = await getDurableRunSnapshot(runId, tail);
      if (!next) {
        emitStreamMessage(onEvent, { type: 'deleted', runId });
        close();
        return;
      }

      emitStreamMessage(onEvent, {
        type: 'snapshot',
        detail: next.detail,
        log: next.log,
      });
    } catch {
      // Ignore transient polling failures; the next interval can recover.
    }
  }, 5_000);

  return close;
}

async function subscribeDesktopProviderOAuthStream(
  url: URL,
  onEvent: (event: DesktopLocalApiStreamEvent) => void,
): Promise<() => void> {
  const match = /^\/api\/provider-auth\/oauth\/([^/]+)\/events$/.exec(url.pathname);
  const loginId = decodeURIComponent(match?.[1] ?? '');
  if (!loginId) {
    throw new Error('Provider OAuth login id is required.');
  }

  let closed = false;
  let unsubscribe = () => {};
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    unsubscribe();
    onEvent({ type: 'close' });
  };

  onEvent({ type: 'open' });
  unsubscribe = subscribeProviderOAuthLogin(loginId, (login) => {
    if (closed) {
      return;
    }

    emitStreamMessage(onEvent, login);
    if (login.status === 'completed' || login.status === 'failed') {
      close();
    }
  });

  timeoutId = setTimeout(() => {
    close();
  }, 10 * 60 * 1000);

  return close;
}

export async function subscribeDesktopLocalApiStream(
  path: string,
  onEvent: (event: DesktopLocalApiStreamEvent) => void,
): Promise<() => void> {
  const url = new URL(path, 'http://desktop.local');

  if (url.pathname === '/api/events') {
    return subscribeDesktopAppEventStream(onEvent);
  }

  if (/^\/api\/live-sessions\/[^/]+\/events$/.test(url.pathname)) {
    return subscribeDesktopLiveSessionStream(url, onEvent);
  }

  if (/^\/api\/runs\/[^/]+\/events$/.test(url.pathname)) {
    return subscribeDesktopRunStream(url, onEvent);
  }

  if (/^\/api\/provider-auth\/oauth\/[^/]+\/events$/.test(url.pathname)) {
    return subscribeDesktopProviderOAuthStream(url, onEvent);
  }

  throw new Error(`No local API stream for ${url.pathname}`);
}

export async function dispatchDesktopLocalApiRequest(input: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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
  const activities = context.listActivityForCurrentProfile();
  return {
    profile: context.getCurrentProfile(),
    repoRoot: context.getRepoRoot(),
    activityCount: activities.length,
    webUiRevision: process.env.PERSONAL_AGENT_WEB_REVISION,
  };
}

export async function readDesktopDaemonState() {
  return readDaemonState();
}

export async function readDesktopWebUiState() {
  return readWebUiState();
}

export async function updateDesktopWebUiConfig(input: {
  useTailscaleServe?: boolean;
  resumeFallbackPrompt?: string;
}) {
  const { useTailscaleServe, resumeFallbackPrompt } = input;

  if (useTailscaleServe === undefined && resumeFallbackPrompt === undefined) {
    throw new Error('Provide useTailscaleServe and/or resumeFallbackPrompt.');
  }

  if (useTailscaleServe !== undefined && typeof useTailscaleServe !== 'boolean') {
    throw new Error('useTailscaleServe must be a boolean when provided.');
  }

  if (resumeFallbackPrompt !== undefined && typeof resumeFallbackPrompt !== 'string') {
    throw new Error('resumeFallbackPrompt must be a string when provided.');
  }

  const savedConfig = writeWebUiConfig({
    ...(useTailscaleServe !== undefined ? { useTailscaleServe } : {}),
    ...(resumeFallbackPrompt !== undefined ? { resumeFallbackPrompt } : {}),
  });

  if (useTailscaleServe !== undefined) {
    syncConfiguredWebUiTailscaleServe(savedConfig.useTailscaleServe);
  }

  const state = readWebUiState();
  invalidateAppTopics('webUi');

  return {
    ...state,
    service: {
      ...state.service,
      tailscaleServe: savedConfig.useTailscaleServe,
      resumeFallbackPrompt: savedConfig.resumeFallbackPrompt,
    },
  };
}

export async function readDesktopRemoteAccessState() {
  return readRemoteAccessAdminState();
}

export async function createDesktopRemoteAccessPairingCode() {
  return createRemoteAccessPairingCode();
}

export async function revokeDesktopRemoteAccessSession(sessionId: string) {
  revokeRemoteAccessSession(sessionId);
  return {
    ok: true as const,
    state: readRemoteAccessAdminState(),
  };
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

export async function readDesktopProfiles() {
  const context = await getLocalServerRouteContext();
  return {
    currentProfile: context.getCurrentProfile(),
    profiles: context.listAvailableProfiles(),
  };
}

export async function setDesktopCurrentProfile(profileInput: string) {
  const context = await getLocalServerRouteContext();
  const profile = profileInput.trim();
  if (!profile) {
    throw new Error('profile required');
  }

  return {
    ok: true as const,
    currentProfile: await context.setCurrentProfile(profile),
  };
}

export async function readDesktopModels() {
  return readModelState(DEFAULT_RUNTIME_SETTINGS_FILE);
}

export async function updateDesktopModelPreferences(input: {
  model?: string | null;
  thinkingLevel?: string | null;
}) {
  if (typeof input.model !== 'string' && typeof input.thinkingLevel !== 'string') {
    throw new Error('model or thinkingLevel required');
  }

  const context = await getLocalServerRouteContext();
  const models = readModelState(DEFAULT_RUNTIME_SETTINGS_FILE).models;
  persistSettingsWrite((settingsFile) => {
    writeSavedModelPreferences({
      model: input.model,
      thinkingLevel: input.thinkingLevel,
    }, settingsFile, models);
  }, {
    localSettingsFile: context.getCurrentProfileSettingsFile(),
    runtimeSettingsFile: DEFAULT_RUNTIME_SETTINGS_FILE,
  });

  context.materializeWebProfile(context.getCurrentProfile());
  return { ok: true as const };
}

export async function readDesktopDefaultCwd() {
  return readSavedDefaultCwdPreferences(DEFAULT_RUNTIME_SETTINGS_FILE, process.cwd());
}

export async function updateDesktopDefaultCwd(cwd: string | null) {
  const context = await getLocalServerRouteContext();
  const state = persistSettingsWrite((settingsFile) => writeSavedDefaultCwdPreference(
    { cwd },
    settingsFile,
    { baseDir: process.cwd(), validate: true },
  ), {
    localSettingsFile: context.getCurrentProfileSettingsFile(),
    runtimeSettingsFile: DEFAULT_RUNTIME_SETTINGS_FILE,
  });

  context.materializeWebProfile(context.getCurrentProfile());
  return state;
}

export async function readDesktopVaultRoot() {
  const currentRoot = readConfiguredVaultRoot();
  const source = process.env.PERSONAL_AGENT_VAULT_ROOT?.trim().length
    ? 'env'
    : currentRoot.length > 0
      ? 'config'
      : 'default';

  return {
    currentRoot,
    effectiveRoot: getVaultRoot(),
    defaultRoot: getDefaultVaultRoot(),
    source,
  };
}

export async function readDesktopVaultFiles() {
  return readVaultFilesCapability();
}

export async function updateDesktopVaultRoot(root: string | null) {
  if (root !== undefined && root !== null && typeof root !== 'string') {
    throw new Error('root must be a string or null');
  }

  const normalizedRoot = typeof root === 'string' ? root.trim() : '';
  if (normalizedRoot.length > 0) {
    const resolvedRoot = expandHomePath(normalizedRoot);
    if (!existsSync(resolvedRoot)) {
      throw new Error(`Directory does not exist: ${resolvedRoot}`);
    }
    if (!statSync(resolvedRoot).isDirectory()) {
      throw new Error(`Not a directory: ${resolvedRoot}`);
    }
  }

  updateMachineConfig((current) => {
    const next = { ...(current as Record<string, unknown>) };
    if (normalizedRoot.length > 0) {
      next.vaultRoot = normalizedRoot;
    } else {
      delete next.vaultRoot;
    }
    return next as typeof current;
  });

  const context = await getLocalServerRouteContext();
  context.materializeWebProfile(context.getCurrentProfile());
  return readDesktopVaultRoot();
}

export async function pickDesktopFolder(input: { cwd?: string | null } = {}) {
  const context = await getLocalServerRouteContext();
  return pickFolderCapability(input, {
    getDefaultWebCwd: context.getDefaultWebCwd,
    resolveRequestedCwd: context.resolveRequestedCwd,
  });
}

export async function runDesktopShellCommand(input: { command?: string; cwd?: string | null }) {
  const context = await getLocalServerRouteContext();
  return runShellCommandCapability(input, {
    getDefaultWebCwd: context.getDefaultWebCwd,
    resolveRequestedCwd: context.resolveRequestedCwd,
  });
}

export async function readDesktopConversationTitleSettings() {
  return readSavedConversationTitlePreferences(DEFAULT_RUNTIME_SETTINGS_FILE);
}

export async function updateDesktopConversationTitleSettings(input: {
  enabled?: boolean;
  model?: string | null;
}) {
  const { enabled, model } = input;
  if (typeof enabled !== 'boolean' && typeof model !== 'string' && model !== null) {
    throw new Error('enabled or model required');
  }

  return persistSettingsWrite(
    (settingsFile) => writeSavedConversationTitlePreferences({ enabled, model }, settingsFile),
    { runtimeSettingsFile: DEFAULT_RUNTIME_SETTINGS_FILE },
  );
}

export async function readDesktopConversationPlanDefaults() {
  return readConversationPlanDefaults(DEFAULT_RUNTIME_SETTINGS_FILE);
}

export async function updateDesktopConversationPlanDefaults(input: {
  defaultEnabled?: boolean;
}) {
  if (typeof input.defaultEnabled !== 'boolean') {
    throw new Error('defaultEnabled required');
  }

  const context = await getLocalServerRouteContext();
  const state = persistSettingsWrite(
    (settingsFile) => writeConversationPlanDefaults({ defaultEnabled: input.defaultEnabled }, settingsFile),
    {
      localSettingsFile: context.getCurrentProfileSettingsFile(),
      runtimeSettingsFile: DEFAULT_RUNTIME_SETTINGS_FILE,
    },
  );

  context.materializeWebProfile(context.getCurrentProfile());
  return state;
}

export async function readDesktopConversationPlanLibrary() {
  return readConversationPlanLibrary(DEFAULT_RUNTIME_SETTINGS_FILE);
}

export async function updateDesktopConversationPlanLibrary(input: {
  presets?: unknown;
  defaultPresetIds?: unknown;
}) {
  const context = await getLocalServerRouteContext();
  const state = persistSettingsWrite(
    (settingsFile) => writeConversationPlanLibrary(input, settingsFile),
    {
      localSettingsFile: context.getCurrentProfileSettingsFile(),
      runtimeSettingsFile: DEFAULT_RUNTIME_SETTINGS_FILE,
    },
  );

  context.materializeWebProfile(context.getCurrentProfile());
  return state;
}

export async function readDesktopConversationPlansWorkspace() {
  return readConversationPlansWorkspace(DEFAULT_RUNTIME_SETTINGS_FILE);
}

export async function readDesktopOpenConversationTabs() {
  const context = await getLocalServerRouteContext();
  const saved = readSavedWebUiPreferences(context.getSettingsFile());
  return {
    sessionIds: saved.openConversationIds,
    pinnedSessionIds: saved.pinnedConversationIds,
    archivedSessionIds: saved.archivedConversationIds,
  };
}

export async function updateDesktopOpenConversationTabs(input: {
  sessionIds?: string[];
  pinnedSessionIds?: string[];
  archivedSessionIds?: string[];
}) {
  const { sessionIds, pinnedSessionIds, archivedSessionIds } = input;

  if (sessionIds !== undefined && !Array.isArray(sessionIds)) {
    throw new Error('sessionIds must be an array when provided');
  }

  if (pinnedSessionIds !== undefined && !Array.isArray(pinnedSessionIds)) {
    throw new Error('pinnedSessionIds must be an array when provided');
  }

  if (archivedSessionIds !== undefined && !Array.isArray(archivedSessionIds)) {
    throw new Error('archivedSessionIds must be an array when provided');
  }

  if (sessionIds === undefined && pinnedSessionIds === undefined && archivedSessionIds === undefined) {
    throw new Error('sessionIds, pinnedSessionIds, or archivedSessionIds required');
  }

  const context = await getLocalServerRouteContext();
  const saved = persistSettingsWrite(
    (settingsFile) => writeSavedWebUiPreferences({
      openConversationIds: sessionIds,
      pinnedConversationIds: pinnedSessionIds,
      archivedConversationIds: archivedSessionIds,
    }, settingsFile),
    { runtimeSettingsFile: context.getSettingsFile() },
  );

  invalidateAppTopics('sessions');
  return {
    ok: true as const,
    sessionIds: saved.openConversationIds,
    pinnedSessionIds: saved.pinnedConversationIds,
    archivedSessionIds: saved.archivedConversationIds,
  };
}

export async function readDesktopModelProviders() {
  return readModelProvidersCapability(await getLocalProviderDesktopCapabilityContext());
}

export async function readDesktopProviderAuth() {
  return readProviderAuthCapability(await getLocalProviderDesktopCapabilityContext());
}

export async function readDesktopCodexPlanUsage() {
  try {
    return await readCodexPlanUsageCapability(await getLocalProviderDesktopCapabilityContext());
  } catch (error) {
    return {
      available: true,
      planType: null,
      fiveHour: null,
      weekly: null,
      credits: null,
      updatedAt: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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

export async function deleteDesktopModelProviderModel(input: {
  provider: string;
  modelId: string;
}) {
  return deleteModelProviderModelCapability(
    await getLocalProviderDesktopCapabilityContext(),
    input.provider,
    input.modelId,
  );
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

export async function subscribeDesktopProviderOAuthLogin(
  loginId: string,
  onState: (state: unknown) => void,
): Promise<() => void> {
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
  prompt?: string;
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
  prompt?: string;
}) {
  await getLocalRoutes();
  return updateScheduledTaskCapability(localLiveSessionCapabilityContext?.getCurrentProfile() ?? 'assistant', input);
}

export async function runDesktopScheduledTask(taskId: string) {
  await getLocalRoutes();
  return runScheduledTaskCapability(localLiveSessionCapabilityContext?.getCurrentProfile() ?? 'assistant', taskId);
}

export async function readDesktopActivity() {
  const context = await getLocalInboxCapabilityContext();
  return listActivityCapability(context.getCurrentProfile());
}

export async function readDesktopActivityById(activityId: string) {
  const context = await getLocalInboxCapabilityContext();
  const entry = readActivityCapability(context.getCurrentProfile(), activityId);
  if (!entry) {
    throw new Error('Not found');
  }

  return entry;
}

export async function markDesktopActivityRead(input: { activityId: string; read?: boolean }) {
  const context = await getLocalInboxCapabilityContext();
  const changed = markActivityReadCapability(context.getCurrentProfile(), input.activityId, input.read !== false);
  if (!changed) {
    throw new Error('Not found');
  }

  return { ok: true as const };
}

export async function readDesktopActivityCount() {
  const context = await getLocalInboxCapabilityContext();
  return activityCountCapability(context.getCurrentProfile());
}

export async function clearDesktopInbox() {
  const context = await getLocalInboxCapabilityContext();
  const preferences = readSavedWebUiPreferencesCapability(context.getSavedWebUiPreferences);
  const result = clearInboxCapability({
    profile: context.getCurrentProfile(),
    openConversationIds: [...preferences.openConversationIds, ...preferences.pinnedConversationIds],
  });

  return {
    ok: true as const,
    deletedActivityIds: result.deletedActivityIds,
    clearedConversationIds: result.clearedConversationIds,
  };
}

export async function startDesktopActivityConversation(activityId: string) {
  const context = await getLocalInboxCapabilityContext();
  return startActivityConversationCapability(activityId, context);
}

export async function markDesktopConversationAttention(input: { conversationId: string; read?: boolean }) {
  const context = await getLocalInboxCapabilityContext();
  const updated = markConversationAttentionCapability(context.getCurrentProfile(), input.conversationId, input.read !== false);
  if (!updated) {
    throw new Error('Conversation not found');
  }

  return { ok: true as const };
}

export async function readDesktopAlerts() {
  const context = await getLocalInboxCapabilityContext();
  return readAlertSnapshotCapability(context.getCurrentProfile());
}

export async function acknowledgeDesktopAlert(alertId: string) {
  const context = await getLocalInboxCapabilityContext();
  const alert = acknowledgeAlertCapability(context.getCurrentProfile(), alertId);
  if (!alert) {
    throw new Error('Not found');
  }

  return { ok: true as const, alert };
}

export async function dismissDesktopAlert(alertId: string) {
  const context = await getLocalInboxCapabilityContext();
  const alert = dismissAlertCapability(context.getCurrentProfile(), alertId);
  if (!alert) {
    throw new Error('Not found');
  }

  return { ok: true as const, alert };
}

export async function snoozeDesktopAlert(input: { alertId: string; delay?: string; at?: string }) {
  const context = await getLocalInboxCapabilityContext();
  const result = await snoozeAlertCapability(context.getCurrentProfile(), input.alertId, input);
  if (!result) {
    throw new Error('Not found');
  }

  return { ok: true as const, ...result };
}

export async function readDesktopDurableRuns() {
  return listDurableRunsCapability();
}

export async function readDesktopDurableRun(runId: string) {
  return readDurableRunCapability(runId);
}

export async function readDesktopDurableRunLog(input: {
  runId: string;
  tail?: number;
}) {
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

export async function changeDesktopConversationCwd(input: {
  conversationId: string;
  cwd: string;
  surfaceId?: string;
}) {
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

  if (liveEntry) {
    destroySession(conversationId);
  }

  publishConversationSessionMetaChanged(conversationId, result.id);
  return { id: result.id, sessionFile: result.sessionFile, cwd: nextCwd, changed: true };
}

export async function readDesktopConversationArtifacts(conversationId: string) {
  const context = await getLocalServerRouteContext();
  return readConversationArtifactsCapability(context.getCurrentProfile(), conversationId);
}

export async function readDesktopConversationArtifact(input: {
  conversationId: string;
  artifactId: string;
}) {
  const context = await getLocalServerRouteContext();
  return readConversationArtifactCapability(context.getCurrentProfile(), input);
}

export async function deleteDesktopConversationArtifact(input: {
  conversationId: string;
  artifactId: string;
}) {
  const context = await getLocalServerRouteContext();
  return deleteConversationArtifactCapability(context.getCurrentProfile(), input);
}

export async function readDesktopConversationAttachments(conversationId: string) {
  const context = await getLocalServerRouteContext();
  return readConversationAttachmentsCapability(context.getCurrentProfile(), conversationId);
}

export async function readDesktopConversationAttachment(input: {
  conversationId: string;
  attachmentId: string;
}) {
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

export async function deleteDesktopConversationAttachment(input: {
  conversationId: string;
  attachmentId: string;
}) {
  const context = await getLocalServerRouteContext();
  return deleteConversationAttachmentCapability(context.getCurrentProfile(), input);
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
}) {
  return scheduleConversationDeferredResumeCapability(input);
}

export async function cancelDesktopConversationDeferredResume(input: {
  conversationId: string;
  resumeId: string;
}) {
  return cancelConversationDeferredResumeCapability(input);
}

export async function fireDesktopConversationDeferredResume(input: {
  conversationId: string;
  resumeId: string;
}) {
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
  surfaceId?: string;
}) {
  await getLocalRoutes();

  const conversationId = input.conversationId.trim();
  if (!conversationId) {
    throw new Error('conversationId required');
  }

  const { model, thinkingLevel } = input;
  if (model === undefined && thinkingLevel === undefined) {
    throw new Error('model or thinkingLevel required');
  }

  if ((model !== undefined && model !== null && typeof model !== 'string')
    || (thinkingLevel !== undefined && thinkingLevel !== null && typeof thinkingLevel !== 'string')) {
    throw new Error('model and thinkingLevel must be strings or null');
  }

  const nextInput = {
    ...(model !== undefined ? { model } : {}),
    ...(thinkingLevel !== undefined ? { thinkingLevel } : {}),
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

export async function readDesktopLiveSessions() {
  await getLocalRoutes();
  return getLocalLiveSessions();
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

export async function readDesktopLiveSessionStats(conversationId: string) {
  await getLocalRoutes();

  const stats = getSessionStats(conversationId.trim());
  if (!stats) {
    throw new Error('404 Not Found');
  }

  return stats;
}

export async function renameDesktopLiveSession(input: {
  conversationId: string;
  name: string;
  surfaceId?: string;
}): Promise<{ ok: true; name: string }> {
  await getLocalRoutes();

  const conversationId = input.conversationId.trim();
  if (!conversationId || !isLiveSession(conversationId)) {
    throw new Error('404 Not Found');
  }

  const nextName = input.name.trim();
  if (!nextName) {
    throw new Error('name required');
  }

  renameSession(conversationId, nextName);
  return { ok: true, name: nextName };
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

export async function readDesktopLiveSessionContextUsage(conversationId: string) {
  await getLocalRoutes();

  const usage = getSessionContextUsage(conversationId.trim());
  if (!usage) {
    throw new Error('404 Not Found');
  }

  return usage;
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

  const appendOnly = input.knownSessionSignature && sessionRead.detail.signature && input.knownSessionSignature !== sessionRead.detail.signature
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

export async function readDesktopSessionBlock(input: {
  sessionId: string;
  blockId: string;
}) {
  await getLocalRoutes();

  const result = readConversationSessionBlockWithInlineAssetsCapability(input.sessionId, input.blockId);
  if (!result) {
    throw new Error('Session block not found');
  }

  return result;
}

export async function createDesktopLiveSession(input: {
  cwd?: string;
  model?: string | null;
  thinkingLevel?: string | null;
}): Promise<{ id: string; sessionFile: string; bootstrap?: unknown }> {
  return createLiveSessionCapability(input, await getLocalLiveSessionCapabilityContext());
}

export async function resumeDesktopLiveSession(sessionFile: string): Promise<{ id: string }> {
  return resumeLiveSessionCapability({ sessionFile }, await getLocalLiveSessionCapabilityContext());
}

export async function submitDesktopLiveSessionPrompt(input: {
  conversationId: string;
  text?: string;
  behavior?: 'steer' | 'followUp';
  images?: Array<{ data: string; mimeType: string; name?: string }>;
  attachmentRefs?: unknown;
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

export async function takeOverDesktopLiveSession(input: {
  conversationId: string;
  surfaceId: string;
}) {
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

export async function compactDesktopLiveSession(input: {
  conversationId: string;
  customInstructions?: string;
}) {
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

export async function reloadDesktopLiveSession(input: {
  conversationId: string;
}) {
  return reloadLiveSessionCapability(input);
}

export async function destroyDesktopLiveSession(conversationId: string): Promise<{ ok: true }> {
  return destroyLiveSessionCapability({ conversationId });
}

export async function branchDesktopLiveSession(input: {
  conversationId: string;
  entryId: string;
}) {
  return branchLiveSessionCapability(input, await getLocalLiveSessionCapabilityContext());
}

export async function forkDesktopLiveSession(input: {
  conversationId: string;
  entryId: string;
  preserveSource?: boolean;
}) {
  return forkLiveSessionCapability(input, await getLocalLiveSessionCapabilityContext());
}

export async function summarizeAndForkDesktopLiveSession(input: {
  conversationId: string;
}) {
  return summarizeAndForkLiveSessionCapability(input, await getLocalLiveSessionCapabilityContext());
}

export async function abortDesktopLiveSession(conversationId: string): Promise<{ ok: true }> {
  return abortLiveSessionCapability({ conversationId });
}
