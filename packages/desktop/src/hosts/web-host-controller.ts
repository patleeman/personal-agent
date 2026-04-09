import type { DesktopHostRecord, HostController, HostStatus } from './types.js';

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

  constructor(private readonly record: Extract<DesktopHostRecord, { kind: 'web' }>) {
    this.id = record.id;
    this.label = record.label;
  }

  async ensureRunning(): Promise<void> {
    const baseUrl = normalizeBaseUrl(this.record.baseUrl);
    const reachable = await probeRemoteWebUi(baseUrl);
    if (!reachable) {
      throw new Error(`Could not reach remote web host at ${baseUrl}.`);
    }
  }

  async getBaseUrl(): Promise<string> {
    const baseUrl = normalizeBaseUrl(this.record.baseUrl);
    await this.ensureRunning();
    return baseUrl;
  }

  async getStatus(): Promise<HostStatus> {
    const baseUrl = normalizeBaseUrl(this.record.baseUrl);
    const reachable = await probeRemoteWebUi(baseUrl);
    return {
      reachable,
      mode: 'web-remote',
      summary: reachable
        ? `Remote web host reachable at ${baseUrl}.`
        : `Remote web host unreachable at ${baseUrl}.`,
      webUrl: baseUrl,
      webHealthy: reachable,
      lastError: reachable ? undefined : 'Remote web host is not currently reachable.',
    };
  }

  async openNewConversation(): Promise<string> {
    const baseUrl = await this.getBaseUrl();
    return new URL('/conversations/new', baseUrl).toString();
  }

  async restart(): Promise<void> {
    throw new Error('Restart is only supported for the local desktop host right now.');
  }

  async stop(): Promise<void> {
    return Promise.resolve();
  }

  async dispose(): Promise<void> {
    return Promise.resolve();
  }
}
