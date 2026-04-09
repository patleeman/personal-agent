import type { DesktopHostRecord, HostController, HostStatus } from './types.js';

export class WebHostController implements HostController {
  readonly id: string;
  readonly label: string;
  readonly kind = 'web' as const;

  constructor(private readonly record: Extract<DesktopHostRecord, { kind: 'web' }>) {
    this.id = record.id;
    this.label = record.label;
  }

  async ensureRunning(): Promise<void> {
    throw new Error('Direct web/Tailscale remote hosts are not implemented yet.');
  }

  async getBaseUrl(): Promise<string> {
    throw new Error('Direct web/Tailscale remote hosts are not implemented yet.');
  }

  async getStatus(): Promise<HostStatus> {
    return {
      reachable: false,
      mode: 'web-remote',
      summary: `Remote web host ${this.record.baseUrl} is configured but not implemented yet.`,
      webUrl: this.record.baseUrl,
      lastError: 'Not implemented yet.',
    };
  }

  async openNewConversation(): Promise<string> {
    throw new Error('Direct web/Tailscale remote hosts are not implemented yet.');
  }

  async restart(): Promise<void> {
    throw new Error('Direct web/Tailscale remote hosts are not implemented yet.');
  }

  async stop(): Promise<void> {
    return Promise.resolve();
  }

  async dispose(): Promise<void> {
    return Promise.resolve();
  }
}
