import { LocalBackendProcesses } from '../backend/local-backend-processes.js';
import type { DesktopHostRecord, HostController, HostStatus } from './types.js';

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
    return this.backend.ensureStarted();
  }

  async getStatus(): Promise<HostStatus> {
    const status = await this.backend.getStatus();
    return {
      reachable: status.daemonHealthy && status.webHealthy,
      mode: 'local-child-process',
      summary: status.daemonHealthy && status.webHealthy ? 'Local backend is healthy.' : 'Local backend is starting or unavailable.',
      webUrl: status.baseUrl,
      daemonHealthy: status.daemonHealthy,
      webHealthy: status.webHealthy,
    };
  }

  async openNewConversation(): Promise<string> {
    const baseUrl = await this.getBaseUrl();
    return new URL('/conversations/new', baseUrl).toString();
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
