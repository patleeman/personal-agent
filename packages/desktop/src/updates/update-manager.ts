import { appendFileSync } from 'node:fs';

import { app, dialog } from 'electron';
import { type AppUpdater, MacUpdater, type UpdateDownloadedEvent, type UpdateInfo } from 'electron-updater';

import { resolveDesktopRuntimePaths } from '../desktop-env.js';

const INITIAL_CHECK_DELAY_MS = 10_000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

export type DesktopUpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'installing' | 'error';

export interface DesktopAppUpdateState {
  supported: boolean;
  currentVersion: string;
  status: DesktopUpdateStatus;
  availableVersion?: string;
  downloadedVersion?: string;
  lastCheckedAt?: string;
  lastError?: string;
}

function logUpdateMessage(message: string): void {
  try {
    const runtime = resolveDesktopRuntimePaths();
    appendFileSync(runtime.desktopLogsDir + '/main.log', `[${new Date().toISOString()}] [updates] ${message}\n`, 'utf-8');
  } catch {
    // Best-effort logging only.
  }
}

function createDesktopUpdater(currentVersion: string): AppUpdater {
  const updater = new MacUpdater();
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = currentVersion.includes('-');
  return updater;
}

function renderUpdateErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return String(error);
}

function createDefaultDesktopAppUpdateState(currentVersion: string): DesktopAppUpdateState {
  return {
    supported: app.isPackaged,
    currentVersion,
    status: 'idle',
  };
}

export class DesktopUpdateManager {
  private readonly currentVersion = app.getVersion();
  private readonly updater: AppUpdater | null;
  private readonly state: DesktopAppUpdateState;
  private startupTimeoutHandle: NodeJS.Timeout | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;
  private activeCheck: Promise<void> | null = null;
  private currentCheckUserInitiated = false;
  private currentCheckHadError = false;
  private downloadedUpdate: UpdateDownloadedEvent | null = null;
  private promptingForInstall = false;
  private installingDownloadedUpdate = false;

  constructor(
    private readonly options: {
      onBeforeQuitForUpdate?: () => Promise<void> | void;
      shouldAutoInstallUpdates?: () => boolean;
    } = {},
  ) {
    this.state = createDefaultDesktopAppUpdateState(this.currentVersion);

    if (!app.isPackaged) {
      this.updater = null;
      logUpdateMessage('update checks disabled for unpackaged desktop runs');
      return;
    }

    this.updater = createDesktopUpdater(this.currentVersion);
    this.registerUpdaterEvents();
  }

  getState(): DesktopAppUpdateState {
    return { ...this.state };
  }

  start(): void {
    if (!app.isPackaged) {
      return;
    }

    this.startupTimeoutHandle = setTimeout(() => {
      void this.checkForUpdates();
    }, INITIAL_CHECK_DELAY_MS);
    this.intervalHandle = setInterval(() => {
      void this.checkForUpdates();
    }, RECHECK_INTERVAL_MS);
  }

  dispose(): void {
    if (this.startupTimeoutHandle) {
      clearTimeout(this.startupTimeoutHandle);
      this.startupTimeoutHandle = null;
    }
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  preferencesChanged(): void {
    if (!this.downloadedUpdate) {
      return;
    }

    if (!this.shouldAutoInstallUpdates()) {
      this.setState({
        status: 'ready',
        downloadedVersion: this.downloadedUpdate.version,
        lastError: undefined,
      });
      return;
    }

    void this.maybeAutoInstallDownloadedUpdate();
  }

  async checkForUpdates(options: { userInitiated?: boolean } = {}): Promise<void> {
    if (!app.isPackaged || !this.updater) {
      if (options.userInitiated) {
        await dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message: 'Update checks are only available in packaged desktop builds',
          detail: 'Build or install the signed desktop app to check for releases from the app menu.',
        });
      }
      return;
    }

    if (this.downloadedUpdate) {
      if (this.shouldAutoInstallUpdates()) {
        await this.maybeAutoInstallDownloadedUpdate();
        return;
      }

      if (options.userInitiated) {
        await this.promptToInstall(this.downloadedUpdate);
      }
      return;
    }

    if (this.activeCheck) {
      return this.activeCheck;
    }

    this.currentCheckUserInitiated = Boolean(options.userInitiated);
    this.currentCheckHadError = false;
    this.setState({
      status: 'checking',
      availableVersion: undefined,
      downloadedVersion: undefined,
      lastCheckedAt: new Date().toISOString(),
      lastError: undefined,
    });

    this.activeCheck = this.performCheck()
      .catch(async (error) => {
        const message = renderUpdateErrorMessage(error);
        if (!this.currentCheckHadError) {
          logUpdateMessage(`check failed: ${message}`);
        }
        this.setState({
          status: 'error',
          lastCheckedAt: new Date().toISOString(),
          lastError: message,
        });
        if (this.currentCheckUserInitiated && !this.currentCheckHadError) {
          await dialog.showMessageBox({
            type: 'error',
            buttons: ['OK'],
            message: 'Could not check for updates',
            detail: message,
          });
        }
      })
      .finally(() => {
        this.activeCheck = null;
        this.currentCheckUserInitiated = false;
        this.currentCheckHadError = false;
      });

    return this.activeCheck;
  }

  private registerUpdaterEvents(): void {
    if (!this.updater) {
      return;
    }

    this.updater.on('checking-for-update', () => {
      logUpdateMessage('checking configured desktop update feed for updates');
    });

    this.updater.on('update-available', (info: UpdateInfo) => {
      logUpdateMessage(`update ${info.version} is available; download started`);
      this.setState({
        status: 'downloading',
        availableVersion: info.version,
        downloadedVersion: undefined,
        lastCheckedAt: new Date().toISOString(),
        lastError: undefined,
      });
      if (this.currentCheckUserInitiated) {
        void dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message: `Personal Agent ${info.version} is downloading`,
          detail: [
            `Current version: ${this.currentVersion}`,
            `Latest version: ${info.version}`,
            'The update is downloading in the background and will be ready to install when it finishes.',
          ].join('\n'),
        });
      }
    });

    this.updater.on('update-not-available', (info: UpdateInfo) => {
      logUpdateMessage(`no newer release found; current=${this.currentVersion} latest=${info.version}`);
      this.setState({
        status: 'idle',
        availableVersion: undefined,
        downloadedVersion: undefined,
        lastCheckedAt: new Date().toISOString(),
        lastError: undefined,
      });
      if (this.currentCheckUserInitiated) {
        void dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message: 'You’re up to date',
          detail: `Personal Agent ${this.currentVersion} is the latest available build.`,
        });
      }
    });

    this.updater.on('update-downloaded', (info: UpdateDownloadedEvent) => {
      this.downloadedUpdate = info;
      logUpdateMessage(`update ${info.version} finished downloading`);
      this.setState({
        status: 'ready',
        availableVersion: info.version,
        downloadedVersion: info.version,
        lastCheckedAt: new Date().toISOString(),
        lastError: undefined,
      });

      if (this.shouldAutoInstallUpdates()) {
        void this.maybeAutoInstallDownloadedUpdate();
        return;
      }

      void this.promptToInstall(info);
    });

    this.updater.on('error', (error: unknown) => {
      const message = renderUpdateErrorMessage(error);
      this.currentCheckHadError = true;
      logUpdateMessage(`update error: ${message}`);
      this.setState({
        status: 'error',
        lastCheckedAt: new Date().toISOString(),
        lastError: message,
      });
      if (this.currentCheckUserInitiated) {
        void dialog.showMessageBox({
          type: 'error',
          buttons: ['OK'],
          message: 'Could not check for updates',
          detail: message,
        });
      }
    });
  }

  private async performCheck(): Promise<void> {
    if (!this.updater) {
      return;
    }

    await this.updater.checkForUpdates();
  }

  private shouldAutoInstallUpdates(): boolean {
    return this.options.shouldAutoInstallUpdates?.() === true;
  }

  private async maybeAutoInstallDownloadedUpdate(): Promise<void> {
    if (!this.updater || !this.downloadedUpdate || this.promptingForInstall || this.installingDownloadedUpdate) {
      return;
    }

    if (!this.shouldAutoInstallUpdates()) {
      return;
    }
    await this.installDownloadedUpdate(this.downloadedUpdate);
  }

  private async promptToInstall(info: UpdateDownloadedEvent): Promise<void> {
    if (!this.updater || this.promptingForInstall || this.installingDownloadedUpdate) {
      return;
    }

    this.promptingForInstall = true;
    try {
      const response = await dialog.showMessageBox({
        type: 'info',
        buttons: ['Later', 'Restart to Update'],
        defaultId: 1,
        cancelId: 0,
        message: `Personal Agent ${info.version} is ready to install`,
        detail: [
          `Current version: ${this.currentVersion}`,
          `Updated version: ${info.version}`,
          'Restart Personal Agent now to finish installing the update.',
        ].join('\n'),
      });

      if (response.response !== 1) {
        logUpdateMessage(`update ${info.version} downloaded; install postponed`);
        this.setState({
          status: 'ready',
          downloadedVersion: info.version,
        });
        return;
      }

      await this.installDownloadedUpdate(info);
    } finally {
      this.promptingForInstall = false;
    }
  }

  private async installDownloadedUpdate(info: UpdateDownloadedEvent): Promise<void> {
    if (!this.updater || this.installingDownloadedUpdate) {
      return;
    }

    this.installingDownloadedUpdate = true;
    this.setState({
      status: 'installing',
      downloadedVersion: info.version,
      lastError: undefined,
    });

    try {
      logUpdateMessage(`installing downloaded update ${info.version}`);
      await this.options.onBeforeQuitForUpdate?.();
      this.updater.quitAndInstall();
    } catch (error) {
      const message = renderUpdateErrorMessage(error);
      logUpdateMessage(`failed to install downloaded update: ${message}`);
      this.setState({
        status: 'error',
        downloadedVersion: info.version,
        lastError: message,
      });
      await dialog.showMessageBox({
        type: 'error',
        buttons: ['OK'],
        message: 'Could not install the downloaded update',
        detail: message,
      });
    } finally {
      this.installingDownloadedUpdate = false;
    }
  }

  private setState(patch: Partial<DesktopAppUpdateState>): void {
    Object.assign(this.state, patch);
  }
}
