import { type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveChildProcessEnv } from '@personal-agent/core';
import {
  resolveTailscaleServeBaseUrl,
  syncTailscaleServeProxy,
} from '@personal-agent/services';
import type { DesktopConfig, DesktopWorkspaceServerConfig, DesktopWorkspaceServerState } from './hosts/types.js';
import { resolveDesktopRuntimePaths, type DesktopRuntimePaths } from './desktop-env.js';
import { resolveCodexServerInvocation } from './codex-server-invocation.js';
import {
  loadDesktopConfig,
  saveDesktopConfig,
  DEFAULT_DESKTOP_WORKSPACE_SERVER_PORT,
} from './state/desktop-config.js';
import {
  spawnLoggedChild,
  stopManagedChild,
  type ManagedChildProcess,
} from './backend/child-process.js';

export const DESKTOP_WORKSPACE_SERVER_PATH = '/codex';
const DESKTOP_WORKSPACE_SERVER_LOG_FILE = 'codex-app-server.log';
const DEFAULT_COMMAND_START_TIMEOUT_MS = 15_000;
const DEFAULT_HEALTHCHECK_TIMEOUT_MS = 2_000;
const WORKSPACE_SERVER_RESTART_DELAY_MS = [1_000, 2_000, 5_000, 10_000] as const;

export interface UpdateDesktopWorkspaceServerConfigInput {
  enabled?: boolean;
  port?: number;
  useTailscaleServe?: boolean;
}

interface DesktopWorkspaceServerManagerOptions {
  loadConfig?: () => DesktopConfig;
  saveConfig?: (config: DesktopConfig) => void;
  resolveRuntimePaths?: () => DesktopRuntimePaths;
  resolveInvocation?: (extraArgs?: string[]) => { command: string; args: string[]; cwd: string };
  spawnChild?: typeof spawnLoggedChild;
  stopChild?: typeof stopManagedChild;
  resolveChildEnv?: typeof resolveChildProcessEnv;
  syncTailscaleServe?: typeof syncTailscaleServeProxy;
  resolveTailscaleBaseUrl?: typeof resolveTailscaleServeBaseUrl;
  waitForHealthy?: (port: number, timeoutMs?: number) => Promise<void>;
}

function normalizePort(value: unknown, fallback = DEFAULT_DESKTOP_WORKSPACE_SERVER_PORT): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  const parsed = Math.floor(value);
  return parsed > 0 && parsed <= 65535 ? parsed : fallback;
}

function normalizeWorkspaceServerConfig(input: DesktopConfig['workspaceServer']): DesktopWorkspaceServerConfig {
  return {
    enabled: input?.enabled === true,
    port: normalizePort(input?.port, DEFAULT_DESKTOP_WORKSPACE_SERVER_PORT),
    useTailscaleServe: input?.enabled === true && input?.useTailscaleServe === true,
  };
}

function renderLocalWebsocketUrl(port: number): string {
  return `ws://127.0.0.1:${String(port)}${DESKTOP_WORKSPACE_SERVER_PATH}`;
}

function renderTailnetWebsocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = DESKTOP_WORKSPACE_SERVER_PATH;
  url.search = '';
  url.hash = '';
  return url.toString();
}

async function checkWorkspaceServerHealth(port: number, timeoutMs = DEFAULT_HEALTHCHECK_TIMEOUT_MS): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${String(port)}/healthz`, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        accept: 'text/plain',
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForWorkspaceServerHealthy(port: number, timeoutMs = DEFAULT_COMMAND_START_TIMEOUT_MS): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await checkWorkspaceServerHealth(port)) {
      return;
    }

    await delay(300);
  }

  throw new Error(`Timed out waiting for the desktop workspace server on port ${String(port)}.`);
}

export class DesktopWorkspaceServerManager {
  private child?: ManagedChildProcess;
  private syncPromise?: Promise<DesktopWorkspaceServerState>;
  private publishedPort?: number;
  private lastError: string | null = null;
  private restartTimer?: ReturnType<typeof setTimeout>;
  private restartAttempt = 0;
  private readonly expectedExitChildren = new WeakSet<ChildProcess>();

  private readonly loadConfigImpl: () => DesktopConfig;
  private readonly saveConfigImpl: (config: DesktopConfig) => void;
  private readonly resolveRuntimePathsImpl: () => DesktopRuntimePaths;
  private readonly resolveInvocationImpl: (extraArgs?: string[]) => { command: string; args: string[]; cwd: string };
  private readonly spawnChildImpl: typeof spawnLoggedChild;
  private readonly stopChildImpl: typeof stopManagedChild;
  private readonly resolveChildEnvImpl: typeof resolveChildProcessEnv;
  private readonly syncTailscaleServeImpl: typeof syncTailscaleServeProxy;
  private readonly resolveTailscaleBaseUrlImpl: typeof resolveTailscaleServeBaseUrl;
  private readonly waitForHealthyImpl: (port: number, timeoutMs?: number) => Promise<void>;

  constructor(options: DesktopWorkspaceServerManagerOptions = {}) {
    this.loadConfigImpl = options.loadConfig ?? loadDesktopConfig;
    this.saveConfigImpl = options.saveConfig ?? saveDesktopConfig;
    this.resolveRuntimePathsImpl = options.resolveRuntimePaths ?? resolveDesktopRuntimePaths;
    this.resolveInvocationImpl = options.resolveInvocation ?? resolveCodexServerInvocation;
    this.spawnChildImpl = options.spawnChild ?? spawnLoggedChild;
    this.stopChildImpl = options.stopChild ?? stopManagedChild;
    this.resolveChildEnvImpl = options.resolveChildEnv ?? resolveChildProcessEnv;
    this.syncTailscaleServeImpl = options.syncTailscaleServe ?? syncTailscaleServeProxy;
    this.resolveTailscaleBaseUrlImpl = options.resolveTailscaleBaseUrl ?? resolveTailscaleServeBaseUrl;
    this.waitForHealthyImpl = options.waitForHealthy ?? waitForWorkspaceServerHealthy;
  }

  async readState(): Promise<DesktopWorkspaceServerState> {
    return this.syncToConfig();
  }

  async updateConfig(input: UpdateDesktopWorkspaceServerConfigInput): Promise<DesktopWorkspaceServerState> {
    const current = this.loadConfigImpl();
    const currentConfig = normalizeWorkspaceServerConfig(current.workspaceServer);
    const nextConfig: DesktopWorkspaceServerConfig = {
      enabled: input.enabled === undefined ? currentConfig.enabled : input.enabled,
      port: input.port === undefined ? currentConfig.port : normalizePort(input.port, currentConfig.port),
      useTailscaleServe: input.enabled === false
        ? false
        : input.useTailscaleServe === undefined
          ? currentConfig.useTailscaleServe
          : input.useTailscaleServe,
    };

    this.saveConfigImpl({
      ...current,
      workspaceServer: nextConfig,
    });

    return this.syncToConfig();
  }

  async stop(): Promise<void> {
    this.resetRestartBackoff();
    await this.stopPublishedProxy();
    await this.stopChildProcess();
  }

  private async syncToConfig(): Promise<DesktopWorkspaceServerState> {
    if (this.syncPromise) {
      return this.syncPromise;
    }

    this.syncPromise = this.syncToConfigInternal().finally(() => {
      this.syncPromise = undefined;
    });

    return this.syncPromise;
  }

  private async syncToConfigInternal(): Promise<DesktopWorkspaceServerState> {
    const config = normalizeWorkspaceServerConfig(this.loadConfigImpl().workspaceServer);

    if (!config.enabled) {
      this.resetRestartBackoff();
      this.lastError = null;
      await this.stopPublishedProxy();
      await this.stopChildProcess();
      return this.buildState(config, false);
    }

    try {
      await this.ensureChildProcess(config.port);
      this.lastError = null;
      this.resetRestartBackoff();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return this.buildState(config, false);
    }

    if (config.useTailscaleServe) {
      try {
        if (typeof this.publishedPort === 'number' && this.publishedPort !== config.port) {
          this.syncTailscaleServeImpl({ enabled: false, port: this.publishedPort, path: DESKTOP_WORKSPACE_SERVER_PATH });
        }
        this.syncTailscaleServeImpl({ enabled: true, port: config.port, path: DESKTOP_WORKSPACE_SERVER_PATH });
        this.publishedPort = config.port;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    } else {
      await this.stopPublishedProxy();
    }

    const running = await checkWorkspaceServerHealth(config.port);
    if (running && !this.lastError) {
      this.lastError = null;
    }

    return this.buildState(config, running);
  }

  private buildState(config: DesktopWorkspaceServerConfig, running: boolean): DesktopWorkspaceServerState {
    const runtime = this.resolveRuntimePathsImpl();
    const tailnetBaseUrl = config.useTailscaleServe ? this.resolveTailscaleBaseUrlImpl() : undefined;

    return {
      ...config,
      running,
      websocketPath: DESKTOP_WORKSPACE_SERVER_PATH,
      localWebsocketUrl: renderLocalWebsocketUrl(config.port),
      tailnetWebsocketUrl: tailnetBaseUrl ? renderTailnetWebsocketUrl(tailnetBaseUrl) : undefined,
      logFile: `${runtime.desktopLogsDir}/${DESKTOP_WORKSPACE_SERVER_LOG_FILE}`,
      pid: this.child?.child.pid,
      ...(this.lastError ? { error: this.lastError } : {}),
    };
  }

  private async ensureChildProcess(port: number): Promise<void> {
    if (await checkWorkspaceServerHealth(port)) {
      return;
    }

    await this.stopChildProcess();

    const runtime = this.resolveRuntimePathsImpl();
    const invocation = this.resolveInvocationImpl(['--listen', renderLocalWebsocketUrl(port)]);
    const env = this.resolveChildEnvImpl({
      PERSONAL_AGENT_DESKTOP_RUNTIME: '1',
      PERSONAL_AGENT_DESKTOP_CODEX_LOG_FILE: `${runtime.desktopLogsDir}/${DESKTOP_WORKSPACE_SERVER_LOG_FILE}`,
    });

    this.child = this.spawnChildImpl({
      command: invocation.command,
      args: invocation.args,
      cwd: invocation.cwd,
      env,
      logPath: `${runtime.desktopLogsDir}/${DESKTOP_WORKSPACE_SERVER_LOG_FILE}`,
    });
    this.attachExitLogging(this.child.child, port);
    await this.waitForHealthyImpl(port);
  }

  private attachExitLogging(child: ChildProcess, port: number): void {
    child.once('exit', (code, signal) => {
      const expectedExit = this.expectedExitChildren.has(child);
      this.expectedExitChildren.delete(child);

      if (this.child?.child === child) {
        this.child = undefined;
      }

      if (expectedExit) {
        return;
      }

      const renderedCode = typeof code === 'number' ? String(code) : 'null';
      const renderedSignal = signal ?? 'none';
      this.lastError = `Workspace server exited on port ${String(port)} (code=${renderedCode}, signal=${renderedSignal}).`;
      console.warn(`[desktop] workspace server exited code=${renderedCode} signal=${renderedSignal}`);
      this.scheduleRestart(port);
    });
  }

  private async stopChildProcess(): Promise<void> {
    if (this.child?.child) {
      this.expectedExitChildren.add(this.child.child);
    }

    await this.stopChildImpl(this.child);
    this.child = undefined;
  }

  private async stopPublishedProxy(): Promise<void> {
    if (typeof this.publishedPort !== 'number') {
      return;
    }

    try {
      this.syncTailscaleServeImpl({ enabled: false, port: this.publishedPort, path: DESKTOP_WORKSPACE_SERVER_PATH });
    } catch {
      // Leave the previous error intact if unpublishing fails.
    } finally {
      this.publishedPort = undefined;
    }
  }

  private resetRestartBackoff(): void {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }
    this.restartAttempt = 0;
  }

  private scheduleRestart(port: number): void {
    const config = normalizeWorkspaceServerConfig(this.loadConfigImpl().workspaceServer);
    if (!config.enabled || this.restartTimer) {
      return;
    }

    const nextAttempt = this.restartAttempt;
    const delayMs = WORKSPACE_SERVER_RESTART_DELAY_MS[Math.min(nextAttempt, WORKSPACE_SERVER_RESTART_DELAY_MS.length - 1)];
    this.restartAttempt = nextAttempt + 1;

    console.warn(`[desktop] scheduling workspace server restart on port ${String(port)} in ${String(delayMs)}ms (attempt ${String(this.restartAttempt)})`);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.syncToConfig().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.lastError = message;
        console.warn(`[desktop] workspace server restart failed: ${message}`);
      });
    }, delayMs);
    this.restartTimer.unref?.();
  }
}

export const desktopWorkspaceServerManager = new DesktopWorkspaceServerManager();
