import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, screen, type Session, session, shell, type WebContents } from 'electron';

import { syncDesktopShellAppModeForWindows } from './app-mode.js';
import { ensureDesktopAppProtocolForHost } from './app-protocol.js';
import { resolveDesktopRuntimePaths } from './desktop-env.js';
import { writeDesktopMainLogLine } from './desktop-main-log.js';
import type { HostManager } from './hosts/host-manager.js';
import type { DesktopHostRecord } from './hosts/types.js';
import { buildDesktopStartupErrorPageDataUrl } from './startup-error-page.js';
import { getHostBrowserPartition } from './state/browser-partitions.js';
import { loadDesktopConfig, updateDesktopWindowState } from './state/desktop-config.js';
import { flushStoredWorkbenchBrowserState } from './state/workbench-browser-state.js';
import { normalizeWorkbenchBrowserBounds, WorkbenchBrowserViewController } from './workbench-browser.js';

function logDesktopEvent(message: string, level: 'info' | 'warn' | 'error' = 'info'): void {
  writeDesktopMainLogLine(`[${new Date().toISOString()}] [desktop] [${level}] ${message}`);
  if (level === 'error') {
    console.error(message);
  }
}

function resolvePreloadPath(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  return resolve(currentDir, 'preload.cjs');
}

interface DesktopNavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
}

type DesktopRendererShortcutAction =
  | 'close-conversation'
  | 'reopen-closed-conversation'
  | 'previous-conversation'
  | 'next-conversation'
  | 'toggle-sidebar'
  | 'toggle-right-rail'
  | 'toggle-layout-mode'
  | 'show-conversation-mode'
  | 'show-workbench-mode'
  | 'toggle-conversation-pin'
  | 'toggle-conversation-archive'
  | 'focus-composer'
  | 'edit-working-directory'
  | 'rename-conversation'
  | 'find-in-page';

type ManagedWindowRole = 'main' | 'remote' | 'popout';

const DESKTOP_NAVIGATE_CHANNEL = 'personal-agent-desktop:navigate';
const DEFAULT_WINDOW_WIDTH = 1440;
const DEFAULT_WINDOW_HEIGHT = 960;
const MAX_SAVED_WINDOW_WIDTH = 4096;
const MAX_SAVED_WINDOW_HEIGHT = 4096;
const WINDOW_SHOW_FALLBACK_MS = 1500;
const configuredMediaPermissionPartitions = new Set<string>();
const EXTERNAL_WINDOW_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

interface DesktopRectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface DesktopWindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export function getDesktopWindowChromeOptions(platform = process.platform): {
  titleBarStyle: 'hidden' | 'hiddenInset';
  trafficLightPosition?: { x: number; y: number };
} {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
    };
  }

  return {
    titleBarStyle: 'hidden',
  };
}

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

export function shouldOpenWindowExternally(targetUrl: string): boolean {
  if (!targetUrl) {
    return false;
  }

  try {
    return EXTERNAL_WINDOW_PROTOCOLS.has(new URL(targetUrl).protocol);
  } catch {
    return false;
  }
}

export function shouldOpenNavigationExternally(currentUrl: string, targetUrl: string): boolean {
  return shouldOpenWindowExternally(targetUrl) && !canNavigateWindowInApp(currentUrl, targetUrl);
}

export function buildWindowTitle(_host: DesktopHostRecord): string {
  const appName = typeof app.name === 'string' && app.name.trim().length > 0 ? app.name.trim() : 'Personal Agent';
  return appName;
}

export function shouldGrantDesktopMediaPermission(requestingUrl: string, permission: string, mediaTypes: string[] = []): boolean {
  if (permission !== 'media' || !mediaTypes.includes('audio')) return false;
  try {
    const parsed = new URL(requestingUrl);
    return parsed.protocol === 'personal-agent:' && parsed.hostname === 'app';
  } catch {
    return false;
  }
}

function getDesktopMediaPermissionTypes(details: unknown): string[] {
  if (details === null || typeof details !== 'object' || !('mediaTypes' in details)) return [];
  const mediaTypes = (details as { mediaTypes?: unknown }).mediaTypes;
  return Array.isArray(mediaTypes) ? mediaTypes.filter((mediaType): mediaType is string => typeof mediaType === 'string') : [];
}

function configureDesktopMediaPermissions(partition: string): void {
  if (configuredMediaPermissionPartitions.has(partition)) return;
  configuredMediaPermissionPartitions.add(partition);
  const partitionSession = session.fromPartition(partition) as Session & {
    setPermissionRequestHandler?: (
      handler: (
        webContents: WebContents,
        permission: string,
        callback: (permissionGranted: boolean) => void,
        details: { requestingUrl?: string; mediaTypes?: string[] },
      ) => void,
    ) => void;
  };
  partitionSession.setPermissionRequestHandler?.((_webContents, permission, callback, details) => {
    callback(shouldGrantDesktopMediaPermission(details.requestingUrl ?? '', permission, getDesktopMediaPermissionTypes(details)));
  });
}

function intersectRectangleArea(left: DesktopRectangle, right: DesktopRectangle): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function centerBoundsInArea(bounds: DesktopWindowBounds, area: DesktopRectangle): DesktopWindowBounds {
  return {
    width: bounds.width,
    height: bounds.height,
    x: area.x + Math.max(0, Math.floor((area.width - bounds.width) / 2)),
    y: area.y + Math.max(0, Math.floor((area.height - bounds.height) / 2)),
  };
}

function normalizeWindowBound(value: number | undefined, fallback: number): number {
  const max = fallback === DEFAULT_WINDOW_HEIGHT ? MAX_SAVED_WINDOW_HEIGHT : MAX_SAVED_WINDOW_WIDTH;
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max ? value : fallback;
}

function normalizeWindowPosition(value: number | undefined): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= 100_000 ? value : undefined;
}

export function constrainDesktopWindowBounds(
  windowState: DesktopWindowBounds | undefined,
  displayAreas: DesktopRectangle[],
  remoteOffset = 0,
): DesktopWindowBounds {
  const normalizedWidth = Math.max(720, normalizeWindowBound(windowState?.width, DEFAULT_WINDOW_WIDTH));
  const normalizedHeight = Math.max(520, normalizeWindowBound(windowState?.height, DEFAULT_WINDOW_HEIGHT));
  const fallbackArea = displayAreas[0];
  if (!fallbackArea) {
    const normalizedX = normalizeWindowPosition(windowState?.x);
    const normalizedY = normalizeWindowPosition(windowState?.y);
    return {
      width: normalizedWidth,
      height: normalizedHeight,
      ...(normalizedX !== undefined ? { x: normalizedX + remoteOffset } : {}),
      ...(normalizedY !== undefined ? { y: normalizedY + remoteOffset } : {}),
    };
  }

  const normalizedX = normalizeWindowPosition(windowState?.x);
  const normalizedY = normalizeWindowPosition(windowState?.y);
  const hasSavedPosition = normalizedX !== undefined && normalizedY !== undefined;
  if (!hasSavedPosition) {
    const width = Math.min(normalizedWidth, fallbackArea.width);
    const height = Math.min(normalizedHeight, fallbackArea.height);
    return centerBoundsInArea({ width, height }, fallbackArea);
  }

  const desiredBounds: DesktopRectangle = {
    x: normalizedX + remoteOffset,
    y: normalizedY + remoteOffset,
    width: normalizedWidth,
    height: normalizedHeight,
  };
  const targetArea = displayAreas.reduce<DesktopRectangle>(
    (bestArea, area) => (intersectRectangleArea(desiredBounds, area) > intersectRectangleArea(desiredBounds, bestArea) ? area : bestArea),
    fallbackArea,
  );
  const width = Math.min(normalizedWidth, targetArea.width);
  const height = Math.min(normalizedHeight, targetArea.height);
  const maxX = targetArea.x + Math.max(0, targetArea.width - width);
  const maxY = targetArea.y + Math.max(0, targetArea.height - height);

  return {
    width,
    height,
    x: clamp(desiredBounds.x, targetArea.x, maxX),
    y: clamp(desiredBounds.y, targetArea.y, maxY),
  };
}

export class DesktopWindowController {
  private mainWindow?: BrowserWindow;
  private currentPartition?: string;
  private quitting = false;
  private remoteWindows = new Map<string, BrowserWindow>();
  private trackedWindows = new Map<
    number,
    {
      hostId: string;
      role: ManagedWindowRole;
      window: BrowserWindow;
    }
  >();
  private readonly workbenchBrowser = new WorkbenchBrowserViewController();
  private hasVisibleWindowsInAppMode: boolean | null = null;
  private readonly rendererRecoveryState = new Map<
    number,
    { crashedAt: number; reloadAttempts: number; unresponsiveSince: number | null }
  >();

  constructor(private readonly hostManager: HostManager) {}

  /** Handle a renderer process being unexpectedly terminated (crash, OOM, killed). */
  handleRendererProcessGone(webContentsId: number): void {
    const tracked = this.trackedWindows.get(webContentsId);
    if (!tracked || tracked.window.isDestroyed()) {
      return;
    }

    const now = Date.now();
    const state = this.rendererRecoveryState.get(webContentsId);

    // Reset the counter if the last crash was long enough ago.
    if (state && now - state.crashedAt > 60_000) {
      this.rendererRecoveryState.delete(webContentsId);
    }

    const attempts = (this.rendererRecoveryState.get(webContentsId)?.reloadAttempts ?? 0) + 1;
    if (attempts > 3) {
      logDesktopEvent(`Renderer (${webContentsId}) crashed ${attempts} times in 60s — not reloading.`, 'error');
      return;
    }

    this.rendererRecoveryState.set(webContentsId, {
      crashedAt: now,
      reloadAttempts: attempts,
      unresponsiveSince: null,
    });

    logDesktopEvent(`Renderer (${webContentsId}) process gone — reloading (attempt ${attempts}/3)…`, 'warn');

    setTimeout(() => {
      if (!tracked.window.isDestroyed()) {
        tracked.window.webContents.reload();
      }
    }, 1_500);
  }

  async prepareForQuit(): Promise<void> {
    await flushStoredWorkbenchBrowserState();
  }

  setQuitting(value: boolean): void {
    this.quitting = value;
  }

  async openMainWindow(pathname = '/'): Promise<void> {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      const currentUrl = this.mainWindow.webContents.getURL();
      if (currentUrl) {
        try {
          const targetUrl = new URL(pathname, currentUrl).toString();
          await this.loadWindowUrl(this.mainWindow, targetUrl);
          return;
        } catch {
          // Fall back to resolving the route through the host manager when the
          // existing window is still on a non-app URL like the startup error page.
        }
      }
    }

    await this.openWindowForHost(this.hostManager.getActiveHostId(), pathname, 'main');
  }

  async openAbsoluteUrl(url: string): Promise<void> {
    await this.openHostAbsoluteUrl(this.hostManager.getActiveHostId(), url);
  }

  async openNewWindow(): Promise<void> {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    const trackedWindow = focusedWindow ? this.trackedWindows.get(focusedWindow.webContents.id) : undefined;
    const hostId = trackedWindow?.hostId ?? this.hostManager.getActiveHostId();
    const route = this.getWindowRoute(trackedWindow?.window ?? this.mainWindow);
    await this.openWindowForHost(hostId, route, 'remote');
  }

  async openConversationPopoutWindow(input: { hostId?: string | null; conversationId: string }): Promise<void> {
    const conversationId = input.conversationId.trim();
    if (!conversationId) {
      throw new Error('conversationId is required.');
    }

    const hostId = input.hostId?.trim() || this.hostManager.getActiveHostId();
    await this.openWindowForHost(hostId, `/conversations/${encodeURIComponent(conversationId)}`, 'popout');
  }

  async openStartupErrorWindow(input: { message: string; logsDir: string }): Promise<void> {
    const hostId = this.hostManager.getActiveHostId();
    const host = this.hostManager.getHostRecord(hostId);
    const partition = getHostBrowserPartition(host.id);
    const window = this.ensureWindow(host, partition, 'main');
    const dataUrl = buildDesktopStartupErrorPageDataUrl(input);
    await this.loadRawWindowUrl(window, dataUrl);
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
    return this.getWindowRoute(this.mainWindow);
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

  setWorkbenchBrowserBoundsForWebContents(
    webContentsId: number,
    input: { visible?: boolean; bounds?: unknown; sessionKey?: string | null; deactivate?: boolean },
  ): unknown {
    const tracked = this.trackedWindows.get(webContentsId);
    if (!tracked || tracked.window.isDestroyed()) {
      return null;
    }

    const visible = input?.visible === true;
    const bounds = visible ? normalizeWorkbenchBrowserBounds(input?.bounds) : null;
    if (visible && !bounds) {
      throw new Error('Workbench browser bounds are invalid.');
    }

    return this.workbenchBrowser.setBounds(tracked.window.webContents, visible, bounds, input.sessionKey, input.deactivate === true);
  }

  getWorkbenchBrowserStateForWebContents(webContentsId: number, sessionKey?: string | null): unknown {
    return this.workbenchBrowser.getState(webContentsId, sessionKey);
  }

  async navigateWorkbenchBrowserForWebContents(
    webContentsId: number,
    input: { url?: unknown; sessionKey?: string | null },
  ): Promise<unknown> {
    const tracked = this.trackedWindows.get(webContentsId);
    if (!tracked || tracked.window.isDestroyed()) {
      throw new Error('Workbench browser owner window is unavailable.');
    }
    return this.workbenchBrowser.navigate(tracked.window.webContents, input.url, input.sessionKey);
  }

  async goBackWorkbenchBrowserForWebContents(webContentsId: number, sessionKey?: string | null): Promise<unknown> {
    const tracked = this.trackedWindows.get(webContentsId);
    if (!tracked || tracked.window.isDestroyed()) {
      throw new Error('Workbench browser owner window is unavailable.');
    }
    return this.workbenchBrowser.goBack(tracked.window.webContents, sessionKey);
  }

  async goForwardWorkbenchBrowserForWebContents(webContentsId: number, sessionKey?: string | null): Promise<unknown> {
    const tracked = this.trackedWindows.get(webContentsId);
    if (!tracked || tracked.window.isDestroyed()) {
      throw new Error('Workbench browser owner window is unavailable.');
    }
    return this.workbenchBrowser.goForward(tracked.window.webContents, sessionKey);
  }

  async reloadWorkbenchBrowserForWebContents(webContentsId: number, sessionKey?: string | null): Promise<unknown> {
    const tracked = this.trackedWindows.get(webContentsId);
    if (!tracked || tracked.window.isDestroyed()) {
      throw new Error('Workbench browser owner window is unavailable.');
    }
    return this.workbenchBrowser.reload(tracked.window.webContents, sessionKey);
  }

  stopWorkbenchBrowserForWebContents(webContentsId: number, sessionKey?: string | null): unknown {
    const tracked = this.trackedWindows.get(webContentsId);
    if (!tracked || tracked.window.isDestroyed()) {
      throw new Error('Workbench browser owner window is unavailable.');
    }
    return this.workbenchBrowser.stop(tracked.window.webContents, sessionKey);
  }

  async snapshotWorkbenchBrowserForWebContents(webContentsId: number, sessionKey?: string | null): Promise<unknown> {
    const tracked = this.trackedWindows.get(webContentsId);
    if (!tracked || tracked.window.isDestroyed()) {
      throw new Error('Workbench browser owner window is unavailable.');
    }
    return this.workbenchBrowser.snapshot(tracked.window.webContents, sessionKey);
  }

  async snapshotWorkbenchBrowserForConversation(conversationId?: string | null): Promise<unknown> {
    const owner = await this.ensureWorkbenchBrowserOwner(conversationId);
    return this.workbenchBrowser.snapshot(owner, conversationId);
  }

  isWorkbenchBrowserActiveForConversation(conversationId?: string | null): boolean {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return false;
    }
    return this.workbenchBrowser.getState(this.mainWindow.webContents.id, conversationId)?.active === true;
  }

  async screenshotWorkbenchBrowserForConversation(conversationId?: string | null): Promise<unknown> {
    const owner = await this.ensureWorkbenchBrowserOwner(conversationId);
    return this.workbenchBrowser.screenshot(owner, conversationId);
  }

  async cdpWorkbenchBrowserForConversation(input: {
    conversationId?: string | null;
    command?: unknown;
    continueOnError?: unknown;
  }): Promise<unknown> {
    const owner = await this.ensureWorkbenchBrowserOwner(input.conversationId);
    return this.workbenchBrowser.cdp(owner, { ...input, sessionKey: input.conversationId });
  }

  private getActiveBrowserSessionKey(): string | null {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return null;
    }

    return this.workbenchBrowser.getActiveSessionKey(this.mainWindow.webContents.id);
  }

  isWorkbenchBrowserActive(): boolean {
    const key = this.getActiveBrowserSessionKey();
    return key !== null && this.workbenchBrowser.getState(this.mainWindow!.webContents.id, key)?.active === true;
  }

  listBrowserTabs(): Array<{ sessionKey: string; url: string; title: string }> {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return [];
    }

    return this.workbenchBrowser.listTabs(this.mainWindow.webContents.id);
  }

  private resolveBrowserSessionKey(tabId?: string): string | null {
    if (tabId) {
      return `@global:tab-${tabId}`;
    }

    return this.getActiveBrowserSessionKey();
  }

  async snapshotWorkbenchBrowser(tabId?: string): Promise<unknown> {
    const key = this.resolveBrowserSessionKey(tabId);
    if (!key) {
      throw new Error('Workbench Browser is not active');
    }

    const owner = await this.ensureWorkbenchBrowserOwner(key);
    return this.workbenchBrowser.snapshot(owner, key);
  }

  async screenshotWorkbenchBrowser(tabId?: string): Promise<unknown> {
    const key = this.resolveBrowserSessionKey(tabId);
    if (!key) {
      throw new Error('Workbench Browser is not active');
    }

    const owner = await this.ensureWorkbenchBrowserOwner(key);
    return this.workbenchBrowser.screenshot(owner, key);
  }

  async cdpWorkbenchBrowser(input: { command?: unknown; continueOnError?: unknown; tabId?: string }): Promise<unknown> {
    const key = this.resolveBrowserSessionKey(input.tabId);
    if (!key) {
      throw new Error('Workbench Browser is not active');
    }

    const owner = await this.ensureWorkbenchBrowserOwner(key);
    return this.workbenchBrowser.cdp(owner, { ...input, sessionKey: key });
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

  private getWindowRoute(window?: BrowserWindow): string {
    const currentUrl = window?.webContents.getURL();
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

  private getNavigationState(window = this.mainWindow): DesktopNavigationState {
    const nav = window?.webContents.navigationHistory;
    return {
      canGoBack: nav?.canGoBack() ?? false,
      canGoForward: nav?.canGoForward() ?? false,
    };
  }

  private async goBack(window = this.mainWindow): Promise<DesktopNavigationState> {
    const nav = window?.webContents.navigationHistory;
    if (nav?.canGoBack()) {
      nav.goBack();
      await delay(120);
    }

    return this.getNavigationState(window);
  }

  private async goForward(window = this.mainWindow): Promise<DesktopNavigationState> {
    const nav = window?.webContents.navigationHistory;
    if (nav?.canGoForward()) {
      nav.goForward();
      await delay(120);
    }

    return this.getNavigationState(window);
  }

  private async ensureWorkbenchBrowserOwner(conversationId?: string | null): Promise<WebContents> {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      const route = conversationId?.trim() ? `/conversations/${encodeURIComponent(conversationId.trim())}` : '/';
      await this.openMainWindow(route);
    }

    const window = this.mainWindow;
    if (!window || window.isDestroyed()) {
      throw new Error('Desktop window is unavailable.');
    }

    return window.webContents;
  }

  private ensureWindow(host: DesktopHostRecord, partition: string, role: ManagedWindowRole): BrowserWindow {
    if (role === 'main') {
      return this.ensureMainWindow(host, partition);
    }

    if (role === 'remote') {
      return this.ensureRemoteWindow(host, partition);
    }

    const window = this.createWindow(host, partition, role);
    this.registerWindow(window, host.id, role);
    return window;
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
    ensureDesktopAppProtocolForHost(this.hostManager, host.id);
    configureDesktopMediaPermissions(partition);

    const config = loadDesktopConfig();
    const remoteOffset = role !== 'main' ? (this.countAdditionalWindows() + 1) * 28 : 0;
    const savedWindowState = constrainDesktopWindowBounds(
      config.windowState ?? { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT },
      screen.getAllDisplays().map((display) => display.workArea),
      remoteOffset,
    );
    const runtime = resolveDesktopRuntimePaths();

    const createdAt = process.hrtime.bigint();
    const logWindowMilestone = (label: string) => {
      const elapsedMs = Number(process.hrtime.bigint() - createdAt) / 1_000_000;
      logDesktopEvent(`Window ${role} ${label} elapsedMs=${elapsedMs.toFixed(1)}`);
    };

    const window = new BrowserWindow({
      show: false,
      ...savedWindowState,
      title: buildWindowTitle(host),
      icon: runtime.colorIconFile,
      autoHideMenuBar: true,
      backgroundColor: host.kind === 'local' ? undefined : '#1f1a12',
      ...getDesktopWindowChromeOptions(),
      webPreferences: {
        preload: resolvePreloadPath(),
        partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    this.configureExternalNavigation(window);
    this.configureRendererRecovery(window, role);

    if (role === 'main') {
      window.on('close', (event) => {
        if (this.quitting) {
          return;
        }

        event.preventDefault();
        window.hide();
      });

      window.on('moved', () => {
        this.scheduleWindowBoundsPersist(window);
      });

      window.on('resized', () => {
        this.scheduleWindowBoundsPersist(window);
      });

      window.on('close', () => {
        this.flushWindowBoundsPersist(window);
      });
    }

    window.on('show', () => {
      this.syncAppModeForVisibleWindows();
    });

    window.on('hide', () => {
      this.syncAppModeForVisibleWindows();
    });

    const showFallbackTimer = setTimeout(() => {
      if (!window.isDestroyed() && !window.isVisible()) {
        logWindowMilestone('show-fallback');
        window.show();
      }
    }, WINDOW_SHOW_FALLBACK_MS);

    window.once('ready-to-show', () => {
      logWindowMilestone('ready-to-show');
      clearTimeout(showFallbackTimer);
      window.show();
    });

    window.webContents.once('did-finish-load', () => {
      logWindowMilestone('did-finish-load');
    });

    window.once('closed', () => {
      clearTimeout(showFallbackTimer);
    });

    return window;
  }

  private configureExternalNavigation(window: BrowserWindow): void {
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (shouldOpenWindowExternally(url)) {
        void shell.openExternal(url);
        return { action: 'deny' };
      }

      return { action: 'allow' };
    });

    window.webContents.on('will-navigate', (event, navigationUrl) => {
      const currentUrl = window.webContents.getURL();
      if (!shouldOpenNavigationExternally(currentUrl, navigationUrl)) {
        return;
      }

      event.preventDefault();
      void shell.openExternal(navigationUrl);
    });
  }

  private configureRendererRecovery(window: BrowserWindow, _role: ManagedWindowRole): void {
    const webContents = window.webContents;
    const webContentsId = webContents.id;

    // Retry on transient load failures (DNS, connection refused, etc.).
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
      if (this.quitting) {
        return;
      }

      // Only retry DNS/connection/name-resolution errors.
      const transientCodes = new Set([
        -105, // ERR_NAME_NOT_RESOLVED
        -106, // ERR_INTERNET_DISCONNECTED
        -109, // ERR_ADDRESS_UNREACHABLE
        -110, // ERR_SSL_PROTOCOL_ERROR
        -111, // ERR_ADDRESS_INVALID
        -113, // ERR_CONNECTION_REFUSED
        -116, // ERR_CONNECTION_TIMED_OUT
        -118, // ERR_CONNECTION_RESET
        -137, // ERR_NAME_RESOLUTION_FAILED
        -138, // ERR_ICANN_NAME_COLLISION
        -300, // ERR_FILE_NOT_FOUND
        -501, // ERR_INSECURE_RESPONSE
      ]);

      if (!transientCodes.has(errorCode) || !validatedUrl) {
        return;
      }

      logDesktopEvent(`Page load failed for ${webContentsId}: ${errorDescription} (${errorCode}) — retrying…`, 'warn');

      setTimeout(() => {
        if (!window.isDestroyed() && window.webContents.getURL() === validatedUrl) {
          window.webContents.reload();
        }
      }, 1_500);
    });

    // Track unresponsive state so we can recover if it doesn't come back.
    webContents.on('unresponsive', () => {
      if (this.quitting) {
        return;
      }

      const state = this.rendererRecoveryState.get(webContentsId);
      if (!state || state.unresponsiveSince === null) {
        this.rendererRecoveryState.set(webContentsId, {
          crashedAt: state?.crashedAt ?? Date.now(),
          reloadAttempts: state?.reloadAttempts ?? 0,
          unresponsiveSince: Date.now(),
        });
      }

      // Schedule a check — if still unresponsive after threshold, reload.
      setTimeout(() => {
        if (this.quitting) {
          return;
        }

        if (window.isDestroyed()) {
          return;
        }

        const currentState = this.rendererRecoveryState.get(webContentsId);
        if (!currentState || currentState.unresponsiveSince === null) {
          return;
        }

        const elapsed = Date.now() - currentState.unresponsiveSince;
        if (elapsed < 8_000) {
          return;
        }

        const attempts = currentState.reloadAttempts + 1;
        if (attempts > 3) {
          logDesktopEvent(`Renderer (${webContentsId}) unresponsive ${attempts} times — not reloading.`, 'error');
          return;
        }

        this.rendererRecoveryState.set(webContentsId, {
          ...currentState,
          reloadAttempts: attempts,
        });

        logDesktopEvent(`Renderer (${webContentsId}) unresponsive for ${elapsed}ms — reloading (attempt ${attempts}/3).`, 'warn');
        window.webContents.reload();
      }, 8_000);
    });

    webContents.on('responsive', () => {
      const state = this.rendererRecoveryState.get(webContentsId);
      if (state) {
        this.rendererRecoveryState.set(webContentsId, {
          ...state,
          unresponsiveSince: null,
        });
      }
    });
  }

  private registerWindow(window: BrowserWindow, hostId: string, role: ManagedWindowRole): void {
    const webContentsId = window.webContents.id;
    this.trackedWindows.set(webContentsId, { hostId, role, window });

    window.on('closed', () => {
      this.workbenchBrowser.destroy(webContentsId);
      this.trackedWindows.delete(webContentsId);
      if (role === 'main' && this.mainWindow === window) {
        this.mainWindow = undefined;
        this.currentPartition = undefined;
      }
      if (role === 'remote' && this.remoteWindows.get(hostId) === window) {
        this.remoteWindows.delete(hostId);
      }
      this.syncAppModeForVisibleWindows();
    });
  }

  private async loadWindowUrl(window: BrowserWindow, url: string): Promise<void> {
    const targetUrl = toDesktopShellUrl(url);
    const currentUrl = window.webContents.getURL();

    if (currentUrl && !window.webContents.isLoadingMainFrame() && canNavigateWindowInApp(currentUrl, targetUrl)) {
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
      void window.loadURL(targetUrl).catch((error) => {
        logDesktopEvent(`Window failed to load ${targetUrl}: ${error instanceof Error ? error.message : String(error)}`, 'error');
      });
    }

    this.focusWindow(window);
  }

  private async loadRawWindowUrl(window: BrowserWindow, url: string): Promise<void> {
    const currentUrl = window.webContents.getURL();

    if (currentUrl !== url) {
      await window.loadURL(url);
    }

    this.focusWindow(window);
  }

  private focusWindow(window: BrowserWindow): void {
    let willBeVisible = window.isVisible();

    if (!willBeVisible) {
      window.show();
      willBeVisible = true;
    }

    if (window.isMinimized()) {
      window.restore();
    }

    this.syncAppModeForVisibleWindows(willBeVisible);
    window.focus();
  }

  private syncAppModeForVisibleWindows(visibleWindowHint?: boolean): void {
    const hasVisibleWindows = visibleWindowHint || this.anyTrackedWindowIsVisible();
    if (this.hasVisibleWindowsInAppMode === hasVisibleWindows) {
      return;
    }

    this.hasVisibleWindowsInAppMode = hasVisibleWindows;
    syncDesktopShellAppModeForWindows(process.platform, app, hasVisibleWindows);
  }

  private anyTrackedWindowIsVisible(): boolean {
    for (const trackedWindow of this.trackedWindows.values()) {
      if (!trackedWindow.window.isDestroyed() && trackedWindow.window.isVisible()) {
        return true;
      }
    }

    return false;
  }

  private countAdditionalWindows(): number {
    let count = 0;
    for (const trackedWindow of this.trackedWindows.values()) {
      if (trackedWindow.role !== 'main' && !trackedWindow.window.isDestroyed()) {
        count += 1;
      }
    }
    return count;
  }

  private windowBoundsPersistTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleWindowBoundsPersist(window: BrowserWindow): void {
    if (this.windowBoundsPersistTimer) {
      clearTimeout(this.windowBoundsPersistTimer);
    }

    this.windowBoundsPersistTimer = setTimeout(() => {
      this.windowBoundsPersistTimer = null;
      this.persistWindowBounds(window);
    }, 500);
  }

  private flushWindowBoundsPersist(window: BrowserWindow): void {
    if (this.windowBoundsPersistTimer) {
      clearTimeout(this.windowBoundsPersistTimer);
      this.windowBoundsPersistTimer = null;
    }

    this.persistWindowBounds(window);
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
