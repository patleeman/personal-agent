import { type ChildProcess } from 'node:child_process';
import { pingDaemon } from '@personal-agent/daemon';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import { waitForDaemonHealthy } from './health.js';
import { spawnLoggedChild, stopManagedChild, type ManagedChildProcess } from './child-process.js';

interface LocalBackendStatus {
  daemonHealthy: boolean;
}

export class LocalBackendProcesses {
  private daemonProcess?: ManagedChildProcess;
  private startPromise?: Promise<void>;

  async ensureStarted(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    if (this.hasOwnedRuntime() || await pingDaemon()) {
      return;
    }

    await this.restart();
  }

  async getStatus(): Promise<LocalBackendStatus> {
    return {
      daemonHealthy: await pingDaemon(),
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
    await stopManagedChild(this.daemonProcess);
    this.daemonProcess = undefined;
  }

  private hasOwnedRuntime(): boolean {
    return this.isManagedChildRunning(this.daemonProcess);
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

    const runtime = resolveDesktopRuntimePaths();
    const childBaseEnv = {
      ...process.env,
      ...(runtime.useElectronRunAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      PERSONAL_AGENT_DESKTOP_RUNTIME: '1',
      PERSONAL_AGENT_DESKTOP_DAEMON_LOG_FILE: `${runtime.desktopLogsDir}/daemon.log`,
    };

    this.daemonProcess = spawnLoggedChild({
      command: runtime.nodeCommand,
      args: [runtime.daemonEntryFile, '--foreground'],
      cwd: runtime.repoRoot,
      env: childBaseEnv,
      logPath: `${runtime.desktopLogsDir}/daemon.log`,
    });
    this.attachExitLogging(this.daemonProcess.child);
    await waitForDaemonHealthy();
  }

  private attachExitLogging(child: ChildProcess): void {
    child.once('exit', (code, signal) => {
      if (this.daemonProcess?.child === child) {
        this.daemonProcess = undefined;
      }

      const renderedCode = typeof code === 'number' ? String(code) : 'null';
      const renderedSignal = signal ?? 'none';
      console.warn(`[desktop] daemon exited code=${renderedCode} signal=${renderedSignal}`);
    });
  }
}
