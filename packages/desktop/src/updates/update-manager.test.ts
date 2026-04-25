import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class FakeUpdater {
    autoDownload = false;
    autoInstallOnAppQuit = false;
    allowPrerelease = false;
    readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
    readonly checkForUpdates = vi.fn().mockResolvedValue(undefined);
    readonly quitAndInstall = vi.fn();

    on(event: string, listener: (...args: unknown[]) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }
  }

  return {
    FakeUpdater,
    lastUpdater: null as InstanceType<typeof FakeUpdater> | null,
    showMessageBox: vi.fn(),
    getVersion: vi.fn(() => '1.0.0'),
    resolveDesktopRuntimePaths: vi.fn(() => ({ desktopLogsDir: '/tmp/desktop-logs', colorIconFile: '/tmp/icon.png' })),
  };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: mocks.getVersion,
  },
  dialog: {
    showMessageBox: mocks.showMessageBox,
  },
}));

vi.mock('electron-updater', () => ({
  MacUpdater: class extends mocks.FakeUpdater {
    constructor() {
      super();
      mocks.lastUpdater = this;
    }
  },
}));

vi.mock('../desktop-env.js', () => ({
  resolveDesktopRuntimePaths: mocks.resolveDesktopRuntimePaths,
}));

import { DesktopUpdateManager } from './update-manager.js';

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DesktopUpdateManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.lastUpdater = null;
    mocks.showMessageBox.mockReset();
    mocks.getVersion.mockReset();
    mocks.getVersion.mockReturnValue('1.0.0');
    mocks.resolveDesktopRuntimePaths.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-installs downloaded updates immediately when auto-install is enabled', async () => {
    const onBeforeQuitForUpdate = vi.fn();

    const manager = new DesktopUpdateManager({
      onBeforeQuitForUpdate,
      shouldAutoInstallUpdates: () => true,
    });

    mocks.lastUpdater?.emit('update-downloaded', { version: '1.1.0' });
    await flushAsyncWork();

    expect(onBeforeQuitForUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.lastUpdater?.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toMatchObject({
      status: 'installing',
      downloadedVersion: '1.1.0',
    });

    manager.dispose();
  });

  it('shows an install popup when auto-install is disabled', async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 });
    const onBeforeQuitForUpdate = vi.fn();

    const manager = new DesktopUpdateManager({
      onBeforeQuitForUpdate,
      shouldAutoInstallUpdates: () => false,
    });

    mocks.lastUpdater?.emit('update-downloaded', { version: '1.1.0' });
    await flushAsyncWork();

    expect(mocks.showMessageBox).toHaveBeenCalledTimes(1);
    expect(mocks.showMessageBox).toHaveBeenCalledWith(expect.objectContaining({
      buttons: ['Later', 'Restart to Update'],
      message: 'Personal Agent 1.1.0 is ready to install',
    }));
    expect(onBeforeQuitForUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.lastUpdater?.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toMatchObject({
      status: 'installing',
      downloadedVersion: '1.1.0',
    });

    manager.dispose();
  });

  it('re-checks a downloaded update when auto-install is enabled later', async () => {
    let autoInstallEnabled = false;
    mocks.showMessageBox.mockResolvedValueOnce({ response: 0 });
    const onBeforeQuitForUpdate = vi.fn();

    const manager = new DesktopUpdateManager({
      onBeforeQuitForUpdate,
      shouldAutoInstallUpdates: () => autoInstallEnabled,
    });

    mocks.lastUpdater?.emit('update-downloaded', { version: '1.1.0' });
    await flushAsyncWork();

    expect(mocks.showMessageBox).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toMatchObject({
      status: 'ready',
      downloadedVersion: '1.1.0',
    });
    expect(onBeforeQuitForUpdate).not.toHaveBeenCalled();

    autoInstallEnabled = true;
    manager.preferencesChanged();
    await flushAsyncWork();

    expect(onBeforeQuitForUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.lastUpdater?.quitAndInstall).toHaveBeenCalledTimes(1);

    manager.dispose();
  });
});
