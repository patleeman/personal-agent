import { getDesktopAppBaseUrl } from '../app-protocol.js';
import { parseApiDispatchResult } from './api-dispatch.js';
import { CodexAppServerClient } from './codex-app-server-client.js';
import { CodexWorkspaceApiAdapter } from './codex-workspace-api.js';
import type {
  DesktopApiStreamEvent,
  DesktopHostRecord,
  HostController,
  HostStatus,
} from './types.js';

function normalizeWebsocketUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Remote workspace websocket URL is required.');
  }

  const url = new URL(trimmed);
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    throw new Error(`Unsupported websocket protocol: ${url.protocol}`);
  }
  return url.toString();
}

export class WebHostController implements HostController {
  readonly id: string;
  readonly label: string;
  readonly kind = 'web' as const;

  private readonly websocketUrl: string;
  private readonly codexClient: CodexAppServerClient;
  private readonly apiAdapter: CodexWorkspaceApiAdapter;

  constructor(private readonly record: Extract<DesktopHostRecord, { kind: 'web' }>) {
    this.id = record.id;
    this.label = record.label;
    this.websocketUrl = normalizeWebsocketUrl(this.record.websocketUrl);
    this.codexClient = new CodexAppServerClient({ websocketUrl: this.websocketUrl });
    this.apiAdapter = new CodexWorkspaceApiAdapter(this.codexClient, {
      workspaceRoot: this.record.workspaceRoot,
    });
  }

  async ensureRunning(): Promise<void> {
    await this.codexClient.ensureConnected();
  }

  async getBaseUrl(): Promise<string> {
    await this.ensureRunning();
    return getDesktopAppBaseUrl();
  }

  async getStatus(): Promise<HostStatus> {
    try {
      await this.ensureRunning();
      return {
        reachable: true,
        mode: 'ws-remote',
        summary: `Remote workspace reachable over ${this.websocketUrl}${this.record.workspaceRoot ? ` · ${this.record.workspaceRoot}` : ''}.`,
        webUrl: this.websocketUrl,
      };
    } catch (error) {
      return {
        reachable: false,
        mode: 'ws-remote',
        summary: `Remote workspace unreachable at ${this.websocketUrl}${this.record.workspaceRoot ? ` · ${this.record.workspaceRoot}` : ''}.`,
        webUrl: this.websocketUrl,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }
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
    return this.apiAdapter.dispatchApiRequest(input);
  }

  async invokeLocalApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const response = await this.dispatchApiRequest({ method, path, body });
    return parseApiDispatchResult(response);
  }

  async subscribeApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void> {
    await this.ensureRunning();
    return this.apiAdapter.subscribeApiStream(path, onEvent);
  }

  async restart(): Promise<void> {
    this.codexClient.dispose();
    await this.ensureRunning();
  }

  async stop(): Promise<void> {
    this.codexClient.dispose();
  }

  async dispose(): Promise<void> {
    this.codexClient.dispose();
  }
}
