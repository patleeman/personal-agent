import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pingDaemon: vi.fn(),
  resolveDesktopRuntimePaths: vi.fn(),
  waitForDaemonHealthy: vi.fn(),
  spawnLoggedChild: vi.fn(),
  stopManagedChild: vi.fn(),
}));

vi.mock('@personal-agent/daemon', () => ({
  pingDaemon: mocks.pingDaemon,
}));

vi.mock('../desktop-env.js', () => ({
  resolveDesktopRuntimePaths: mocks.resolveDesktopRuntimePaths,
}));

vi.mock('./health.js', () => ({
  waitForDaemonHealthy: mocks.waitForDaemonHealthy,
}));

vi.mock('./child-process.js', () => ({
  spawnLoggedChild: mocks.spawnLoggedChild,
  stopManagedChild: mocks.stopManagedChild,
}));

import { LocalBackendProcesses } from './local-backend-processes.js';
import { readDesktopDaemonOwnership } from './daemon-ownership.js';

function createManagedChild(label: string) {
  return {
    child: {
      exitCode: null,
      killed: false,
      once: vi.fn(),
    },
    logPath: `/logs/${label}.log`,
  };
}

describe('LocalBackendProcesses', () => {
  afterEach(() => {
    delete process.env.PERSONAL_AGENT_DESKTOP_DAEMON_OWNERSHIP;
    delete process.env.PERSONAL_AGENT_DESKTOP_VARIANT;
    delete process.env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PERSONAL_AGENT_DESKTOP_DAEMON_OWNERSHIP;
    delete process.env.PERSONAL_AGENT_DESKTOP_VARIANT;
    delete process.env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE;

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
    mocks.waitForDaemonHealthy.mockResolvedValue(undefined);
    mocks.stopManagedChild.mockResolvedValue(undefined);
    mocks.spawnLoggedChild.mockReturnValue(createManagedChild('daemon'));
  });

  it('keeps the owned daemon warm instead of re-checking health on every ensureStarted call', async () => {
    const backend = new LocalBackendProcesses();

    await expect(backend.ensureStarted()).resolves.toBeUndefined();
    expect(mocks.spawnLoggedChild).toHaveBeenCalledTimes(1);

    mocks.pingDaemon.mockReset();

    await expect(backend.ensureStarted()).resolves.toBeUndefined();

    expect(mocks.pingDaemon).not.toHaveBeenCalled();
  });

  it('rejects startup in stable launches when an external daemon is already reachable', async () => {
    mocks.pingDaemon.mockResolvedValue(true);
    const backend = new LocalBackendProcesses();

    await expect(backend.ensureStarted()).rejects.toThrow(
      'A personal-agent daemon is already running outside the desktop app. Stable desktop builds will not attach to it. Stop it with `pa daemon stop` or `pa daemon service uninstall`, then relaunch.',
    );

    expect(mocks.spawnLoggedChild).not.toHaveBeenCalled();
    expect(readDesktopDaemonOwnership()).toBe('external');
  });

  it('allows testing launches to reuse an external daemon that becomes reachable during startup', async () => {
    process.env.PERSONAL_AGENT_DESKTOP_VARIANT = 'testing';
    mocks.pingDaemon
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const backend = new LocalBackendProcesses();

    await expect(backend.ensureStarted()).resolves.toBeUndefined();

    expect(mocks.spawnLoggedChild).not.toHaveBeenCalled();
    expect(mocks.waitForDaemonHealthy).not.toHaveBeenCalled();
    expect(readDesktopDaemonOwnership()).toBe('external');
  });

  it('reports stable launches as blocked when an external daemon is already running', async () => {
    mocks.pingDaemon.mockResolvedValue(true);
    const backend = new LocalBackendProcesses();

    await expect(backend.getStatus()).resolves.toEqual({
      daemonHealthy: false,
      daemonOwnership: 'external',
      blockedReason: 'A personal-agent daemon is already running outside the desktop app. Stable desktop builds will not attach to it. Stop it with `pa daemon stop` or `pa daemon service uninstall`, then relaunch.',
    });
    expect(readDesktopDaemonOwnership()).toBe('external');
  });

  it('reports testing launches as attached when an external daemon is already running', async () => {
    process.env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE = '1';
    mocks.pingDaemon.mockResolvedValue(true);
    const backend = new LocalBackendProcesses();

    await expect(backend.getStatus()).resolves.toEqual({
      daemonHealthy: true,
      daemonOwnership: 'external',
    });
    expect(readDesktopDaemonOwnership()).toBe('external');
  });

  it('marks owned daemons and clears ownership on stop or exit', async () => {
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();
    expect(readDesktopDaemonOwnership()).toBe('owned');

    await backend.stop();
    expect(readDesktopDaemonOwnership()).toBeUndefined();

    mocks.spawnLoggedChild.mockReturnValueOnce(createManagedChild('daemon-restart'));
    await backend.ensureStarted();
    expect(readDesktopDaemonOwnership()).toBe('owned');

    const daemonExitHandler = mocks.spawnLoggedChild.mock.results[1]?.value.child.once.mock.calls[0]?.[1];
    daemonExitHandler?.(1, null);
    expect(readDesktopDaemonOwnership()).toBeUndefined();
  });

  it('clears owned child references on exit so the next ensureStarted can recover', async () => {
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();

    const daemonExitHandler = mocks.spawnLoggedChild.mock.results[0]?.value.child.once.mock.calls[0]?.[1];
    daemonExitHandler?.(1, null);

    mocks.pingDaemon.mockResolvedValue(false);
    mocks.spawnLoggedChild.mockReturnValueOnce(createManagedChild('daemon-restart'));

    await backend.ensureStarted();

    expect(mocks.spawnLoggedChild).toHaveBeenCalledTimes(2);
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
