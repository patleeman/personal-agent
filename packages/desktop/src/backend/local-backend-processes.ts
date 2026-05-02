import { appendFileSync } from 'node:fs';

import { updateMachineConfigSection } from '@personal-agent/core';
import { bindInProcessDaemonClient, loadDaemonConfig, PersonalAgentDaemon, syncCompanionTailscaleServe } from '@personal-agent/daemon';

import { resolveDesktopRuntimePaths } from '../desktop-env.js';

interface LocalBackendStatus {
  daemonHealthy: boolean;
}

function isLoopbackHost(value: string | undefined): boolean {
  const normalized = value?.trim() || '';
  return (
    normalized === '' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === 'localhost' ||
    normalized === '::ffff:127.0.0.1'
  );
}

function readPortFromUrl(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = new URL(value);
    const port = Number.parseInt(parsed.port, 10);
    return Number.isInteger(port) && port > 0 ? port : undefined;
  } catch {
    return undefined;
  }
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

  async ensureCompanionNetworkReachable(): Promise<{ changed: boolean; url: string | null }> {
    await this.ensureStarted();
    if (!this.daemon) {
      throw new Error('Local desktop daemon is unavailable.');
    }

    const currentConfig = loadDaemonConfig();
    const currentHost = currentConfig.companion?.host ?? '127.0.0.1';
    const currentPort = currentConfig.companion?.port ?? 3843;
    const nextHost = isLoopbackHost(currentHost) ? '0.0.0.0' : currentHost;
    let changed = false;
    let url = this.daemon.getCompanionUrl();

    if (isLoopbackHost(currentHost) || currentConfig.companion?.enabled === false) {
      updateMachineConfigSection('daemon', (current) => {
        const next = current ? { ...current } : {};
        const existingCompanion =
          next.companion && typeof next.companion === 'object' ? { ...(next.companion as Record<string, unknown>) } : {};
        next.companion = {
          ...existingCompanion,
          enabled: true,
          host: nextHost,
        };
        return next;
      });

      const nextConfig = loadDaemonConfig();
      const result = await this.daemon.updateCompanionConfig({
        enabled: nextConfig.companion?.enabled,
        host: nextConfig.companion?.host,
        port: nextConfig.companion?.port,
      });
      changed = true;
      url = result.url;
    }

    try {
      syncCompanionTailscaleServe({
        enabled: true,
        port: readPortFromUrl(url) ?? currentPort,
      });
    } catch {
      // Tailnet publishing is best-effort for companion QR setup. Local-network pairing can still work without it.
    }

    return {
      changed,
      url,
    };
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
