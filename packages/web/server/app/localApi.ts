import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getPiAgentRuntimeDir,
  getStateRoot,
  listProfileActivityEntries,
} from '@personal-agent/core';
import { loadScheduledTasksForProfile } from '../automation/scheduledTasks.js';
import { getDurableRunSnapshot } from '../automation/durableRuns.js';
import { subscribe as subscribeLiveSession } from '../conversations/liveSessions.js';
import { resolveRequestedCwd } from '../conversations/conversationCwd.js';
import { listMemoryDocs, listSkillsForProfile } from '../knowledge/memoryDocs.js';
import { subscribeProviderOAuthLogin } from '../models/providerAuth.js';
import { registerServerRoutes } from '../routes/registerAll.js';
import { buildSnapshotEventsForTopic, INITIAL_APP_EVENT_TOPICS } from '../routes/system.js';
import { subscribeAppEvents } from '../shared/appEvents.js';
import { streamSnapshotEvents } from '../shared/snapshotEventStreaming.js';
import { getProfileConfigFilePath } from '../ui/profilePreferences.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE } from '../ui/settingsPersistence.js';
import { readSavedWebUiPreferences } from '../ui/webUiPreferences.js';
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
    listActivityForCurrentProfile: () => listProfileActivityEntries({
      repoRoot,
      profile: profileState.getCurrentProfile(),
    }).map(({ entry }) => ({
      ...entry,
      read: false,
    })),
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

  const routes: RegisteredRoute[] = [];
  const appRouter = createRouteCollector(routes);
  const companionRouter = createRouteCollector([]);
  registerServerRoutes({
    app: appRouter as never,
    companionApp: companionRouter as never,
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
    await streamSnapshotEvents(INITIAL_APP_EVENT_TOPICS, {
      buildEvents: buildSnapshotEventsForTopic,
      writeEvent,
    });
  });

  const unsubscribe = subscribeAppEvents((event) => {
    if (event.type === 'invalidate') {
      const snapshotTopics = event.topics.filter((topic) => topic !== 'runs');
      enqueueWrite(async () => {
        if (snapshotTopics.length > 0) {
          await streamSnapshotEvents(snapshotTopics, {
            buildEvents: buildSnapshotEventsForTopic,
            writeEvent,
          });
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

    if (!opened) {
      pendingPayloads.push(event);
      return;
    }

    emitStreamMessage(onEvent, event);
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
