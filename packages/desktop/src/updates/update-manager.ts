import { appendFileSync } from 'node:fs';
import { app, dialog } from 'electron';
import electronUpdater, { type AppUpdater, type UpdateDownloadedEvent } from 'electron-updater';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import { loadDesktopConfig, saveDesktopConfig } from '../state/desktop-config.js';
import {
  createProtectedUpdateAuthHeader,
  createProtectedUpdateFeedOptions,
  loadProtectedUpdateFeedConfig,
} from './protected-update-feed.js';

const { MacUpdater } = electronUpdater;

const INITIAL_CHECK_DELAY_MS = 10_000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

function logUpdateMessage(message: string): void {
  try {
    const runtime = resolveDesktopRuntimePaths();
    appendFileSync(runtime.desktopLogsDir + '/main.log', `[${new Date().toISOString()}] [updates] ${message}\n`, 'utf-8');
  } catch {
    // Best-effort logging only.
  }
}

function createUpdaterLogger() {
  return {
    info: (message?: unknown) => {
      logUpdateMessage(String(message ?? ''));
    },
    warn: (message?: unknown) => {
      logUpdateMessage(`warn: ${String(message ?? '')}`);
    },
    error: (message?: unknown) => {
      logUpdateMessage(`error: ${String(message ?? '')}`);
    },
    debug: (message?: unknown) => {
      logUpdateMessage(`debug: ${String(message ?? '')}`);
    },
  };
}

function readDismissedVersion(): string | null {
  return loadDesktopConfig().updates?.dismissedVersion?.trim() || null;
}

function saveDismissedVersion(version: string | null): void {
  const current = loadDesktopConfig();
  const next = {
    ...current,
    updates: version && version.trim().length > 0
      ? {
          ...current.updates,
          dismissedVersion: version.trim(),
        }
      : undefined,
  };
  saveDesktopConfig(next);
}

export class DesktopUpdateManager {
  private readonly currentVersion = app.getVersion();
  private readonly updater: AppUpdater | null;
  private startupTimeoutHandle: NodeJS.Timeout | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;
  private activeCheck: Promise<void> | null = null;
  private activeDownload: Promise<void> | null = null;
  private downloadedVersion: string | null = null;
  private downloadingVersion: string | null = null;
  private installPromptVersion: string | null = null;

  constructor() {
    const config = loadProtectedUpdateFeedConfig();
    if (!app.isPackaged) {
      logUpdateMessage('auto-update disabled for unpackaged desktop runs');
      this.updater = null;
      return;
    }

    if (!config) {
      logUpdateMessage('auto-update disabled: missing protected update feed config');
      this.updater = null;
      return;
    }

    const updater = new MacUpdater(createProtectedUpdateFeedOptions(config));
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.disableDifferentialDownload = true;
    updater.allowPrerelease = this.currentVersion.includes('-');
    updater.logger = createUpdaterLogger();
    updater.addAuthHeader(createProtectedUpdateAuthHeader(config));
    updater.on('checking-for-update', () => {
      logUpdateMessage(`checking for updates from ${config.url}`);
    });
    updater.on('download-progress', (progress) => {
      logUpdateMessage(`download ${progress.percent.toFixed(1)}% (${Math.round(progress.bytesPerSecond)} B/s)`);
    });
    updater.on('update-downloaded', (event) => {
      void this.handleUpdateDownloaded(event).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logUpdateMessage(`downloaded-update prompt failed: ${message}`);
      });
    });

    this.updater = updater;
  }

  start(): void {
    if (!this.updater) {
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
    this.updater?.removeAllListeners();
  }

  async checkForUpdates(options: { userInitiated?: boolean } = {}): Promise<void> {
    if (!this.updater) {
      if (options.userInitiated) {
        await dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message: 'Auto-update is not configured for this build',
          detail: 'Build the packaged app with a protected update feed token before checking for updates.',
        });
      }
      return;
    }

    if (this.downloadedVersion) {
      await this.promptToInstallDownloadedUpdate(this.downloadedVersion);
      return;
    }

    if (this.downloadingVersion) {
      if (options.userInitiated) {
        await dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message: `Personal Agent ${this.downloadingVersion} is downloading`,
          detail: 'You will be prompted to install it as soon as the download finishes.',
        });
      }
      return;
    }

    if (this.activeCheck) {
      return this.activeCheck;
    }

    this.activeCheck = this.performCheck(options)
      .catch(async (error) => {
        const message = error instanceof Error ? error.message : String(error);
        logUpdateMessage(`check failed: ${message}`);
        if (options.userInitiated) {
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
      });

    return this.activeCheck;
  }

  private async performCheck(options: { userInitiated?: boolean }): Promise<void> {
    const result = await this.updater!.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      if (options.userInitiated) {
        await dialog.showMessageBox({
          type: 'info',
          buttons: ['OK'],
          message: 'You’re up to date',
          detail: `Personal Agent ${this.currentVersion} is the latest available build.`,
        });
      }
      return;
    }

    const version = result.updateInfo.version;
    if (!options.userInitiated && readDismissedVersion() === version) {
      logUpdateMessage(`skipping dismissed release ${version}`);
      return;
    }

    const response = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Later', 'Download Update'],
      defaultId: 1,
      cancelId: 0,
      message: `Personal Agent ${version} is available`,
      detail: [
        `Current version: ${this.currentVersion}`,
        `Latest version: ${version}`,
        'Download the update now and install it from inside the app when it is ready.',
      ].join('\n'),
    });

    if (response.response !== 1) {
      saveDismissedVersion(version);
      return;
    }

    saveDismissedVersion(null);
    await this.downloadUpdate(version);
  }

  private async downloadUpdate(version: string): Promise<void> {
    if (!this.updater) {
      return;
    }

    if (this.activeDownload) {
      return this.activeDownload;
    }

    this.downloadingVersion = version;
    logUpdateMessage(`downloading update ${version}`);
    this.activeDownload = this.updater.downloadUpdate()
      .then(() => {
        logUpdateMessage(`download finished for ${version}`);
      })
      .finally(() => {
        this.activeDownload = null;
        this.downloadingVersion = null;
      });

    return this.activeDownload;
  }

  private async handleUpdateDownloaded(event: UpdateDownloadedEvent): Promise<void> {
    this.downloadedVersion = event.version;
    this.downloadingVersion = null;
    logUpdateMessage(`update downloaded: ${event.version}`);
    await this.promptToInstallDownloadedUpdate(event.version);
  }

  private async promptToInstallDownloadedUpdate(version: string): Promise<void> {
    if (!this.updater || this.installPromptVersion === version) {
      return;
    }

    this.installPromptVersion = version;
    try {
      const response = await dialog.showMessageBox({
        type: 'info',
        buttons: ['Later', 'Install and Relaunch'],
        defaultId: 1,
        cancelId: 0,
        message: `Personal Agent ${version} is ready to install`,
        detail: 'The update has been downloaded. Install it now to relaunch into the new build, or choose Later to keep running the current version.',
      });

      if (response.response === 1) {
        saveDismissedVersion(null);
        logUpdateMessage(`installing downloaded update ${version}`);
        this.updater.quitAndInstall();
        return;
      }

      saveDismissedVersion(version);
    } finally {
      this.installPromptVersion = null;
    }
  }
}
