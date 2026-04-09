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
  private readonly webPort = DEFAULT_WEB_UI_PORT;

  async ensureStarted(): Promise<string> {
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
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    await stopManagedChild(this.webProcess);
    await stopManagedChild(this.daemonProcess);
    this.webProcess = undefined;
    this.daemonProcess = undefined;
  }

  private async start(): Promise<void> {
    if (await pingDaemon()) {
      throw new Error('A daemon is already running outside the desktop app. Stop it before launching the desktop shell.');
    }

    await assertTcpPortAvailable(this.webPort);

    const runtime = resolveDesktopRuntimePaths();
    this.daemonProcess = spawnLoggedChild({
      command: process.execPath,
      args: [runtime.daemonEntryFile, '--foreground'],
      cwd: runtime.repoRoot,
      env: process.env,
      logPath: `${runtime.desktopLogsDir}/daemon.log`,
    });
    this.attachExitLogging(this.daemonProcess.child, 'daemon');
    await waitForDaemonHealthy();

    this.webProcess = spawnLoggedChild({
      command: process.execPath,
      args: [runtime.webServerEntryFile],
      cwd: runtime.repoRoot,
      env: {
        ...process.env,
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

  private attachExitLogging(child: ChildProcess, label: string): void {
    child.once('exit', (code, signal) => {
      const renderedCode = typeof code === 'number' ? String(code) : 'null';
      const renderedSignal = signal ?? 'none';
      console.warn(`[desktop] ${label} exited code=${renderedCode} signal=${renderedSignal}`);
    });
  }
}
