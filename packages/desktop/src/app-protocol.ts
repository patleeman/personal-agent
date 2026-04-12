import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, protocol, session } from 'electron';
import { loadLocalApiModule, type LocalApiModuleLoader } from './local-api-module.js';
import { getHostBrowserPartition } from './state/browser-partitions.js';
import type { DesktopApiStreamEvent } from './hosts/types.js';
import type { HostManager } from './hosts/host-manager.js';

export const DESKTOP_APP_SCHEME = 'personal-agent';
const DESKTOP_APP_HOST = 'app';

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

export function getDesktopAppBaseUrl(): string {
  return `${DESKTOP_APP_SCHEME}://${DESKTOP_APP_HOST}/`;
}

function getMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    case '.ttf':
      return 'font/ttf';
    default:
      return 'application/octet-stream';
  }
}

function resolveDesktopWebDistDir(): string {
  if (app.isPackaged) {
    const packagedDistDir = resolve(app.getAppPath(), 'node_modules', '@personal-agent', 'web', 'dist');
    if (existsSync(packagedDistDir)) {
      return packagedDistDir;
    }
  }

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = process.env.PERSONAL_AGENT_REPO_ROOT?.trim()
    || resolve(currentDir, '..', '..', '..');
  return resolve(repoRoot, 'packages', 'web', 'dist');
}

function resolveStaticFilePath(requestPath: string): string {
  const distRoot = resolveDesktopWebDistDir();
  const normalizedPath = requestPath === '/' ? '/index.html' : requestPath;
  const candidate = resolve(join(distRoot, normalize(normalizedPath).replace(/^\//, '')));
  if (!candidate.startsWith(distRoot)) {
    return join(distRoot, 'index.html');
  }

  return candidate;
}

async function readDesktopProtocolRequestBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return undefined;
  }

  const contentType = request.headers.get('content-type') ?? '';
  const bodyText = await request.text();
  if (bodyText.length === 0) {
    return undefined;
  }

  if (contentType.toLowerCase().includes('application/json')) {
    return JSON.parse(bodyText) as unknown;
  }

  return bodyText;
}

function buildDesktopProtocolErrorResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const status = message.startsWith('No local API route for ')
    ? 404
    : message.includes('requires subscribeDesktopLocalApiStream')
      ? 501
      : 500;

  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function isEventStreamRequest(request: Request): boolean {
  return request.method === 'GET'
    && (request.headers.get('accept') ?? '').toLowerCase().includes('text/event-stream');
}

function createSseProtocolResponse(subscribe: (onEvent: (event: DesktopApiStreamEvent) => void) => Promise<() => void>, request: Request): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let closed = false;

  const close = () => {
    if (closed) {
      return;
    }

    closed = true;
    if (unsubscribe) {
      const teardown = unsubscribe;
      unsubscribe = null;
      teardown();
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      request.signal.addEventListener('abort', close, { once: true });

      try {
        unsubscribe = await subscribe((event) => {
          if (closed) {
            return;
          }

          switch (event.type) {
            case 'open':
              return;
            case 'message':
              controller.enqueue(encoder.encode(`data: ${event.data ?? ''}\n\n`));
              return;
            case 'error':
              close();
              controller.error(new Error(event.message ?? 'Desktop API stream failed.'));
              return;
            case 'close':
              close();
              controller.close();
              return;
          }
        });
      } catch (error) {
        close();
        controller.error(error instanceof Error ? error : new Error(String(error)));
      }
    },
    cancel() {
      close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export function createDesktopProtocolHandler(options?: {
  loadLocalApiModule?: LocalApiModuleLoader;
  hostManager?: HostManager;
  hostId?: string;
}) {
  const loadLocalApi = options?.loadLocalApiModule ?? loadLocalApiModule;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.host !== DESKTOP_APP_HOST) {
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname.startsWith('/api/')) {
      if (request.method !== 'GET' && request.method !== 'POST' && request.method !== 'PATCH' && request.method !== 'DELETE') {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        if (isEventStreamRequest(request)) {
          if (options?.hostManager) {
            const controller = options.hostManager.getHostController(options.hostId ?? 'local');
            return createSseProtocolResponse(
              (onEvent) => controller.subscribeApiStream(`${url.pathname}${url.search}`, onEvent),
              request,
            );
          }

          const module = await loadLocalApi();
          return createSseProtocolResponse(
            (onEvent) => module.subscribeDesktopLocalApiStream(`${url.pathname}${url.search}`, onEvent),
            request,
          );
        }

        if (options?.hostManager) {
          const controller = options.hostManager.getHostController(options.hostId ?? 'local');
          const response = await controller.dispatchApiRequest({
            method: request.method,
            path: `${url.pathname}${url.search}`,
            body: await readDesktopProtocolRequestBody(request),
            headers: Object.fromEntries(request.headers.entries()),
          });

          return new Response(response.body, {
            status: response.statusCode,
            headers: response.headers,
          });
        }

        const module = await loadLocalApi();
        const response = await module.dispatchDesktopLocalApiRequest({
          method: request.method,
          path: `${url.pathname}${url.search}`,
          body: await readDesktopProtocolRequestBody(request),
          headers: Object.fromEntries(request.headers.entries()),
        });

        return new Response(response.body, {
          status: response.statusCode,
          headers: response.headers,
        });
      } catch (error) {
        return buildDesktopProtocolErrorResponse(error);
      }
    }

    const filePath = resolveStaticFilePath(url.pathname);
    const fallbackPath = resolveStaticFilePath('/index.html');
    const targetPath = url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico'
      ? filePath
      : fallbackPath;

    try {
      const body = await readFile(targetPath);
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': getMimeType(targetPath),
        },
      });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 404 });
    }
  };
}

const registeredDesktopProtocolPartitions = new Set<string>();

export function ensureDesktopAppProtocolForHost(hostManager: HostManager, hostId: string): void {
  const partition = getHostBrowserPartition(hostId);
  if (registeredDesktopProtocolPartitions.has(partition)) {
    return;
  }

  const partitionSession = session.fromPartition(partition);
  partitionSession.protocol.handle(DESKTOP_APP_SCHEME, createDesktopProtocolHandler({
    hostManager,
    hostId,
  }));
  registeredDesktopProtocolPartitions.add(partition);
}

export function registerDesktopAppProtocol(hostManager: HostManager): void {
  protocol.handle(DESKTOP_APP_SCHEME, createDesktopProtocolHandler({
    hostManager,
    hostId: 'local',
  }));
  ensureDesktopAppProtocolForHost(hostManager, 'local');
}
