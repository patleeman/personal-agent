import { createWriteStream, existsSync, type WriteStream } from 'node:fs';

import { bindInProcessDaemonClient, PersonalAgentDaemon } from '@personal-agent/daemon';

import { resolveDesktopRuntimePaths } from '../desktop-env.js';

interface LocalBackendStatus {
  daemonHealthy: boolean;
}

type DaemonHealthNotificationKind = 'unhealthy' | 'recovered' | 'restart-failed';

async function showDaemonHealthNotification(kind: DaemonHealthNotificationKind, detail?: string): Promise<void> {
  try {
    const { Notification } = await import('electron');
    if (!Notification.isSupported()) {
      return;
    }

    const copy =
      kind === 'unhealthy'
        ? {
            title: 'Personal Agent daemon stopped',
            body: 'Background commands, subagents, and automations were unavailable. Restarting runtime…',
          }
        : kind === 'recovered'
          ? {
              title: 'Personal Agent daemon recovered',
              body: 'Background commands, subagents, and automations are available again.',
            }
          : {
              title: 'Personal Agent daemon restart failed',
              body: detail ? `Runtime is still unavailable: ${detail}` : 'Runtime is still unavailable. Open logs for details.',
            };

    new Notification(copy).show();
  } catch {
    // Desktop notifications are best-effort; never let them affect daemon recovery.
  }
}

export class LocalBackendProcesses {
  private daemon?: PersonalAgentDaemon;
  private clearInProcessClientBinding?: () => void;
  private startPromise?: Promise<void>;
  private logStream?: WriteStream;
  private healthTimer?: NodeJS.Timeout;
  private notifiedUnhealthy = false;

  async ensureStarted(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    if (this.hasOwnedRuntime()) {
      return;
    }

    await this.start();
  }

  async getStatus(): Promise<LocalBackendStatus> {
    if (this.hasOwnedRuntime()) {
      return {
        daemonHealthy: true,
      };
    }

    return {
      daemonHealthy: false,
    };
  }

  async restart(): Promise<void> {
    if (this.startPromise) {
      await this.startPromise;
    }

    if (!this.hasOwnedRuntime()) {
      await this.start();
      return;
    }

    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    this.stopHealthMonitor();
    this.clearInProcessClientBinding?.();
    this.clearInProcessClientBinding = undefined;

    if (this.daemon) {
      await this.daemon.stop();
      this.daemon = undefined;
    }

    if (this.logStream) {
      const stream = this.logStream;
      this.logStream = undefined;
      await new Promise<void>((resolve) => stream.end(resolve));
    }
  }

  private hasOwnedRuntime(): boolean {
    return this.daemon?.isRunning() === true && existsSync(this.daemon.getSocketPath());
  }

  private startHealthMonitor(): void {
    if (this.healthTimer) {
      return;
    }

    this.healthTimer = setInterval(() => {
      if (!this.daemon || this.startPromise) {
        return;
      }

      if (this.hasOwnedRuntime()) {
        return;
      }

      if (!this.notifiedUnhealthy) {
        this.notifiedUnhealthy = true;
        void showDaemonHealthNotification('unhealthy');
      }

      void this.restart()
        .then(() => {
          if (this.hasOwnedRuntime()) {
            this.notifiedUnhealthy = false;
            void showDaemonHealthNotification('recovered');
          }
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn('[desktop] local daemon health restart failed', error);
          void showDaemonHealthNotification('restart-failed', message);
        });
    }, 5000);
    this.healthTimer.unref?.();
  }

  private stopHealthMonitor(): void {
    if (!this.healthTimer) {
      return;
    }

    clearInterval(this.healthTimer);
    this.healthTimer = undefined;
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
    const runtime = resolveDesktopRuntimePaths();
    const logPath = `${runtime.desktopLogsDir}/daemon.log`;
    const logStream = createWriteStream(logPath, { flags: 'a', encoding: 'utf-8' });
    const daemon = new PersonalAgentDaemon({
      stopRequestBehavior: 'reject',
      logSink: (line) => {
        logStream.write(`${line}\n`);
      },
    });

    try {
      await daemon.start();
    } catch (error) {
      await daemon.stop().catch(() => undefined);
      await new Promise<void>((resolve) => logStream.end(resolve));
      throw error;
    }

    this.clearInProcessClientBinding?.();
    this.logStream?.end();
    this.clearInProcessClientBinding = bindInProcessDaemonClient(daemon);
    this.logStream = logStream;
    this.daemon = daemon;
    this.startHealthMonitor();
  }
}
