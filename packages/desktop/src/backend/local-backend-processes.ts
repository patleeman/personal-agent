import { type ChildProcess } from 'node:child_process';
import { resolveChildProcessEnv } from '@personal-agent/core';
import { pingDaemon } from '@personal-agent/daemon';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import { clearDesktopDaemonOwnership, writeDesktopDaemonOwnership, type DesktopDaemonOwnership } from './daemon-ownership.js';
import { waitForDaemonHealthy } from './health.js';
import { spawnLoggedChild, stopManagedChild, type ManagedChildProcess } from './child-process.js';

interface LocalBackendStatus {
  daemonHealthy: boolean;
  daemonOwnership?: DesktopDaemonOwnership;
}

export class LocalBackendProcesses {
  private daemonProcess?: ManagedChildProcess;
  private startPromise?: Promise<void>;

  async ensureStarted(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    if (this.hasOwnedRuntime()) {
      writeDesktopDaemonOwnership('owned');
      return;
    }

    if (await pingDaemon()) {
      writeDesktopDaemonOwnership('external');
      return;
    }

    clearDesktopDaemonOwnership();
    await this.start({ allowExistingDaemon: true });
  }

  async getStatus(): Promise<LocalBackendStatus> {
    const daemonHealthy = await pingDaemon();
    const daemonOwnership = this.hasOwnedRuntime()
      ? 'owned'
      : daemonHealthy
        ? 'external'
        : undefined;

    writeDesktopDaemonOwnership(daemonOwnership);
    return {
      daemonHealthy,
      daemonOwnership,
    };
  }

  async restart(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
    }

    if (!this.hasOwnedRuntime() && await pingDaemon()) {
      writeDesktopDaemonOwnership('external');
      throw new Error('The desktop app is attached to an external daemon. Restart it with `pa daemon restart` or stop the external daemon service first.');
    }

    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    await stopManagedChild(this.daemonProcess);
    this.daemonProcess = undefined;
    clearDesktopDaemonOwnership();
  }

  private hasOwnedRuntime(): boolean {
    return this.isManagedChildRunning(this.daemonProcess);
  }

  private isManagedChildRunning(managed: ManagedChildProcess | undefined): boolean {
    return Boolean(managed && managed.child.exitCode === null && !managed.child.killed);
  }

  private async start(options: { allowExistingDaemon?: boolean } = {}): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal(options);

    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async startInternal(options: { allowExistingDaemon?: boolean } = {}): Promise<void> {
    if (await pingDaemon()) {
      writeDesktopDaemonOwnership('external');
      if (options.allowExistingDaemon) {
        return;
      }

      throw new Error('A daemon is already running outside the desktop app. Stop it before launching the desktop shell.');
    }

    const runtime = resolveDesktopRuntimePaths();
    const childBaseEnv = resolveChildProcessEnv({
      ...(runtime.useElectronRunAsNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      PERSONAL_AGENT_DESKTOP_RUNTIME: '1',
      PERSONAL_AGENT_DESKTOP_DAEMON_LOG_FILE: `${runtime.desktopLogsDir}/daemon.log`,
      PERSONAL_AGENT_DESKTOP_DAEMON_OWNERSHIP: 'owned',
    });

    this.daemonProcess = spawnLoggedChild({
      command: runtime.nodeCommand,
      args: [runtime.daemonEntryFile, '--foreground'],
      cwd: runtime.repoRoot,
      env: childBaseEnv,
      logPath: `${runtime.desktopLogsDir}/daemon.log`,
    });
    this.attachExitLogging(this.daemonProcess.child);
    await waitForDaemonHealthy();
    writeDesktopDaemonOwnership('owned');
  }

  private attachExitLogging(child: ChildProcess): void {
    child.once('exit', (code, signal) => {
      if (this.daemonProcess?.child === child) {
        this.daemonProcess = undefined;
        clearDesktopDaemonOwnership();
      }

      const renderedCode = typeof code === 'number' ? String(code) : 'null';
      const renderedSignal = signal ?? 'none';
      console.warn(`[desktop] daemon exited code=${renderedCode} signal=${renderedSignal}`);
    });
  }
}
