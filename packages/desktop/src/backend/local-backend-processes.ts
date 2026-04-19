import { appendFileSync } from 'node:fs';
import { updateMachineConfigSection } from '@personal-agent/core';
import { PersonalAgentDaemon, bindInProcessDaemonClient, loadDaemonConfig, pingDaemon } from '@personal-agent/daemon';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import { clearDesktopDaemonOwnership, writeDesktopDaemonOwnership, type DesktopDaemonOwnership } from './daemon-ownership.js';

const EXTERNAL_DAEMON_CONFLICT_MESSAGE = 'A personal-agent daemon is already running outside the desktop app. The desktop app will not attach to it. Stop it with `pa daemon stop` or `pa daemon service uninstall`, then relaunch.';
const EXTERNAL_DAEMON_RESTART_MESSAGE = 'The desktop app does not own the running daemon. Restart it with `pa daemon restart` or stop the external daemon service first.';

interface LocalBackendStatus {
  daemonHealthy: boolean;
  daemonOwnership?: DesktopDaemonOwnership;
  blockedReason?: string;
}

function isLoopbackHost(value: string | undefined): boolean {
  const normalized = value?.trim() || '';
  return normalized === ''
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized === 'localhost'
    || normalized === '::ffff:127.0.0.1';
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
      throw new Error(EXTERNAL_DAEMON_CONFLICT_MESSAGE);
    }

    clearDesktopDaemonOwnership();
    await this.start();
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

  async ensureCompanionNetworkReachable(): Promise<{ changed: boolean; url: string | null }> {
    await this.ensureStarted();
    if (!this.daemon) {
      throw new Error('Local desktop daemon is unavailable.');
    }

    const currentConfig = loadDaemonConfig();
    const currentHost = currentConfig.companion?.host ?? '127.0.0.1';
    const nextHost = isLoopbackHost(currentHost) ? '0.0.0.0' : currentHost;
    if (!isLoopbackHost(currentHost) && currentConfig.companion?.enabled !== false) {
      return {
        changed: false,
        url: this.daemon.getCompanionUrl(),
      };
    }

    updateMachineConfigSection('daemon', (current) => {
      const next = current ? { ...current } : {};
      const existingCompanion = next.companion && typeof next.companion === 'object'
        ? { ...(next.companion as Record<string, unknown>) }
        : {};
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

    return {
      changed: true,
      url: result.url,
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
    if (await pingDaemon()) {
      writeDesktopDaemonOwnership('external');
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
