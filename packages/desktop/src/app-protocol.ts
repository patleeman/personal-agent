import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, protocol, session } from 'electron';
import { DEFAULT_WEB_UI_PORT } from '@personal-agent/core';
import { getHostBrowserPartition } from './state/browser-partitions.js';
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

function getLocalDesktopWebProxyBaseUrl(): string {
  return `http://127.0.0.1:${String(DEFAULT_WEB_UI_PORT)}`;
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

function createDesktopProtocolHandler() {
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (url.host !== DESKTOP_APP_HOST) {
      return new Response('Not found', { status: 404 });
    }

    if (url.pathname.startsWith('/api/')) {
      const forwardedHeaders = new Headers();
      request.headers.forEach((value, key) => {
        const normalizedKey = key.toLowerCase();
        if (normalizedKey === 'origin' || normalizedKey === 'host' || normalizedKey === 'referer') {
          return;
        }

        forwardedHeaders.set(key, value);
      });
      forwardedHeaders.set('Origin', getLocalDesktopWebProxyBaseUrl());
      forwardedHeaders.set('Referer', `${getLocalDesktopWebProxyBaseUrl()}/`);

      const body = request.method === 'GET' || request.method === 'HEAD'
        ? undefined
        : await request.arrayBuffer();

      return fetch(new URL(`${url.pathname}${url.search}`, getLocalDesktopWebProxyBaseUrl()), {
        method: request.method,
        headers: forwardedHeaders,
        ...(body !== undefined ? { body } : {}),
      });
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

export function registerDesktopAppProtocol(_hostManager: HostManager): void {
  const handler = createDesktopProtocolHandler();
  protocol.handle(DESKTOP_APP_SCHEME, handler);
  session.fromPartition(getHostBrowserPartition('local')).protocol.handle(DESKTOP_APP_SCHEME, handler);
}
