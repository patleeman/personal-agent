import { EventEmitter } from 'node:events';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getPiAgentRuntimeDir,
  getStateRoot,
  listProfileActivityEntries,
} from '@personal-agent/core';
import { loadScheduledTasksForProfile } from '../automation/scheduledTasks.js';
import { getDurableRunSnapshot } from '../automation/durableRuns.js';
import { resolveRequestedCwd } from '../conversations/conversationCwd.js';
import { createProfileState } from './profileState.js';
import { createServerRouteContext } from './routeContext.js';
import { listMemoryDocs, listSkillsForProfile } from '../knowledge/memoryDocs.js';
import { registerServerRoutes } from '../routes/registerAll.js';
import { DEFAULT_RUNTIME_SETTINGS_FILE } from '../ui/settingsPersistence.js';
import { getProfileConfigFilePath } from '../ui/profilePreferences.js';
import { readSavedWebUiPreferences } from '../ui/webUiPreferences.js';

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

class LocalApiResponse {
  statusCode = 200;
  headers = new Map<string, string>();
  jsonValue: unknown;
  bodyChunks: string[] = [];
  ended = false;

  status(code: number): this {
    this.statusCode = code;
    return this;
  }

  json(value: unknown): this {
    this.setHeader('Content-Type', 'application/json');
    this.jsonValue = value;
    this.ended = true;
    return this;
  }

  send(value: unknown): this {
    if (typeof value === 'string') {
      this.bodyChunks.push(value);
      this.ended = true;
      return this;
    }

    return this.json(value);
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

  write(chunk: string): void {
    this.bodyChunks.push(chunk);
  }

  end(chunk?: string): void {
    if (typeof chunk === 'string') {
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

function createRouteCollector(routes: RegisteredRoute[]): Pick<{ get: unknown; post: unknown; patch: unknown; delete: unknown }, 'get' | 'post' | 'patch' | 'delete'> {
  const register = (method: RegisteredRoute['method']) => (path: string, handler: RouteHandler) => {
    const { pattern, keys } = buildRoutePattern(path);
    routes.push({ method, path, pattern, keys, handler });
  };

  return {
    get: register('GET'),
    post: register('POST'),
    patch: register('PATCH'),
    delete: register('DELETE'),
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

export async function invokeDesktopLocalApi<T = unknown>(input: {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}): Promise<T> {
  const routes = await getLocalRoutes();
  const url = new URL(input.path, 'http://desktop.local');
  const route = routes.find((candidate) => {
    if (candidate.method !== input.method) {
      return false;
    }

    return candidate.pattern.test(url.pathname);
  });

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

  if (res.statusCode >= 400) {
    const payload = res.jsonValue;
    const message = payload && typeof payload === 'object' && !Array.isArray(payload) && typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : `${res.statusCode} ${renderStatusText(res.statusCode)}`;
    throw new Error(message);
  }

  if (res.jsonValue !== undefined) {
    return res.jsonValue as T;
  }

  const body = res.bodyChunks.join('');
  return body as T;
}
