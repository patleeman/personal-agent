import type { DesktopHostRecord, HostController, HostStatus } from './types.js';

export class SshHostController implements HostController {
  readonly id: string;
  readonly label: string;
  readonly kind = 'ssh' as const;

  constructor(private readonly record: Extract<DesktopHostRecord, { kind: 'ssh' }>) {
    this.id = record.id;
    this.label = record.label;
  }

  async ensureRunning(): Promise<void> {
    throw new Error('SSH-backed remote hosts are not implemented yet.');
  }

  async getBaseUrl(): Promise<string> {
    throw new Error('SSH-backed remote hosts are not implemented yet.');
  }

  async getStatus(): Promise<HostStatus> {
    return {
      reachable: false,
      mode: 'ssh-tunnel',
      summary: `SSH host ${this.record.sshTarget} is configured but not implemented yet.`,
      lastError: 'Not implemented yet.',
    };
  }

  async openNewConversation(): Promise<string> {
    throw new Error('SSH-backed remote hosts are not implemented yet.');
  }

  async restart(): Promise<void> {
    throw new Error('SSH-backed remote hosts are not implemented yet.');
  }

  async stop(): Promise<void> {
    return Promise.resolve();
  }

  async dispose(): Promise<void> {
    return Promise.resolve();
  }
}
