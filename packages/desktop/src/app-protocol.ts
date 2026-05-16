import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, protocol, type Session as ElectronSession, session } from 'electron';

import type { HostManager } from './hosts/host-manager.js';
import type { DesktopApiStreamEvent } from './hosts/types.js';
import { loadLocalApiModule, type LocalApiModuleLoader } from './local-api-module.js';
import { dispatchReadonlyLocalApiRequest, shouldDispatchReadonlyLocalApiInWorker } from './readonly-local-api.js';
import { getHostBrowserPartition } from './state/browser-partitions.js';

const DESKTOP_APP_SCHEME = 'personal-agent';
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

let cachedDesktopWebDistDir: string | null = null;

function resolveDesktopWebDistDir(): string {
  if (cachedDesktopWebDistDir) {
    return cachedDesktopWebDistDir;
  }

  if (app.isPackaged) {
    const packagedDistDir = resolve(app.getAppPath(), 'ui', 'dist');
    if (existsSync(packagedDistDir)) {
      cachedDesktopWebDistDir = packagedDistDir;
      return packagedDistDir;
    }
  }

  const currentDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = process.env.PERSONAL_AGENT_REPO_ROOT?.trim() || resolve(currentDir, '..', '..', '..');

  // Match dev mode order from resolveDesktopRuntimePaths: ui/dist first, then dist.
  const candidates = [resolve(repoRoot, 'packages', 'desktop', 'ui', 'dist'), resolve(repoRoot, 'packages', 'desktop', 'dist')];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      cachedDesktopWebDistDir = candidate;
      return candidate;
    }
  }

  cachedDesktopWebDistDir = candidates[0];
  return candidates[0];
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

const staticFileCache = new Map<string, Promise<Buffer>>();

function readStaticFileCached(filePath: string): Promise<Buffer> {
  let cached = staticFileCache.get(filePath);
  if (!cached) {
    cached = readFile(filePath).catch((error) => {
      staticFileCache.delete(filePath);
      throw error;
    });
    staticFileCache.set(filePath, cached);
  }
  return cached;
}

export function warmDesktopShellStaticAssets(): void {
  const indexPath = resolveStaticFilePath('/index.html');
  void readStaticFileCached(indexPath)
    .then((indexHtml) => {
      const html = indexHtml.toString('utf-8');
      const assetPaths = new Set<string>();
      for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        const assetPath = match[1];
        if (assetPath?.startsWith('/assets/')) {
          assetPaths.add(assetPath);
        }
      }
      for (const assetPath of assetPaths) {
        void readStaticFileCached(resolveStaticFilePath(assetPath)).catch(() => undefined);
      }
    })
    .catch(() => undefined);
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
  return request.method === 'GET' && (request.headers.get('accept') ?? '').toLowerCase().includes('text/event-stream');
}

function createBinaryProtocolResponse(response: {
  statusCode: number;
  headers: Record<string, string> | Headers;
  body: Uint8Array;
}): Response {
  const body = response.body.byteLength > 0 ? (response.body as unknown as BodyInit) : null;
  return new Response(body, {
    status: response.statusCode,
    headers: response.headers,
  });
}

function createSseProtocolResponse(
  subscribe: (onEvent: (event: DesktopApiStreamEvent) => void) => Promise<() => void>,
  request: Request,
): Response {
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

function createDesktopProtocolHandler(options?: {
  loadLocalApiModule?: LocalApiModuleLoader;
  dispatchReadonlyLocalApiRequest?: typeof dispatchReadonlyLocalApiRequest;
  hostManager?: HostManager;
  hostId?: string;
}) {
  const loadLocalApi = options?.loadLocalApiModule ?? loadLocalApiModule;
  const dispatchReadonlyRequest = options?.dispatchReadonlyLocalApiRequest ?? dispatchReadonlyLocalApiRequest;

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.host !== DESKTOP_APP_HOST) {
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname.startsWith('/api/')) {
      if (
        request.method !== 'GET' &&
        request.method !== 'POST' &&
        request.method !== 'PUT' &&
        request.method !== 'PATCH' &&
        request.method !== 'DELETE'
      ) {
        return new Response('Method not allowed', { status: 405 });
      }

      try {
        if (isEventStreamRequest(request)) {
          if (options?.hostManager) {
            const streamPath = `${url.pathname}${url.search}`;
            const subscribe = async (onEvent: (event: DesktopApiStreamEvent) => void) => {
              const controller = options.hostManager?.getHostController(options.hostId ?? 'local');
              if (!controller) {
                throw new Error('Desktop host controller unavailable.');
              }
              return controller.subscribeApiStream(streamPath, onEvent);
            };
            return createSseProtocolResponse(subscribe, request);
          }

          const module = await loadLocalApi();
          return createSseProtocolResponse(
            (onEvent) => module.subscribeDesktopLocalApiStream(`${url.pathname}${url.search}`, onEvent),
            request,
          );
        }

        const requestPath = `${url.pathname}${url.search}`;
        const requestBody = await readDesktopProtocolRequestBody(request);
        const requestHeaders = Object.fromEntries(request.headers.entries());

        if (
          shouldDispatchReadonlyLocalApiInWorker({
            method: request.method,
            path: requestPath,
            hostId: options?.hostId ?? (options?.hostManager ? 'local' : null),
          })
        ) {
          const response = await dispatchReadonlyRequest({
            method: request.method,
            path: requestPath,
            body: requestBody,
            headers: requestHeaders,
          });
          return createBinaryProtocolResponse(response);
        }

        if (options?.hostManager) {
          const response = await options.hostManager.getHostController(options.hostId ?? 'local').dispatchApiRequest({
            method: request.method,
            path: requestPath,
            body: requestBody,
            headers: requestHeaders,
          });

          return createBinaryProtocolResponse(response);
        }

        const module = await loadLocalApi();
        const response = await module.dispatchDesktopLocalApiRequest({
          method: request.method,
          path: requestPath,
          body: requestBody,
          headers: requestHeaders,
        });

        return createBinaryProtocolResponse(response);
      } catch (error) {
        return buildDesktopProtocolErrorResponse(error);
      }
    }

    const filePath = resolveStaticFilePath(url.pathname);
    const fallbackPath = resolveStaticFilePath('/index.html');
    const targetPath = url.pathname.startsWith('/assets/') || url.pathname === '/favicon.ico' ? filePath : fallbackPath;

    try {
      const body = await readStaticFileCached(targetPath);
      return new Response(new Uint8Array(body), {
        status: 200,
        headers: {
          'Content-Type': getMimeType(targetPath),
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      return new Response(error instanceof Error ? error.message : String(error), { status: 404 });
    }
  };
}

const registeredDesktopProtocolPartitions = new Set<string>();

function configureDesktopProtocolSession(partitionSession: ElectronSession, hostId: string): void {
  // The local desktop app only serves internal app routes from this partition.
  // Forcing direct proxy mode avoids repeated system proxy/PAC resolution work
  // on macOS, which can show up as browser-process stalls while clicking around.
  if (hostId === 'local') {
    void partitionSession.setProxy({ mode: 'direct' }).catch(() => {
      // Keep the desktop shell usable even if Chromium rejects a proxy update.
    });

    // App shell asset URLs are content-hashed, but Chromium can keep a stale
    // personal-agent://app main bundle across app updates. That stale bundle can
    // then try to dynamically import extension chunks that no longer exist,
    // blanking every extension-owned page. Clear only the desktop shell session;
    // browser/workbench web sessions use their own partitions.
    void partitionSession.clearCache().catch(() => {
      // Cache clearing is a repair path, not a startup blocker.
    });
  }
}

export function ensureDesktopAppProtocolForHost(hostManager: HostManager, hostId: string): void {
  const partition = getHostBrowserPartition(hostId);
  if (registeredDesktopProtocolPartitions.has(partition)) {
    return;
  }

  const partitionSession = session.fromPartition(partition);
  configureDesktopProtocolSession(partitionSession, hostId);
  partitionSession.protocol.handle(
    DESKTOP_APP_SCHEME,
    createDesktopProtocolHandler({
      hostManager,
      hostId,
    }),
  );
  registeredDesktopProtocolPartitions.add(partition);
}

export function registerDesktopAppProtocol(hostManager: HostManager): void {
  protocol.handle(
    DESKTOP_APP_SCHEME,
    createDesktopProtocolHandler({
      hostManager,
      hostId: 'local',
    }),
  );
  ensureDesktopAppProtocolForHost(hostManager, 'local');
}
