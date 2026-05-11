import { createWriteStream, type WriteStream } from 'node:fs';

import { bindInProcessDaemonClient, PersonalAgentDaemon } from '@personal-agent/daemon';

import { resolveDesktopRuntimePaths } from '../desktop-env.js';

interface LocalBackendStatus {
  daemonHealthy: boolean;
}

export class LocalBackendProcesses {
  private daemon?: PersonalAgentDaemon;
  private clearInProcessClientBinding?: () => void;
  private startPromise?: Promise<void>;
  private logStream?: WriteStream;

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

    if (this.logStream) {
      const stream = this.logStream;
      this.logStream = undefined;
      await new Promise<void>((resolve) => stream.end(resolve));
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
  }
}
