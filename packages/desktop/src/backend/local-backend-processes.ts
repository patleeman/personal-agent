import { appendFileSync } from 'node:fs';

import { bindInProcessDaemonClient, PersonalAgentDaemon } from '@personal-agent/daemon';

import { resolveDesktopRuntimePaths } from '../desktop-env.js';

interface LocalBackendStatus {
  daemonHealthy: boolean;
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
    this.clearInProcessClientBinding?.();
    this.clearInProcessClientBinding = undefined;

    if (this.daemon) {
      await this.daemon.stop();
      this.daemon = undefined;
    }
  }

  private hasOwnedRuntime(): boolean {
    return this.daemon?.isRunning() === true;
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
    const daemon = new PersonalAgentDaemon({
      stopRequestBehavior: 'reject',
      logSink: (line) => {
        appendFileSync(logPath, `${line}\n`, 'utf-8');
      },
    });

    try {
      await daemon.start();
    } catch (error) {
      await daemon.stop().catch(() => undefined);
      throw error;
    }

    this.clearInProcessClientBinding?.();
    this.clearInProcessClientBinding = bindInProcessDaemonClient(daemon);
    this.daemon = daemon;
  }
}
