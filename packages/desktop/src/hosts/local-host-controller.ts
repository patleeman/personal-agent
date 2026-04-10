import { getDesktopAppBaseUrl } from '../app-protocol.js';
import { LocalBackendProcesses } from '../backend/local-backend-processes.js';
import { loadLocalApiModule, type LocalApiModuleLoader } from '../local-api-module.js';
import type {
  DesktopApiStreamEvent,
  DesktopHostRecord,
  HostController,
  HostStatus,
} from './types.js';

export class LocalHostController implements HostController {
  readonly id: string;
  readonly label: string;
  readonly kind = 'local' as const;

  constructor(
    record: Extract<DesktopHostRecord, { kind: 'local' }>,
    private readonly backend = new LocalBackendProcesses(),
    private readonly loadLocalApi = loadLocalApiModule as LocalApiModuleLoader,
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
      reachable: status.daemonHealthy,
      mode: 'local-child-process',
      summary: status.daemonHealthy ? 'Local desktop runtime is healthy.' : 'Local desktop runtime is starting or unavailable.',
      webUrl: getDesktopAppBaseUrl(),
      daemonHealthy: status.daemonHealthy,
    };
  }

  async openNewConversation(): Promise<string> {
    const baseUrl = await this.getBaseUrl();
    return new URL('/conversations/new', baseUrl).toString();
  }

  async invokeLocalApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.invokeDesktopLocalApi({ method, path, body });
  }

  async subscribeApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void> {
    const module = await this.loadLocalApi();
    return module.subscribeDesktopLocalApiStream(path, onEvent);
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
