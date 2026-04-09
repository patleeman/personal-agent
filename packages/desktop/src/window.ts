import { BrowserWindow } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import { loadDesktopConfig, updateDesktopWindowState } from './state/desktop-config.js';
import { getHostBrowserPartition } from './state/browser-partitions.js';
import type { HostManager } from './hosts/host-manager.js';

function resolvePreloadPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, 'preload.js');
}

export interface DesktopNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

function toDesktopShellUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('desktop-shell', '1');
  return parsed.toString();
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
    const targetUrl = toDesktopShellUrl(new URL(pathname, baseUrl).toString());

    const window = this.ensureWindow(partition);
    await window.webContents.session.clearCache();
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
    const targetUrl = toDesktopShellUrl(url);
    const window = this.ensureWindow(partition);
    await window.webContents.session.clearCache();
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

  hideMainWindow(): void {
    this.mainWindow?.hide();
  }

  getNavigationState(): DesktopNavigationState {
    return {
      canGoBack: this.mainWindow?.webContents.canGoBack() ?? false,
      canGoForward: this.mainWindow?.webContents.canGoForward() ?? false,
    };
  }

  async goBack(): Promise<DesktopNavigationState> {
    if (this.mainWindow?.webContents.canGoBack()) {
      this.mainWindow.webContents.goBack();
      await delay(120);
    }

    return this.getNavigationState();
  }

  async goForward(): Promise<DesktopNavigationState> {
    if (this.mainWindow?.webContents.canGoForward()) {
      this.mainWindow.webContents.goForward();
      await delay(120);
    }

    return this.getNavigationState();
  }

  private ensureWindow(partition: string): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.currentPartition === partition) {
      return this.mainWindow;
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy();
    }

    const config = loadDesktopConfig();
    const savedWindowState = config.windowState ?? { width: 1440, height: 960 };
    const runtime = resolveDesktopRuntimePaths();

    this.currentPartition = partition;
    this.mainWindow = new BrowserWindow({
      show: false,
      width: savedWindowState.width,
      height: savedWindowState.height,
      ...(typeof savedWindowState.x === 'number' ? { x: savedWindowState.x } : {}),
      ...(typeof savedWindowState.y === 'number' ? { y: savedWindowState.y } : {}),
      title: 'Personal Agent',
      icon: runtime.colorIconFile,
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 8 } : undefined,
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

    this.mainWindow.on('moved', () => {
      this.persistWindowBounds();
    });

    this.mainWindow.on('resized', () => {
      this.persistWindowBounds();
    });

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });

    return this.mainWindow;
  }

  private persistWindowBounds(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }

    const bounds = this.mainWindow.getBounds();
    updateDesktopWindowState({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }
}
