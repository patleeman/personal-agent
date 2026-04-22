import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class FakeUpdater {
    autoDownload = false;
    autoInstallOnAppQuit = false;
    allowPrerelease = false;
    readonly listeners = new Map<string, Array<(...args: any[]) => void>>();
    readonly checkForUpdates = vi.fn().mockResolvedValue(undefined);
    readonly quitAndInstall = vi.fn();

    on(event: string, listener: (...args: any[]) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, ...args: any[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }
  }

  class FakeNotification {
    static isSupported = vi.fn(() => true);
    readonly listeners = new Map<string, Array<(...args: any[]) => void>>();
    readonly show = vi.fn();

    constructor(readonly options: Record<string, unknown>) {
      mocks.notifications.push(this);
    }

    on(event: string, listener: (...args: any[]) => void): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, ...args: any[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }
  }

  return {
    FakeUpdater,
    FakeNotification,
    notifications: [] as Array<InstanceType<typeof FakeNotification>>,
    lastUpdater: null as InstanceType<typeof FakeUpdater> | null,
    showMessageBox: vi.fn(),
    getVersion: vi.fn(() => '1.0.0'),
    resolveDesktopRuntimePaths: vi.fn(() => ({ desktopLogsDir: '/tmp/desktop-logs', colorIconFile: '/tmp/icon.png' })),
  };
});

vi.mock('electron', () => ({
  Notification: mocks.FakeNotification,
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
    mocks.notifications.length = 0;
    mocks.showMessageBox.mockReset();
    mocks.getVersion.mockReset();
    mocks.getVersion.mockReturnValue('1.0.0');
    mocks.resolveDesktopRuntimePaths.mockClear();
    mocks.FakeNotification.isSupported.mockReset();
    mocks.FakeNotification.isSupported.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for idle before auto-installing downloaded updates and notifies once while waiting', async () => {
    const onBeforeQuitForUpdate = vi.fn();
    const onShowUpdateStatusUi = vi.fn();
    const checkIdleForAutoInstall = vi.fn<() => Promise<{ idle: boolean; reason?: string }>>()
      .mockResolvedValueOnce({ idle: false, reason: 'Durable runs are still active.' })
      .mockResolvedValueOnce({ idle: true });

    const manager = new DesktopUpdateManager({
      onBeforeQuitForUpdate,
      onShowUpdateStatusUi,
      shouldAutoInstallUpdates: () => true,
      checkIdleForAutoInstall,
    });

    mocks.lastUpdater?.emit('update-downloaded', { version: '1.1.0' });
    await flushAsyncWork();

    expect(checkIdleForAutoInstall).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toMatchObject({
      status: 'waiting-for-idle',
      downloadedVersion: '1.1.0',
      waitingForIdleReason: 'Durable runs are still active.',
    });
    expect(mocks.notifications).toHaveLength(1);
    expect(mocks.notifications[0]?.options).toMatchObject({
      title: 'Personal Agent 1.1.0 is ready to install',
      body: 'It will install automatically once the desktop goes idle. Durable runs are still active.',
      icon: '/tmp/icon.png',
    });
    expect(mocks.notifications[0]?.show).toHaveBeenCalledTimes(1);
    mocks.notifications[0]?.emit('click');
    expect(onShowUpdateStatusUi).toHaveBeenCalledTimes(1);
    expect(onBeforeQuitForUpdate).not.toHaveBeenCalled();
    expect(mocks.lastUpdater?.quitAndInstall).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(30_000);
    await flushAsyncWork();

    expect(checkIdleForAutoInstall).toHaveBeenCalledTimes(2);
    expect(mocks.notifications).toHaveLength(1);
    expect(onBeforeQuitForUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.lastUpdater?.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(manager.getState()).toMatchObject({
      status: 'installing',
      downloadedVersion: '1.1.0',
    });

    manager.dispose();
  });

  it('prompts to install when auto-install is disabled', async () => {
    mocks.showMessageBox.mockResolvedValueOnce({ response: 1 });
    const onBeforeQuitForUpdate = vi.fn();

    const manager = new DesktopUpdateManager({
      onBeforeQuitForUpdate,
      shouldAutoInstallUpdates: () => false,
    });

    mocks.lastUpdater?.emit('update-downloaded', { version: '1.1.0' });
    await flushAsyncWork();

    expect(mocks.showMessageBox).toHaveBeenCalledTimes(1);
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
    const checkIdleForAutoInstall = vi.fn().mockResolvedValue({ idle: true });

    const manager = new DesktopUpdateManager({
      onBeforeQuitForUpdate,
      shouldAutoInstallUpdates: () => autoInstallEnabled,
      checkIdleForAutoInstall,
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

    expect(checkIdleForAutoInstall).toHaveBeenCalledTimes(1);
    expect(onBeforeQuitForUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.lastUpdater?.quitAndInstall).toHaveBeenCalledTimes(1);

    manager.dispose();
  });
});
