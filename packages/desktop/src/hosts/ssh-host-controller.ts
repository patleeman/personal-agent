import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import { getAvailableTcpPort } from '../backend/ports.js';
import type {
  ConversationBootstrapRequest,
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

  constructor(private readonly record: Extract<DesktopHostRecord, { kind: 'ssh' }>) {
    this.id = record.id;
    this.label = record.label;
  }

  async ensureRunning(): Promise<void> {
    if (this.forwardedPort) {
      const healthy = await probeRemoteWebUi(getRemoteBaseUrl(this.forwardedPort));
      if (healthy) {
        return;
      }
    }

    await this.disposeTunnel();

    const forwardedPort = await getAvailableTcpPort();
    const remotePort = this.record.remotePort ?? 3741;
    await this.startTunnel(forwardedPort, remotePort);
    this.forwardedPort = forwardedPort;

    const baseUrl = getRemoteBaseUrl(forwardedPort);
    if (await probeRemoteWebUi(baseUrl)) {
      return;
    }

    await this.bootstrapRemoteHost(remotePort);
    await waitForRemoteWebUi(baseUrl);
  }

  async getBaseUrl(): Promise<string> {
    await this.ensureRunning();
    if (!this.forwardedPort) {
      throw new Error('SSH tunnel did not start correctly.');
    }

    return getRemoteBaseUrl(this.forwardedPort);
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
    const baseUrl = await this.getBaseUrl();
    return new URL('/conversations/new', baseUrl).toString();
  }

  async readConversationBootstrap(_conversationId: string, _options?: ConversationBootstrapRequest): Promise<never> {
    throw new Error('Desktop conversation bootstrap IPC is only available for the local host.');
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

  private async disposeTunnel(): Promise<void> {
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
