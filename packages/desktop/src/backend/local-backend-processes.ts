import { appendFileSync } from 'node:fs';
import { PersonalAgentDaemon, bindInProcessDaemonClient, pingDaemon } from '@personal-agent/daemon';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import { resolveDesktopLaunchPresentation } from '../launch-mode.js';
import { clearDesktopDaemonOwnership, writeDesktopDaemonOwnership, type DesktopDaemonOwnership } from './daemon-ownership.js';

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
  private daemon?: PersonalAgentDaemon;
  private clearInProcessClientBinding?: () => void;
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
    this.clearInProcessClientBinding?.();
    this.clearInProcessClientBinding = undefined;

    if (this.daemon) {
      await this.daemon.stop();
      this.daemon = undefined;
    }

    clearDesktopDaemonOwnership();
  }

  private hasOwnedRuntime(): boolean {
    return this.daemon?.isRunning() === true;
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
    const logPath = `${runtime.desktopLogsDir}/daemon.log`;
    const daemon = new PersonalAgentDaemon({
      stopRequestBehavior: 'reject',
      logSink: (line) => {
        appendFileSync(logPath, `${line}\n`, 'utf-8');
      },
    });

    try {
      await daemon.start();
    } catch (error) {
      clearDesktopDaemonOwnership();
      await daemon.stop().catch(() => undefined);
      throw error;
    }

    this.clearInProcessClientBinding?.();
    this.clearInProcessClientBinding = bindInProcessDaemonClient(daemon);
    this.daemon = daemon;
    writeDesktopDaemonOwnership('owned');
  }
}
