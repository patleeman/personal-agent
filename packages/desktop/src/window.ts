import { BrowserWindow } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import { loadDesktopConfig, updateDesktopWindowState } from './state/desktop-config.js';
import { getHostBrowserPartition } from './state/browser-partitions.js';
import type { HostManager } from './hosts/host-manager.js';
import type { DesktopHostRecord } from './hosts/types.js';

function resolvePreloadPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, 'preload.cjs');
}

export interface DesktopNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

export type DesktopRendererShortcutAction =
  | 'close-conversation'
  | 'previous-conversation'
  | 'next-conversation'
  | 'toggle-sidebar'
  | 'toggle-right-rail'
  | 'toggle-conversation-pin'
  | 'toggle-conversation-archive'
  | 'focus-composer'
  | 'edit-working-directory'
  | 'rename-conversation';

type ManagedWindowRole = 'main' | 'remote';

const DESKTOP_NAVIGATE_CHANNEL = 'personal-agent-desktop:navigate';

export function toDesktopShellUrl(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.set('desktop-shell', '1');
  return parsed.toString();
}

export function toDesktopShellRoute(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete('desktop-shell');
  const route = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return route || '/';
}

export function canNavigateWindowInApp(currentUrl: string, targetUrl: string): boolean {
  if (!currentUrl || !targetUrl) {
    return false;
  }

  try {
    const current = new URL(currentUrl);
    const target = new URL(targetUrl);
    return current.origin === target.origin;
  } catch {
    return false;
  }
}

function buildWindowTitle(host: DesktopHostRecord): string {
  if (host.kind === 'local') {
    return 'Personal Agent';
  }

  const kindLabel = host.kind === 'web' ? 'Web remote' : 'SSH remote';
  return `Personal Agent — ${host.label} (${kindLabel})`;
}

export class DesktopWindowController {
  private mainWindow?: BrowserWindow;
  private currentPartition?: string;
  private quitting = false;
  private remoteWindows = new Map<string, BrowserWindow>();
  private trackedWindows = new Map<number, {
    hostId: string;
    role: ManagedWindowRole;
    window: BrowserWindow;
  }>();

  constructor(private readonly hostManager: HostManager) {}

  setQuitting(value: boolean): void {
    this.quitting = value;
  }

  async openMainWindow(pathname = '/'): Promise<void> {
    await this.openWindowForHost(this.hostManager.getActiveHostId(), pathname, 'main');
  }

  async openHostWindow(hostId: string, pathname = '/'): Promise<void> {
    const role: ManagedWindowRole = hostId === this.hostManager.getActiveHostId() ? 'main' : 'remote';
    await this.openWindowForHost(hostId, pathname, role);
  }

  async openAbsoluteUrl(url: string): Promise<void> {
    await this.openHostAbsoluteUrl(this.hostManager.getActiveHostId(), url);
  }

  async openHostAbsoluteUrl(hostId: string, url: string): Promise<void> {
    const role: ManagedWindowRole = hostId === this.hostManager.getActiveHostId() ? 'main' : 'remote';
    await this.openWindowToUrl(hostId, url, role);
  }

  async openAbsoluteUrlInWindow(webContentsId: number, url: string): Promise<void> {
    const existing = this.trackedWindows.get(webContentsId);
    if (!existing || existing.window.isDestroyed()) {
      await this.openAbsoluteUrl(url);
      return;
    }

    await this.loadWindowUrl(existing.window, url);
  }

  hideMainWindow(): void {
    this.mainWindow?.hide();
  }

  hideFocusedWindow(): void {
    const targetWindow = BrowserWindow.getFocusedWindow() ?? this.mainWindow;
    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }

    targetWindow.hide();
  }

  getMainWindowRoute(): string {
    const currentUrl = this.mainWindow?.webContents.getURL();
    if (!currentUrl) {
      return '/';
    }

    try {
      const parsed = new URL(currentUrl);
      parsed.searchParams.delete('desktop-shell');
      const route = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      return route || '/';
    } catch {
      return '/';
    }
  }

  getHostIdForWebContentsId(webContentsId: number): string | null {
    return this.trackedWindows.get(webContentsId)?.hostId ?? null;
  }

  getNavigationStateForWebContents(webContentsId: number): DesktopNavigationState {
    return this.getNavigationState(this.trackedWindows.get(webContentsId)?.window);
  }

  async goBackForWebContents(webContentsId: number): Promise<DesktopNavigationState> {
    return this.goBack(this.trackedWindows.get(webContentsId)?.window);
  }

  async goForwardForWebContents(webContentsId: number): Promise<DesktopNavigationState> {
    return this.goForward(this.trackedWindows.get(webContentsId)?.window);
  }

  sendShortcutToFocusedWindow(action: DesktopRendererShortcutAction): void {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const trackedWindow = focusedWindow ? this.trackedWindows.get(focusedWindow.webContents.id)?.window : undefined;
    const targetWindow = trackedWindow ?? this.mainWindow;

    if (!targetWindow || targetWindow.isDestroyed()) {
      return;
    }

    targetWindow.webContents.send('personal-agent-desktop:shortcut', action);
  }

  private async openWindowForHost(hostId: string, pathname: string, role: ManagedWindowRole): Promise<void> {
    const baseUrl = await this.hostManager.getHostBaseUrl(hostId);
    const targetUrl = new URL(pathname, baseUrl).toString();
    await this.openWindowToUrl(hostId, targetUrl, role);
  }

  private async openWindowToUrl(hostId: string, url: string, role: ManagedWindowRole): Promise<void> {
    const host = this.hostManager.getHostRecord(hostId);
    const partition = getHostBrowserPartition(host.id);
    const window = this.ensureWindow(host, partition, role);
    await this.loadWindowUrl(window, url);
  }

  private getNavigationState(window = this.mainWindow): DesktopNavigationState {
    return {
      canGoBack: window?.webContents.canGoBack() ?? false,
      canGoForward: window?.webContents.canGoForward() ?? false,
    };
  }

  private async goBack(window = this.mainWindow): Promise<DesktopNavigationState> {
    if (window?.webContents.canGoBack()) {
      window.webContents.goBack();
      await delay(120);
    }

    return this.getNavigationState(window);
  }

  private async goForward(window = this.mainWindow): Promise<DesktopNavigationState> {
    if (window?.webContents.canGoForward()) {
      window.webContents.goForward();
      await delay(120);
    }

    return this.getNavigationState(window);
  }

  private ensureWindow(host: DesktopHostRecord, partition: string, role: ManagedWindowRole): BrowserWindow {
    return role === 'main'
      ? this.ensureMainWindow(host, partition)
      : this.ensureRemoteWindow(host, partition);
  }

  private ensureMainWindow(host: DesktopHostRecord, partition: string): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.currentPartition === partition) {
      if (this.mainWindow.getTitle() !== buildWindowTitle(host)) {
        this.mainWindow.setTitle(buildWindowTitle(host));
      }
      return this.mainWindow;
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.destroy();
    }

    const window = this.createWindow(host, partition, 'main');
    this.mainWindow = window;
    this.currentPartition = partition;
    this.registerWindow(window, host.id, 'main');
    return window;
  }

  private ensureRemoteWindow(host: DesktopHostRecord, partition: string): BrowserWindow {
    const existing = this.remoteWindows.get(host.id);
    if (existing && !existing.isDestroyed()) {
      if (existing.getTitle() !== buildWindowTitle(host)) {
        existing.setTitle(buildWindowTitle(host));
      }
      return existing;
    }

    const window = this.createWindow(host, partition, 'remote');
    this.remoteWindows.set(host.id, window);
    this.registerWindow(window, host.id, 'remote');
    return window;
  }

  private createWindow(host: DesktopHostRecord, partition: string, role: ManagedWindowRole): BrowserWindow {
    const config = loadDesktopConfig();
    const savedWindowState = config.windowState ?? { width: 1440, height: 960 };
    const runtime = resolveDesktopRuntimePaths();
    const remoteOffset = role === 'remote'
      ? (this.remoteWindows.size + 1) * 28
      : 0;

    const window = new BrowserWindow({
      show: false,
      width: savedWindowState.width,
      height: savedWindowState.height,
      ...(typeof savedWindowState.x === 'number' ? { x: savedWindowState.x + remoteOffset } : {}),
      ...(typeof savedWindowState.y === 'number' ? { y: savedWindowState.y + remoteOffset } : {}),
      title: buildWindowTitle(host),
      icon: runtime.colorIconFile,
      autoHideMenuBar: true,
      titleBarStyle: 'hidden',
      backgroundColor: host.kind === 'local' ? undefined : '#1f1a12',
      trafficLightPosition: process.platform === 'darwin' ? { x: 14, y: 8 } : undefined,
      webPreferences: {
        preload: resolvePreloadPath(),
        partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    if (role === 'main') {
      window.on('close', (event) => {
        if (this.quitting) {
          return;
        }

        event.preventDefault();
        window.hide();
      });

      window.on('moved', () => {
        this.persistWindowBounds(window);
      });

      window.on('resized', () => {
        this.persistWindowBounds(window);
      });
    }

    window.once('ready-to-show', () => {
      window.show();
    });

    return window;
  }

  private registerWindow(window: BrowserWindow, hostId: string, role: ManagedWindowRole): void {
    const webContentsId = window.webContents.id;
    this.trackedWindows.set(webContentsId, { hostId, role, window });

    window.on('closed', () => {
      this.trackedWindows.delete(webContentsId);
      if (role === 'main' && this.mainWindow === window) {
        this.mainWindow = undefined;
        this.currentPartition = undefined;
      }
      if (role === 'remote' && this.remoteWindows.get(hostId) === window) {
        this.remoteWindows.delete(hostId);
      }
    });
  }

  private async loadWindowUrl(window: BrowserWindow, url: string): Promise<void> {
    const targetUrl = toDesktopShellUrl(url);
    const currentUrl = window.webContents.getURL();

    if (
      currentUrl
      && !window.webContents.isLoadingMainFrame()
      && canNavigateWindowInApp(currentUrl, targetUrl)
    ) {
      const targetRoute = toDesktopShellRoute(targetUrl);
      const currentRoute = toDesktopShellRoute(currentUrl);

      if (targetRoute !== currentRoute) {
        window.webContents.send(DESKTOP_NAVIGATE_CHANNEL, {
          route: targetRoute,
          replace: false,
        });
      }

      this.focusWindow(window);
      return;
    }

    if (currentUrl !== targetUrl) {
      await window.loadURL(targetUrl);
    }

    this.focusWindow(window);
  }

  private focusWindow(window: BrowserWindow): void {
    if (!window.isVisible()) {
      window.show();
    }

    if (window.isMinimized()) {
      window.restore();
    }

    window.focus();
  }

  private persistWindowBounds(window: BrowserWindow): void {
    if (window.isDestroyed()) {
      return;
    }

    const bounds = window.getBounds();
    updateDesktopWindowState({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  }
}
