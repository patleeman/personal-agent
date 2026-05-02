import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pingDaemon: vi.fn(),
  loadDaemonConfig: vi.fn(),
  syncCompanionTailscaleServe: vi.fn(),
  updateMachineConfigSection: vi.fn(),
  resolveDesktopRuntimePaths: vi.fn(),
  bindInProcessDaemonClient: vi.fn(),
  daemonInstances: [] as Array<{
    options: unknown;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    isRunning: ReturnType<typeof vi.fn>;
    getCompanionUrl: ReturnType<typeof vi.fn>;
    updateCompanionConfig: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@personal-agent/daemon', () => {
  class PersonalAgentDaemon {
    options: unknown;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    isRunning: ReturnType<typeof vi.fn>;
    getCompanionUrl: ReturnType<typeof vi.fn>;
    updateCompanionConfig: ReturnType<typeof vi.fn>;

    constructor(options?: unknown) {
      this.options = options;
      this.start = vi.fn().mockResolvedValue(undefined);
      this.stop = vi.fn().mockResolvedValue(undefined);
      this.isRunning = vi.fn().mockReturnValue(true);
      this.getCompanionUrl = vi.fn().mockReturnValue('http://127.0.0.1:3843');
      this.updateCompanionConfig = vi.fn().mockResolvedValue({ url: 'http://0.0.0.0:3843' });
      mocks.daemonInstances.push(this);
    }
  }

  return {
    pingDaemon: mocks.pingDaemon,
    loadDaemonConfig: mocks.loadDaemonConfig,
    syncCompanionTailscaleServe: mocks.syncCompanionTailscaleServe,
    PersonalAgentDaemon,
    bindInProcessDaemonClient: mocks.bindInProcessDaemonClient,
  };
});

vi.mock('@personal-agent/core', () => ({
  updateMachineConfigSection: mocks.updateMachineConfigSection,
}));

vi.mock('../desktop-env.js', () => ({
  resolveDesktopRuntimePaths: mocks.resolveDesktopRuntimePaths,
}));

import { LocalBackendProcesses } from './local-backend-processes.js';

function lastDaemonInstance() {
  const instance = mocks.daemonInstances.at(-1);
  if (!instance) {
    throw new Error('Expected daemon instance');
  }

  return instance;
}

describe('LocalBackendProcesses', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.daemonInstances.length = 0;

    mocks.resolveDesktopRuntimePaths.mockReturnValue({
      repoRoot: '/repo',
      nodeCommand: 'node',
      useElectronRunAsNode: false,
      daemonEntryFile: '/repo/packages/daemon/dist/index.js',
      webDistDir: '/repo/packages/desktop/ui/dist',
      desktopStateDir: '/state/desktop',
      desktopLogsDir: '/state/desktop/logs',
      desktopConfigFile: '/state/desktop/config.json',
      trayTemplateIconFile: '/repo/packages/desktop/assets/icon-template.svg',
      colorIconFile: '/repo/packages/desktop/assets/icon-color.svg',
    });
    mocks.loadDaemonConfig.mockReturnValue({
      companion: {
        enabled: true,
        host: '127.0.0.1',
        port: 3843,
      },
    });
    mocks.syncCompanionTailscaleServe.mockReset();
    mocks.syncCompanionTailscaleServe.mockImplementation(() => undefined);
    mocks.updateMachineConfigSection.mockImplementation((_, updater) => updater({}, {}));
    mocks.pingDaemon.mockResolvedValue(false);
    mocks.bindInProcessDaemonClient.mockReturnValue(vi.fn());
  });

  it('keeps the owned daemon warm instead of re-checking socket health on every ensureStarted call', async () => {
    const backend = new LocalBackendProcesses();

    await expect(backend.ensureStarted()).resolves.toBeUndefined();
    expect(mocks.daemonInstances).toHaveLength(1);
    expect(mocks.bindInProcessDaemonClient).toHaveBeenCalledTimes(1);
    expect(lastDaemonInstance().options).toMatchObject({ stopRequestBehavior: 'reject' });

    mocks.pingDaemon.mockReset();

    await expect(backend.ensureStarted()).resolves.toBeUndefined();

    expect(mocks.pingDaemon).not.toHaveBeenCalled();
  });

  it('reports healthy status when owned daemon is running', async () => {
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();
    await expect(backend.getStatus()).resolves.toEqual({
      daemonHealthy: true,
    });
  });

  it('reports unhealthy status when daemon has not been started', async () => {
    const backend = new LocalBackendProcesses();

    await expect(backend.getStatus()).resolves.toEqual({
      daemonHealthy: false,
    });
  });

  it('marks owned daemons and cleans up on stop', async () => {
    const cleanupBinding = vi.fn();
    mocks.bindInProcessDaemonClient.mockReturnValue(cleanupBinding);
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();

    await backend.stop();

    expect(cleanupBinding).toHaveBeenCalledTimes(1);
    expect(lastDaemonInstance().stop).toHaveBeenCalledTimes(1);
  });

  it('restarts the owned daemon by creating a fresh in-process runtime', async () => {
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();
    const firstDaemon = lastDaemonInstance();

    await backend.restart();

    expect(firstDaemon.stop).toHaveBeenCalledTimes(1);
    expect(mocks.daemonInstances).toHaveLength(2);
  });

  it('starts the daemon on restart if it was never started', async () => {
    const backend = new LocalBackendProcesses();

    await backend.restart();

    expect(mocks.daemonInstances).toHaveLength(1);
    expect(lastDaemonInstance().start).toHaveBeenCalledTimes(1);
  });

  it('enables local-network companion access without restarting the daemon', async () => {
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();
    const daemon = lastDaemonInstance();
    mocks.loadDaemonConfig
      .mockReturnValueOnce({ companion: { enabled: true, host: '127.0.0.1', port: 3843 } })
      .mockReturnValueOnce({ companion: { enabled: true, host: '0.0.0.0', port: 3843 } });

    await expect(backend.ensureCompanionNetworkReachable()).resolves.toEqual({
      changed: true,
      url: 'http://0.0.0.0:3843',
    });

    expect(mocks.updateMachineConfigSection).toHaveBeenCalledTimes(1);
    expect(daemon.updateCompanionConfig).toHaveBeenCalledWith({
      enabled: true,
      host: '0.0.0.0',
      port: 3843,
    });
    expect(mocks.syncCompanionTailscaleServe).toHaveBeenCalledWith({ enabled: true, port: 3843 });
    expect(daemon.stop).not.toHaveBeenCalled();
  });

  it('leaves companion access alone when it is already reachable on the network', async () => {
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();
    const daemon = lastDaemonInstance();
    mocks.loadDaemonConfig.mockReturnValue({ companion: { enabled: true, host: '0.0.0.0', port: 3843 } });

    await expect(backend.ensureCompanionNetworkReachable()).resolves.toEqual({
      changed: false,
      url: 'http://127.0.0.1:3843',
    });

    expect(mocks.updateMachineConfigSection).not.toHaveBeenCalled();
    expect(daemon.updateCompanionConfig).not.toHaveBeenCalled();
    expect(mocks.syncCompanionTailscaleServe).toHaveBeenCalledWith({ enabled: true, port: 3843 });
  });

  it('syncs companion publishing against the live listener port when startup had to fall back', async () => {
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();
    const daemon = lastDaemonInstance();
    daemon.getCompanionUrl.mockReturnValue('http://0.0.0.0:4021');
    mocks.loadDaemonConfig.mockReturnValue({ companion: { enabled: true, host: '0.0.0.0', port: 3843 } });

    await expect(backend.ensureCompanionNetworkReachable()).resolves.toEqual({
      changed: false,
      url: 'http://0.0.0.0:4021',
    });

    expect(mocks.updateMachineConfigSection).not.toHaveBeenCalled();
    expect(daemon.updateCompanionConfig).not.toHaveBeenCalled();
    expect(mocks.syncCompanionTailscaleServe).toHaveBeenCalledWith({ enabled: true, port: 4021 });
  });

  it('keeps local-network setup working even if companion tailnet publishing is unavailable', async () => {
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();
    mocks.syncCompanionTailscaleServe.mockImplementation(() => {
      throw new Error('tailscale unavailable');
    });

    await expect(backend.ensureCompanionNetworkReachable()).resolves.toEqual({
      changed: true,
      url: 'http://0.0.0.0:3843',
    });
  });
});
