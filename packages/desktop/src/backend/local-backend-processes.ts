import { type ChildProcess } from 'node:child_process';
import { DEFAULT_WEB_UI_PORT } from '@personal-agent/core';
import { pingDaemon } from '@personal-agent/daemon';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import { isWebUiHealthy, waitForDaemonHealthy, waitForWebUiHealthy } from './health.js';
import { assertTcpPortAvailable } from './ports.js';
import { spawnLoggedChild, stopManagedChild, type ManagedChildProcess } from './child-process.js';

interface LocalBackendStatus {
  daemonHealthy: boolean;
  webHealthy: boolean;
  webPort: number;
  baseUrl: string;
}

export class LocalBackendProcesses {
  private daemonProcess?: ManagedChildProcess;
  private webProcess?: ManagedChildProcess;
  private startPromise?: Promise<void>;
  private readonly webPort = DEFAULT_WEB_UI_PORT;

  async ensureStarted(): Promise<string> {
    if (this.startPromise) {
      await this.startPromise;
      return this.getBaseUrl();
    }

    if (this.hasOwnedRuntime()) {
      return this.getBaseUrl();
    }

    const status = await this.getStatus();
    if (status.daemonHealthy && status.webHealthy) {
      return status.baseUrl;
    }

    await this.restart();
    return this.getBaseUrl();
  }

  getBaseUrl(): string {
    return `http://127.0.0.1:${String(this.webPort)}`;
  }

  async getStatus(): Promise<LocalBackendStatus> {
    const baseUrl = this.getBaseUrl();
    const daemonHealthy = await pingDaemon();
    const webHealthy = await isWebUiHealthy(baseUrl);

    return {
      daemonHealthy,
      webHealthy,
      webPort: this.webPort,
      baseUrl,
    };
  }

  async restart(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
    }

    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    await stopManagedChild(this.webProcess);
    await stopManagedChild(this.daemonProcess);
    this.webProcess = undefined;
    this.daemonProcess = undefined;
  }

  private hasOwnedRuntime(): boolean {
    return this.isManagedChildRunning(this.daemonProcess) && this.isManagedChildRunning(this.webProcess);
  }

  private isManagedChildRunning(managed: ManagedChildProcess | undefined): boolean {
    return Boolean(managed && managed.child.exitCode === null && !managed.child.killed);
  }

  private async start(): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal();

    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async startInternal(): Promise<void> {
    if (await pingDaemon()) {
      throw new Error('A daemon is already running outside the desktop app. Stop it before launching the desktop shell.');
    }

    await assertTcpPortAvailable(this.webPort);

    const runtime = resolveDesktopRuntimePaths();
    const childBaseEnv = {
      ...process.env,
      ...(runtime.useElectronRunAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      PERSONAL_AGENT_DESKTOP_RUNTIME: '1',
      PERSONAL_AGENT_DESKTOP_DAEMON_LOG_FILE: `${runtime.desktopLogsDir}/daemon.log`,
      PERSONAL_AGENT_DESKTOP_WEB_LOG_FILE: `${runtime.desktopLogsDir}/web-ui.log`,
    };

    this.daemonProcess = spawnLoggedChild({
      command: runtime.nodeCommand,
      args: [runtime.daemonEntryFile, '--foreground'],
      cwd: runtime.repoRoot,
      env: childBaseEnv,
      logPath: `${runtime.desktopLogsDir}/daemon.log`,
    });
    this.attachExitLogging(this.daemonProcess.child, 'daemon');
    await waitForDaemonHealthy();

    this.webProcess = spawnLoggedChild({
      command: runtime.nodeCommand,
      args: [runtime.webServerEntryFile],
      cwd: runtime.repoRoot,
      env: {
        ...childBaseEnv,
        PA_WEB_PORT: String(this.webPort),
        PA_WEB_DIST: runtime.webDistDir,
        PA_WEB_DISABLE_COMPANION: '1',
        PERSONAL_AGENT_REPO_ROOT: runtime.repoRoot,
      },
      logPath: `${runtime.desktopLogsDir}/web-ui.log`,
    });
    this.attachExitLogging(this.webProcess.child, 'web-ui');

    try {
      await waitForWebUiHealthy(this.getBaseUrl());
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  private attachExitLogging(child: ChildProcess, label: 'daemon' | 'web-ui'): void {
    child.once('exit', (code, signal) => {
      if (label === 'daemon' && this.daemonProcess?.child === child) {
        this.daemonProcess = undefined;
      }
      if (label === 'web-ui' && this.webProcess?.child === child) {
        this.webProcess = undefined;
      }

      const renderedCode = typeof code === 'number' ? String(code) : 'null';
      const renderedSignal = signal ?? 'none';
      console.warn(`[desktop] ${label} exited code=${renderedCode} signal=${renderedSignal}`);
    });
  }
}
