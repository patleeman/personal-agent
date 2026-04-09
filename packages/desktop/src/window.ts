import { BrowserWindow } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { getHostBrowserPartition } from './state/browser-partitions.js';
import type { HostManager } from './hosts/host-manager.js';

function resolvePreloadPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, 'preload.js');
}

export class DesktopWindowController {
  private mainWindow?: BrowserWindow;
  private currentPartition?: string;
  private quitting = false;

  constructor(private readonly hostManager: HostManager) {}

  setQuitting(value: boolean): void {
    this.quitting = value;
  }

  async openMainWindow(pathname = '/'): Promise<void> {
    const host = this.hostManager.getActiveHostRecord();
    const partition = getHostBrowserPartition(host.id);
    const baseUrl = await this.hostManager.getActiveHostBaseUrl();
    const targetUrl = new URL(pathname, baseUrl).toString();

    const window = this.ensureWindow(partition);
    if (window.webContents.getURL() !== targetUrl) {
      await window.loadURL(targetUrl);
    }

    if (!window.isVisible()) {
      window.show();
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window.focus();
  }

  async openAbsoluteUrl(url: string): Promise<void> {
    const host = this.hostManager.getActiveHostRecord();
    const partition = getHostBrowserPartition(host.id);
    const window = this.ensureWindow(partition);
    if (window.webContents.getURL() !== url) {
      await window.loadURL(url);
    }

    if (!window.isVisible()) {
      window.show();
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window.focus();
  }

  hideMainWindow(): void {
    this.mainWindow?.hide();
  }

  private ensureWindow(partition: string): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.currentPartition === partition) {
      return this.mainWindow;
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy();
    }

    this.currentPartition = partition;
    this.mainWindow = new BrowserWindow({
      show: false,
      width: 1440,
      height: 960,
      title: 'personal-agent',
      webPreferences: {
        preload: resolvePreloadPath(),
        partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.mainWindow.on('close', (event) => {
      if (this.quitting) {
        return;
      }

      event.preventDefault();
      this.mainWindow?.hide();
    });

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });

    return this.mainWindow;
  }
}
