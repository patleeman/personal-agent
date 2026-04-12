import { getDesktopAppBaseUrl } from '../app-protocol.js';
import { readDesktopRemoteHostBearerToken } from '../state/remote-host-auth.js';
import { parseApiDispatchResult } from './api-dispatch.js';
import { RemoteAppServerClient } from './remote-app-server-client.js';
import type {
  DesktopApiStreamEvent,
  DesktopHostRecord,
  HostController,
  HostStatus,
} from './types.js';

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Remote web host base URL is required.');
  }

  const url = new URL(trimmed);
  return url.toString().replace(/\/$/, '');
}

async function probeRemoteWebUi(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/status', baseUrl));
    return response.ok || response.status === 401 || response.status === 403;
  } catch {
    return false;
  }
}

export class WebHostController implements HostController {
  readonly id: string;
  readonly label: string;
  readonly kind = 'web' as const;

  private readonly baseUrl: string;
  private readonly appServerClient: RemoteAppServerClient;

  constructor(private readonly record: Extract<DesktopHostRecord, { kind: 'web' }>) {
    this.id = record.id;
    this.label = record.label;
    this.baseUrl = normalizeBaseUrl(this.record.baseUrl);
    const bearerToken = readDesktopRemoteHostBearerToken(record.id);
    this.appServerClient = new RemoteAppServerClient({
      baseUrl: this.baseUrl,
      headers: bearerToken
        ? { Authorization: `Bearer ${bearerToken}` }
        : undefined,
    });
  }

  async ensureRunning(): Promise<void> {
    const reachable = await probeRemoteWebUi(this.baseUrl);
    if (!reachable) {
      throw new Error(`Could not reach remote web host at ${this.baseUrl}.`);
    }

    await this.appServerClient.ensureConnected();
  }

  async getBaseUrl(): Promise<string> {
    await this.ensureRunning();
    return getDesktopAppBaseUrl();
  }

  async getStatus(): Promise<HostStatus> {
    const reachable = await probeRemoteWebUi(this.baseUrl);
    return {
      reachable,
      mode: 'web-remote',
      summary: reachable
        ? `Remote web host reachable at ${this.baseUrl}.`
        : `Remote web host unreachable at ${this.baseUrl}.`,
      webUrl: this.baseUrl,
      webHealthy: reachable,
      lastError: reachable ? undefined : 'Remote web host is not currently reachable.',
    };
  }

  async openNewConversation(): Promise<string> {
    await this.ensureRunning();
    return new URL('/conversations/new', getDesktopAppBaseUrl()).toString();
  }

  async dispatchApiRequest(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }) {
    await this.ensureRunning();
    return this.appServerClient.dispatchApiRequest(input);
  }

  async invokeLocalApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const response = await this.dispatchApiRequest({ method, path, body });
    return parseApiDispatchResult(response);
  }

  async subscribeApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void> {
    await this.ensureRunning();
    return this.appServerClient.subscribeApiStream(path, onEvent);
  }

  async restart(): Promise<void> {
    this.appServerClient.dispose();
    await this.ensureRunning();
  }

  async stop(): Promise<void> {
    this.appServerClient.dispose();
  }

  async dispose(): Promise<void> {
    this.appServerClient.dispose();
  }
}
