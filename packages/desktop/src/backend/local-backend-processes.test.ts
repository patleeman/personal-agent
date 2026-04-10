import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pingDaemon: vi.fn(),
  resolveDesktopRuntimePaths: vi.fn(),
  isWebUiHealthy: vi.fn(),
  waitForDaemonHealthy: vi.fn(),
  waitForWebUiHealthy: vi.fn(),
  assertTcpPortAvailable: vi.fn(),
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
  isWebUiHealthy: mocks.isWebUiHealthy,
  waitForDaemonHealthy: mocks.waitForDaemonHealthy,
  waitForWebUiHealthy: mocks.waitForWebUiHealthy,
}));

vi.mock('./ports.js', () => ({
  assertTcpPortAvailable: mocks.assertTcpPortAvailable,
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
      webServerEntryFile: '/repo/packages/web/dist-server/index.js',
      webDistDir: '/repo/packages/web/dist',
      desktopStateDir: '/state/desktop',
      desktopLogsDir: '/state/desktop/logs',
      desktopConfigFile: '/state/desktop/config.json',
      trayTemplateIconFile: '/repo/packages/desktop/assets/icon-template.svg',
      colorIconFile: '/repo/packages/desktop/assets/icon-color.svg',
    });
    mocks.pingDaemon.mockResolvedValue(false);
    mocks.isWebUiHealthy.mockResolvedValue(false);
    mocks.waitForDaemonHealthy.mockResolvedValue(undefined);
    mocks.waitForWebUiHealthy.mockResolvedValue(undefined);
    mocks.assertTcpPortAvailable.mockResolvedValue(undefined);
    mocks.stopManagedChild.mockResolvedValue(undefined);

    const daemonChild = createManagedChild('daemon');
    const webChild = createManagedChild('web-ui');
    mocks.spawnLoggedChild
      .mockReturnValueOnce(daemonChild)
      .mockReturnValueOnce(webChild);
  });

  it('keeps the owned runtime warm instead of re-checking health on every ensureStarted call', async () => {
    const backend = new LocalBackendProcesses();

    await expect(backend.ensureStarted()).resolves.toBe('http://127.0.0.1:3741');
    expect(mocks.spawnLoggedChild).toHaveBeenCalledTimes(2);

    mocks.pingDaemon.mockReset();
    mocks.isWebUiHealthy.mockReset();

    await expect(backend.ensureStarted()).resolves.toBe('http://127.0.0.1:3741');

    expect(mocks.pingDaemon).not.toHaveBeenCalled();
    expect(mocks.isWebUiHealthy).not.toHaveBeenCalled();
  });

  it('clears owned child references on exit so the next ensureStarted can recover', async () => {
    const backend = new LocalBackendProcesses();

    await backend.ensureStarted();

    const daemonExitHandler = mocks.spawnLoggedChild.mock.results[0]?.value.child.once.mock.calls[0]?.[1];
    const webExitHandler = mocks.spawnLoggedChild.mock.results[1]?.value.child.once.mock.calls[0]?.[1];

    daemonExitHandler?.(1, null);
    webExitHandler?.(1, null);

    mocks.pingDaemon.mockResolvedValue(false);
    mocks.isWebUiHealthy.mockResolvedValue(false);
    mocks.spawnLoggedChild
      .mockReturnValueOnce(createManagedChild('daemon-restart'))
      .mockReturnValueOnce(createManagedChild('web-ui-restart'));

    await backend.ensureStarted();

    expect(mocks.spawnLoggedChild).toHaveBeenCalledTimes(4);
  });
});
