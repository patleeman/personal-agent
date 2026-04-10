import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  beforeEach(() => {
    vi.clearAllMocks();

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

  it('does not spawn a new daemon when one is already reachable', async () => {
    mocks.pingDaemon.mockResolvedValue(true);
    const backend = new LocalBackendProcesses();

    await expect(backend.ensureStarted()).resolves.toBeUndefined();

    expect(mocks.spawnLoggedChild).not.toHaveBeenCalled();
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
});
