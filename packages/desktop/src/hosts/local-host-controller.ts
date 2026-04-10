import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getDesktopAppBaseUrl } from '../app-protocol.js';
import { LocalBackendProcesses } from '../backend/local-backend-processes.js';
import { proxyApiStream } from './api-stream.js';
import type {
  DesktopApiStreamEvent,
  DesktopHostRecord,
  HostController,
  HostStatus,
} from './types.js';

interface LocalApiModule {
  invokeDesktopLocalApi<T = unknown>(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<T>;
}

function isDirectDesktopApiPath(path: string): boolean {
  const pathname = path.split('?', 1)[0] ?? path;
  return pathname === '/api/status'
    || pathname === '/api/daemon'
    || pathname === '/api/web-ui/state'
    || pathname === '/api/profiles'
    || pathname === '/api/models'
    || pathname === '/api/models/current'
    || pathname === '/api/default-cwd'
    || pathname === '/api/vault-root'
    || pathname === '/api/vault-files'
    || pathname === '/api/memory'
    || pathname === '/api/memory/file'
    || pathname.startsWith('/api/model-providers')
    || pathname.startsWith('/api/sessions')
    || pathname.endsWith('/bootstrap')
    || pathname.endsWith('/model-preferences');
}

async function readProxyApiError(res: Response): Promise<string> {
  try {
    const data = await res.json() as { error?: string };
    if (typeof data.error === 'string' && data.error.trim().length > 0) {
      return data.error;
    }
  } catch {
    // Ignore malformed proxy error bodies.
  }

  return `${res.status} ${res.statusText}`;
}

let localApiModulePromise: Promise<LocalApiModule> | null = null;

function loadLocalApiModule(): Promise<LocalApiModule> {
  if (!localApiModulePromise) {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const moduleUrl = pathToFileURL(resolve(currentDir, '../../../web/dist-server/app/localApi.js')).href;
    localApiModulePromise = import(moduleUrl) as Promise<LocalApiModule>;
  }

  return localApiModulePromise;
}

export class LocalHostController implements HostController {
  readonly id: string;
  readonly label: string;
  readonly kind = 'local' as const;

  constructor(
    record: Extract<DesktopHostRecord, { kind: 'local' }>,
    private readonly backend = new LocalBackendProcesses(),
  ) {
    this.id = record.id;
    this.label = record.label;
  }

  async ensureRunning(): Promise<void> {
    await this.backend.ensureStarted();
  }

  async getBaseUrl(): Promise<string> {
    await this.backend.ensureStarted();
    return getDesktopAppBaseUrl();
  }

  async getStatus(): Promise<HostStatus> {
    const status = await this.backend.getStatus();
    return {
      reachable: status.daemonHealthy && status.webHealthy,
      mode: 'local-child-process',
      summary: status.daemonHealthy && status.webHealthy ? 'Local backend is healthy.' : 'Local backend is starting or unavailable.',
      webUrl: getDesktopAppBaseUrl(),
      daemonHealthy: status.daemonHealthy,
      webHealthy: status.webHealthy,
    };
  }

  async openNewConversation(): Promise<string> {
    const baseUrl = await this.getBaseUrl();
    return new URL('/conversations/new', baseUrl).toString();
  }

  async invokeLocalApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    if (isDirectDesktopApiPath(path)) {
      const module = await loadLocalApiModule();
      return module.invokeDesktopLocalApi({ method, path, body });
    }

    const baseUrl = await this.backend.ensureStarted();
    const response = await fetch(new URL(path, baseUrl), {
      method,
      ...(method === 'GET'
        ? {}
        : {
            headers: {
              'Content-Type': 'application/json',
              Origin: baseUrl,
              Referer: `${baseUrl}/`,
            },
            body: body !== undefined ? JSON.stringify(body) : undefined,
          }),
    });

    if (!response.ok) {
      throw new Error(await readProxyApiError(response));
    }

    return response.json();
  }

  async subscribeApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void> {
    const baseUrl = await this.backend.ensureStarted();
    return proxyApiStream(baseUrl, path, onEvent);
  }

  async restart(): Promise<void> {
    await this.backend.restart();
  }

  async stop(): Promise<void> {
    await this.backend.stop();
  }

  async dispose(): Promise<void> {
    await this.stop();
  }
}
