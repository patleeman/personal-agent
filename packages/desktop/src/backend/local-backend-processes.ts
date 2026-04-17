import { type ChildProcess } from 'node:child_process';
import { resolveChildProcessEnv } from '@personal-agent/core';
import { pingDaemon } from '@personal-agent/daemon';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import { resolveDesktopLaunchPresentation } from '../launch-mode.js';
import { clearDesktopDaemonOwnership, writeDesktopDaemonOwnership, type DesktopDaemonOwnership } from './daemon-ownership.js';
import { waitForDaemonHealthy } from './health.js';
import { spawnLoggedChild, stopManagedChild, type ManagedChildProcess } from './child-process.js';

const EXTERNAL_DAEMON_CONFLICT_MESSAGE = 'A personal-agent daemon is already running outside the desktop app. Stable desktop builds will not attach to it. Stop it with `pa daemon stop` or `pa daemon service uninstall`, then relaunch.';
const EXTERNAL_DAEMON_RESTART_MESSAGE = 'The desktop app does not own the running daemon. Restart it with `pa daemon restart` or stop the external daemon service first.';

function allowExternalDaemonReuseInDesktopLaunch(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveDesktopLaunchPresentation(env).mode === 'testing';
}

interface LocalBackendStatus {
  daemonHealthy: boolean;
  daemonOwnership?: DesktopDaemonOwnership;
  blockedReason?: string;
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
      if (allowExternalDaemonReuseInDesktopLaunch()) {
        return;
      }

      throw new Error(EXTERNAL_DAEMON_CONFLICT_MESSAGE);
    }

    clearDesktopDaemonOwnership();
    await this.start({ allowExistingDaemon: allowExternalDaemonReuseInDesktopLaunch() });
  }

  async getStatus(): Promise<LocalBackendStatus> {
    if (this.hasOwnedRuntime()) {
      writeDesktopDaemonOwnership('owned');
      return {
        daemonHealthy: true,
        daemonOwnership: 'owned',
      };
    }

    if (await pingDaemon()) {
      writeDesktopDaemonOwnership('external');
      if (allowExternalDaemonReuseInDesktopLaunch()) {
        return {
          daemonHealthy: true,
          daemonOwnership: 'external',
        };
      }

      return {
        daemonHealthy: false,
        daemonOwnership: 'external',
        blockedReason: EXTERNAL_DAEMON_CONFLICT_MESSAGE,
      };
    }

    clearDesktopDaemonOwnership();
    return {
      daemonHealthy: false,
    };
  }

  async restart(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
    }

    if (!this.hasOwnedRuntime() && await pingDaemon()) {
      writeDesktopDaemonOwnership('external');
      throw new Error(EXTERNAL_DAEMON_RESTART_MESSAGE);
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

      throw new Error(EXTERNAL_DAEMON_CONFLICT_MESSAGE);
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
