import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { getDesktopAppBaseUrl } from '../app-protocol.js';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import { getAvailableTcpPort } from '../backend/ports.js';
import { parseApiDispatchResult } from './api-dispatch.js';
import { RemoteAppServerClient } from './remote-app-server-client.js';
import type {
  DesktopApiStreamEvent,
  DesktopHostRecord,
  HostController,
  HostStatus,
} from './types.js';

function getRemoteBaseUrl(port: number): string {
  return `http://127.0.0.1:${String(port)}`;
}

async function probeRemoteWebUi(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL('/api/status', baseUrl));
    return response.ok || response.status === 401 || response.status === 403;
  } catch {
    return false;
  }
}

async function waitForRemoteWebUi(baseUrl: string, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await probeRemoteWebUi(baseUrl)) {
      return;
    }

    await delay(300);
  }

  throw new Error(`Timed out waiting for SSH remote web UI at ${baseUrl}.`);
}

export class SshHostController implements HostController {
  readonly id: string;
  readonly label: string;
  readonly kind = 'ssh' as const;

  private tunnelProcess?: ChildProcess;
  private forwardedPort?: number;
  private appServerClient?: RemoteAppServerClient;

  constructor(private readonly record: Extract<DesktopHostRecord, { kind: 'ssh' }>) {
    this.id = record.id;
    this.label = record.label;
  }

  async ensureRunning(): Promise<void> {
    let baseUrl: string | null = null;

    if (this.forwardedPort) {
      const currentBaseUrl = getRemoteBaseUrl(this.forwardedPort);
      const healthy = await probeRemoteWebUi(currentBaseUrl);
      if (healthy) {
        baseUrl = currentBaseUrl;
      }
    }

    if (!baseUrl) {
      await this.disposeTunnel();

      const forwardedPort = await getAvailableTcpPort();
      const remotePort = this.record.remotePort ?? 3741;
      await this.startTunnel(forwardedPort, remotePort);
      this.forwardedPort = forwardedPort;

      baseUrl = getRemoteBaseUrl(forwardedPort);
      if (!(await probeRemoteWebUi(baseUrl))) {
        await this.bootstrapRemoteHost(remotePort);
        await waitForRemoteWebUi(baseUrl);
      }
    }

    await this.getAppServerClient().ensureConnected();
  }

  async getBaseUrl(): Promise<string> {
    await this.ensureRunning();
    return getDesktopAppBaseUrl();
  }

  async getStatus(): Promise<HostStatus> {
    const baseUrl = this.forwardedPort ? getRemoteBaseUrl(this.forwardedPort) : undefined;
    const reachable = baseUrl ? await probeRemoteWebUi(baseUrl) : false;

    return {
      reachable,
      mode: 'ssh-tunnel',
      summary: reachable
        ? `SSH tunnel active via ${this.record.sshTarget}.`
        : `SSH host ${this.record.sshTarget} is configured${this.forwardedPort ? ' but not currently reachable.' : ' and not connected yet.'}`,
      webUrl: baseUrl,
      webHealthy: reachable,
      lastError: reachable ? undefined : 'SSH remote is not currently reachable.',
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
    return this.getAppServerClient().dispatchApiRequest(input);
  }

  async invokeLocalApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const response = await this.dispatchApiRequest({ method, path, body });
    return parseApiDispatchResult(response);
  }

  async subscribeApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void> {
    await this.ensureRunning();
    return this.getAppServerClient().subscribeApiStream(path, onEvent);
  }

  async restart(): Promise<void> {
    await this.disposeTunnel();
    await this.ensureRunning();
  }

  async stop(): Promise<void> {
    await this.disposeTunnel();
  }

  async dispose(): Promise<void> {
    await this.disposeTunnel();
  }

  private async startTunnel(forwardedPort: number, remotePort: number): Promise<void> {
    const runtime = resolveDesktopRuntimePaths();
    const args = [
      '-N',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-o', 'ServerAliveInterval=30',
      '-L', `${String(forwardedPort)}:127.0.0.1:${String(remotePort)}`,
      this.record.sshTarget,
    ];

    this.tunnelProcess = spawn('ssh', args, {
      cwd: runtime.repoRoot,
      env: process.env,
      stdio: ['ignore', 'ignore', 'ignore'],
    });

    let spawnError: Error | null = null;
    this.tunnelProcess.once('error', (error) => {
      spawnError = error;
      this.tunnelProcess = undefined;
      this.forwardedPort = undefined;
    });
    this.tunnelProcess.once('exit', () => {
      this.tunnelProcess = undefined;
      this.forwardedPort = undefined;
    });

    await delay(600);
    if (spawnError) {
      throw spawnError;
    }

    if (this.tunnelProcess.exitCode !== null) {
      throw new Error(`SSH tunnel exited immediately for ${this.record.sshTarget}. Check your SSH config and host reachability.`);
    }
  }

  private async bootstrapRemoteHost(remotePort: number): Promise<void> {
    const repoRoot = this.record.remoteRepoRoot?.trim() || '~/workingdir/personal-agent';
    const bootstrapCommand = [
      `cd ${renderRemotePathForShell(repoRoot)}`,
      '&&',
      'nohup pa daemon start >/tmp/personal-agentd.desktop.log 2>&1 &',
      '&&',
      `nohup env PA_WEB_PORT=${String(remotePort)} PA_WEB_DISABLE_COMPANION=1 pa ui >/tmp/personal-agent-web.desktop.log 2>&1 &`,
    ].join(' ');

    await new Promise<void>((resolve, reject) => {
      const child = spawn('ssh', [this.record.sshTarget, bootstrapCommand], {
        env: process.env,
        stdio: ['ignore', 'ignore', 'ignore'],
      });

      child.once('error', reject);
      child.once('exit', (code) => {
        if (typeof code === 'number' && code !== 0) {
          reject(new Error(`SSH bootstrap command failed with exit code ${String(code)} for ${this.record.sshTarget}.`));
          return;
        }

        resolve();
      });
    });
  }

  private getAppServerClient(): RemoteAppServerClient {
    if (!this.forwardedPort) {
      throw new Error('SSH tunnel did not start correctly.');
    }

    if (!this.appServerClient) {
      this.appServerClient = new RemoteAppServerClient({
        baseUrl: getRemoteBaseUrl(this.forwardedPort),
      });
    }

    return this.appServerClient;
  }

  private async disposeTunnel(): Promise<void> {
    this.appServerClient?.dispose();
    this.appServerClient = undefined;

    const tunnel = this.tunnelProcess;
    this.tunnelProcess = undefined;
    this.forwardedPort = undefined;

    if (!tunnel || tunnel.exitCode !== null) {
      return;
    }

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }

        settled = true;
        resolve();
      };

      const timer = setTimeout(() => {
        if (tunnel.exitCode === null && !tunnel.killed) {
          tunnel.kill('SIGKILL');
        }
        finish();
      }, 4_000);

      tunnel.once('exit', () => {
        clearTimeout(timer);
        finish();
      });

      tunnel.kill('SIGTERM');
    });
  }
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function renderRemotePathForShell(value: string): string {
  if (value.startsWith('~/')) {
    const suffix = value.slice(2).replace(/"/g, '\\"');
    return `"$HOME/${suffix}"`;
  }

  return quoteForShell(value);
}
