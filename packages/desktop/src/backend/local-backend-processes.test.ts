import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pingDaemon: vi.fn(),
  resolveDesktopRuntimePaths: vi.fn(),
  bindInProcessDaemonClient: vi.fn(),
  daemonInstances: [] as Array<{
    options: unknown;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    isRunning: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('@personal-agent/daemon', () => {
  class PersonalAgentDaemon {
    options: unknown;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    isRunning: ReturnType<typeof vi.fn>;

    constructor(options?: unknown) {
      this.options = options;
      this.start = vi.fn().mockResolvedValue(undefined);
      this.stop = vi.fn().mockResolvedValue(undefined);
      this.isRunning = vi.fn().mockReturnValue(true);
      mocks.daemonInstances.push(this);
    }
  }

  return {
    pingDaemon: mocks.pingDaemon,
    PersonalAgentDaemon,
    bindInProcessDaemonClient: mocks.bindInProcessDaemonClient,
  };
});

vi.mock('../desktop-env.js', () => ({
  resolveDesktopRuntimePaths: mocks.resolveDesktopRuntimePaths,
}));

import { LocalBackendProcesses } from './local-backend-processes.js';
import { readDesktopDaemonOwnership } from './daemon-ownership.js';

function lastDaemonInstance() {
  const instance = mocks.daemonInstances.at(-1);
  if (!instance) {
    throw new Error('Expected daemon instance');
  }

  return instance;
}

describe('LocalBackendProcesses', () => {
  afterEach(() => {
    delete process.env.PERSONAL_AGENT_DESKTOP_DAEMON_OWNERSHIP;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.daemonInstances.length = 0;
    delete process.env.PERSONAL_AGENT_DESKTOP_DAEMON_OWNERSHIP;

    mocks.resolveDesktopRuntimePaths.mockReturnValue({
      repoRoot: '/repo',
      nodeCommand: 'node',
      useElectronRunAsNode: false,
      daemonEntryFile: '/repo/packages/daemon/dist/index.js',
      webDistDir: '/repo/packages/web/dist',
      desktopStateDir: '/state/desktop',
      desktopLogsDir: '/state/desktop/logs',
      desktopConfigFile: '/state/desktop/config.json',
      trayTemplateIconFile: '/repo/packages/desktop/assets/icon-template.svg',
      colorIconFile: '/repo/packages/desktop/assets/icon-color.svg',
    });
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

  it('rejects startup in stable launches when an external daemon is already reachable', async () => {
    mocks.pingDaemon.mockResolvedValue(true);
    const backend = new LocalBackendProcesses();

    await expect(backend.ensureStarted()).rejects.toThrow(
      'A personal-agent daemon is already running outside the desktop app. The desktop app will not attach to it. Stop it with `pa daemon stop` or `pa daemon service uninstall`, then relaunch.',
    );

    expect(mocks.daemonInstances).toHaveLength(0);
    expect(readDesktopDaemonOwnership()).toBe('external');
  });

  it('rejects startup even in testing launches when an external daemon is already reachable', async () => {
    process.env.PERSONAL_AGENT_DESKTOP_VARIANT = 'testing';
    mocks.pingDaemon.mockResolvedValue(true);
    const backend = new LocalBackendProcesses();

    await expect(backend.ensureStarted()).rejects.toThrow(
      'A personal-agent daemon is already running outside the desktop app. The desktop app will not attach to it. Stop it with `pa daemon stop` or `pa daemon service uninstall`, then relaunch.',
    );

    expect(mocks.daemonInstances).toHaveLength(0);
    expect(readDesktopDaemonOwnership()).toBe('external');
  });

  it('reports stable launches as blocked when an external daemon is already running', async () => {
    mocks.pingDaemon.mockResolvedValue(true);
    const backend = new LocalBackendProcesses();

    await expect(backend.getStatus()).resolves.toEqual({
      daemonHealthy: false,
      daemonOwnership: 'external',
      blockedReason: 'A personal-agent daemon is already running outside the desktop app. The desktop app will not attach to it. Stop it with `pa daemon stop` or `pa daemon service uninstall`, then relaunch.',
    });
    expect(readDesktopDaemonOwnership()).toBe('external');
  });

  it('reports testing launches as blocked too when an external daemon is already running', async () => {
    process.env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE = '1';
    mocks.pingDaemon.mockResolvedValue(true);
    const backend = new LocalBackendProcesses();

    await expect(backend.getStatus()).resolves.toEqual({
      daemonHealthy: false,
      daemonOwnership: 'external',
      blockedReason: 'A personal-agent daemon is already running outside the desktop app. The desktop app will not attach to it. Stop it with `pa daemon stop` or `pa daemon service uninstall`, then relaunch.',
    });
    expect(readDesktopDaemonOwnership()).toBe('external');
  });

  it('marks owned daemons and clears ownership on stop', async () => {
    const cleanupBinding = vi.fn();
    mocks.bindInProcessDaemonClient.mockReturnValue(cleanupBinding);
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();
    expect(readDesktopDaemonOwnership()).toBe('owned');

    await backend.stop();

    expect(cleanupBinding).toHaveBeenCalledTimes(1);
    expect(lastDaemonInstance().stop).toHaveBeenCalledTimes(1);
    expect(readDesktopDaemonOwnership()).toBeUndefined();
  });

  it('restarts the owned daemon by creating a fresh in-process runtime', async () => {
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();
    const firstDaemon = lastDaemonInstance();

    await backend.restart();

    expect(firstDaemon.stop).toHaveBeenCalledTimes(1);
    expect(mocks.daemonInstances).toHaveLength(2);
    expect(readDesktopDaemonOwnership()).toBe('owned');
  });

  it('rejects desktop runtime restarts when attached to an external daemon', async () => {
    mocks.pingDaemon.mockResolvedValue(true);
    const backend = new LocalBackendProcesses();

    await expect(backend.restart()).rejects.toThrow(
      'The desktop app does not own the running daemon. Restart it with `pa daemon restart` or stop the external daemon service first.',
    );
    expect(readDesktopDaemonOwnership()).toBe('external');
  });

});
