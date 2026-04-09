import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { app, dialog, shell } from 'electron';
import { resolveDesktopRuntimePaths } from '../desktop-env.js';
import { loadDesktopConfig, saveDesktopConfig } from '../state/desktop-config.js';
import { downloadReleaseAssetWithGitHubCli, fetchLatestReleaseCandidate } from './github-releases.js';

const INITIAL_CHECK_DELAY_MS = 10_000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const UPDATE_DOWNLOADS_DIR_NAME = 'Personal Agent Updates';

function logUpdateMessage(message: string): void {
  try {
    const runtime = resolveDesktopRuntimePaths();
    appendFileSync(runtime.desktopLogsDir + '/main.log', `[${new Date().toISOString()}] [updates] ${message}\n`, 'utf-8');
  } catch {
    // Best-effort logging only.
  }
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
  private startupTimeoutHandle: NodeJS.Timeout | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;
  private activeCheck: Promise<void> | null = null;

  constructor() {
    if (!app.isPackaged) {
      logUpdateMessage('update checks disabled for unpackaged desktop runs');
    }
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

  async checkForUpdates(options: { userInitiated?: boolean } = {}): Promise<void> {
    if (!app.isPackaged) {
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
    logUpdateMessage('checking GitHub releases for updates');
    const candidate = await fetchLatestReleaseCandidate({
      currentVersion: this.currentVersion,
    });

    if (!candidate) {
      logUpdateMessage(`no newer GitHub release found for ${this.currentVersion}`);
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

    if (!options.userInitiated && readDismissedVersion() === candidate.version) {
      logUpdateMessage(`skipping dismissed release ${candidate.version}`);
      return;
    }

    const useGitHubCliDownload = candidate.source === 'github-cli' && candidate.downloadName !== null;
    const openLabel = useGitHubCliDownload
      ? 'Download Installer'
      : candidate.downloadUrl
        ? `Download ${candidate.downloadName ?? 'Update'}`
        : 'Open Release Page';
    const destination = candidate.downloadUrl ?? candidate.releaseUrl;
    const destinationLabel = useGitHubCliDownload
      ? 'Download the signed installer with GitHub CLI and open it automatically.'
      : candidate.downloadUrl
        ? 'Open the signed installer in your browser and install it manually.'
        : 'Open the GitHub release page in your browser and install it manually.';

    const response = await dialog.showMessageBox({
      type: 'info',
      buttons: ['Later', openLabel],
      defaultId: 1,
      cancelId: 0,
      message: `Personal Agent ${candidate.version} is available`,
      detail: [
        `Current version: ${this.currentVersion}`,
        `Latest version: ${candidate.version}`,
        destinationLabel,
      ].join('\n'),
    });

    if (response.response !== 1) {
      saveDismissedVersion(candidate.version);
      return;
    }

    saveDismissedVersion(null);

    if (useGitHubCliDownload && candidate.downloadName) {
      const downloadsDir = resolve(app.getPath('downloads'), UPDATE_DOWNLOADS_DIR_NAME);
      logUpdateMessage(`downloading release asset ${candidate.downloadName} for ${candidate.tagName} with GitHub CLI`);
      const download = await downloadReleaseAssetWithGitHubCli({
        tagName: candidate.tagName,
        assetName: candidate.downloadName,
        outputDir: downloadsDir,
      });
      logUpdateMessage(`downloaded ${candidate.downloadName} with ${download.command} to ${download.filePath}`);
      const openError = await shell.openPath(download.filePath);
      if (openError.trim().length > 0) {
        throw new Error(`Downloaded ${candidate.downloadName} to ${download.filePath}, but could not open it: ${openError}`);
      }
      return;
    }

    logUpdateMessage(`opening release download ${destination}`);
    await shell.openExternal(destination);
  }
}
