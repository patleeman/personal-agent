import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { getDesktopAppBaseUrl } from '../app-protocol.js';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import { getAvailableTcpPort } from '../backend/ports.js';
import { parseApiDispatchResult } from './api-dispatch.js';
import { CodexAppServerClient } from './codex-app-server-client.js';
import { CodexWorkspaceApiAdapter } from './codex-workspace-api.js';
import type {
  DesktopApiStreamEvent,
  DesktopHostRecord,
  HostController,
  HostStatus,
} from './types.js';

function getRemoteBaseUrl(port: number): string {
  return `ws://127.0.0.1:${String(port)}`;
}

async function waitForCodexServer(client: CodexAppServerClient, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();
  let lastError: Error | null = null;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await client.ensureConnected();
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }

    await delay(300);
  }

  throw new Error(`Timed out waiting for SSH remote codex server.${lastError ? ` ${lastError.message}` : ''}`);
}

export class SshHostController implements HostController {
  readonly id: string;
  readonly label: string;
  readonly kind = 'ssh' as const;

  private tunnelProcess?: ChildProcess;
  private forwardedPort?: number;
  private codexClient?: CodexAppServerClient;
  private apiAdapter?: CodexWorkspaceApiAdapter;

  constructor(private readonly record: Extract<DesktopHostRecord, { kind: 'ssh' }>) {
    this.id = record.id;
    this.label = record.label;
  }

  async ensureRunning(): Promise<void> {
    if (this.codexClient && this.forwardedPort) {
      try {
        await this.codexClient.ensureConnected();
        return;
      } catch {
        await this.disposeTunnel();
      }
    }

    const forwardedPort = await getAvailableTcpPort();
    const remotePort = this.record.remotePort ?? 8390;
    await this.startTunnel(forwardedPort, remotePort);
    this.forwardedPort = forwardedPort;
    this.codexClient = new CodexAppServerClient({ websocketUrl: getRemoteBaseUrl(forwardedPort) });
    this.apiAdapter = new CodexWorkspaceApiAdapter(this.codexClient, {
      workspaceRoot: this.record.workspaceRoot,
    });

    try {
      await waitForCodexServer(this.codexClient);
    } catch {
      await this.bootstrapRemoteHost(remotePort);
      await waitForCodexServer(this.codexClient);
    }
  }

  async getBaseUrl(): Promise<string> {
    await this.ensureRunning();
    return getDesktopAppBaseUrl();
  }

  async getStatus(): Promise<HostStatus> {
    const webUrl = this.forwardedPort ? getRemoteBaseUrl(this.forwardedPort) : undefined;
    try {
      if (this.codexClient) {
        await this.codexClient.ensureConnected();
        return {
          reachable: true,
          mode: 'ssh-tunnel',
          summary: `SSH workspace tunnel active via ${this.record.sshTarget}${this.record.workspaceRoot ? ` · ${this.record.workspaceRoot}` : ''}.`,
          webUrl,
        };
      }
    } catch (error) {
      return {
        reachable: false,
        mode: 'ssh-tunnel',
        summary: `SSH workspace ${this.record.sshTarget} is configured but not currently reachable${this.record.workspaceRoot ? ` · ${this.record.workspaceRoot}` : ''}.`,
        webUrl,
        lastError: error instanceof Error ? error.message : String(error),
      };
    }

    return {
      reachable: false,
      mode: 'ssh-tunnel',
      summary: `SSH workspace ${this.record.sshTarget} is configured and not connected yet${this.record.workspaceRoot ? ` · ${this.record.workspaceRoot}` : ''}.`,
      webUrl,
      lastError: 'SSH workspace is not currently reachable.',
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
    if (!this.apiAdapter) {
      throw new Error('SSH workspace codex adapter is unavailable.');
    }
    return this.apiAdapter.dispatchApiRequest(input);
  }

  async invokeLocalApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const response = await this.dispatchApiRequest({ method, path, body });
    return parseApiDispatchResult(response);
  }

  async subscribeApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void> {
    await this.ensureRunning();
    if (!this.apiAdapter) {
      throw new Error('SSH workspace codex adapter is unavailable.');
    }
    return this.apiAdapter.subscribeApiStream(path, onEvent);
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
    const bootstrapCommand = buildSshBootstrapCommand({
      repoRoot: this.record.remoteRepoRoot,
      remotePort,
    });

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
    this.apiAdapter = undefined;
    this.codexClient?.dispose();
    this.codexClient = undefined;

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

export function buildSshBootstrapCommand(input: { repoRoot?: string; remotePort: number }): string {
  const repoRoot = input.repoRoot?.trim() || '~/workingdir/personal-agent';
  return [
    `cd ${renderRemotePathForShell(repoRoot)}`,
    '&&',
    `nohup pa codex app-server --listen ws://127.0.0.1:${String(input.remotePort)} >/tmp/personal-agent-codex.desktop.log 2>&1 &`,
  ].join(' ');
}
