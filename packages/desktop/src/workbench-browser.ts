import { BrowserWindow, Menu, shell, type WebContents, WebContentsView } from 'electron';

import { readStoredWorkbenchBrowserUrl, writeStoredWorkbenchBrowserUrl } from './state/workbench-browser-state.js';

const DEFAULT_BROWSER_URL = 'https://www.google.com/';
const MAX_SNAPSHOT_TEXT_LENGTH = 30_000;
const BROWSER_COMMENT_CHANNEL = 'personal-agent-desktop:workbench-browser-comment';

type CdpCommand = (method: string, params?: Record<string, unknown>) => Promise<unknown>;

interface CdpRuntimeResult {
  result?: { value?: unknown; unserializableValue?: string; description?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string; value?: unknown } };
}

export interface WorkbenchBrowserBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WorkbenchBrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  active: boolean;
  browserRevision: number;
  lastSnapshotRevision: number;
  changedSinceLastSnapshot: boolean;
  lastChangeReason?: string;
  lastChangedAt?: string;
}

export interface WorkbenchBrowserSnapshot extends WorkbenchBrowserState {
  text: string;
  elements?: WorkbenchBrowserSnapshotElement[];
}

export interface WorkbenchBrowserSnapshotElement {
  ref: string;
  role: string;
  name: string;
  selector: string;
  xpath: string;
  text: string;
  enabled: boolean;
  checked?: boolean;
  bounds: { x: number; y: number; width: number; height: number };
}

export interface WorkbenchBrowserScreenshot extends WorkbenchBrowserState {
  mimeType: 'image/png';
  dataBase64: string;
  viewport: { width: number; height: number };
  capturedAt: string;
}

export interface WorkbenchBrowserCdpResult {
  ok: boolean;
  results: unknown[];
  failedAt?: number;
  error?: string;
  state: WorkbenchBrowserState;
}

export interface WorkbenchBrowserCommentTarget {
  url: string;
  title: string;
  selector?: string;
  xpath?: string;
  role?: string;
  accessibleName?: string;
  testId?: string;
  textSnippet?: string;
  surroundingText?: string;
  elementHtmlPreview?: string;
  pageTextQuote?: string;
  viewportRect: { x: number; y: number; width: number; height: number };
  scroll: { x: number; y: number };
  devicePixelRatio: number;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function normalizeWorkbenchBrowserBounds(input: unknown): WorkbenchBrowserBounds | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const value = input as Partial<WorkbenchBrowserBounds>;
  if (!isFiniteInteger(value.x) || !isFiniteInteger(value.y) || !isFiniteInteger(value.width) || !isFiniteInteger(value.height)) {
    return null;
  }

  if (value.width <= 0 || value.height <= 0 || value.width > 4096 || value.height > 4096) {
    return null;
  }

  if (Math.abs(value.x) > 100_000 || Math.abs(value.y) > 100_000) {
    return null;
  }

  return {
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
  };
}

export function normalizeWorkbenchBrowserUrl(input: unknown): string {
  const raw = typeof input === 'string' ? input.trim() : '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error('Enter a valid http(s) URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Workbench browser only supports http(s) URLs.');
  }

  return parsed.toString();
}

function normalizeCdpMethod(input: unknown): string {
  const method = typeof input === 'string' ? input.trim() : '';
  if (!method) {
    throw new Error('CDP method is required.');
  }
  if (!/^[A-Za-z][A-Za-z0-9]*\.[A-Za-z][A-Za-z0-9]*$/.test(method)) {
    throw new Error('CDP method must be in Domain.command form.');
  }
  return method;
}

function normalizeCdpParams(input: unknown): Record<string, unknown> | undefined {
  if (input === undefined || input === null) {
    return undefined;
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('CDP params must be an object when provided.');
  }
  return input as Record<string, unknown>;
}

export type NormalizedWorkbenchBrowserCdpCommand = { method: string; params?: Record<string, unknown> };

function normalizeCdpCommandObject(input: unknown): NormalizedWorkbenchBrowserCdpCommand {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('CDP command must be an object: { method, params? }.');
  }
  const candidate = input as { method?: unknown; params?: unknown };
  return {
    method: normalizeCdpMethod(candidate.method),
    ...(candidate.params !== undefined ? { params: normalizeCdpParams(candidate.params) } : {}),
  };
}

export function normalizeWorkbenchBrowserCdpCommands(input: unknown): NormalizedWorkbenchBrowserCdpCommand[] {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    return [normalizeCdpCommandObject(input)];
  }
  if (!Array.isArray(input)) {
    throw new Error('CDP command must be { method, params? } or an array of command objects.');
  }
  if (input.length === 0) {
    throw new Error('At least one CDP command is required.');
  }
  if (input.length > 200) {
    throw new Error('CDP command batches are limited to 200 commands.');
  }
  return input.map((entry) => normalizeCdpCommandObject(entry));
}

interface WorkbenchBrowserViewEntry {
  ownerWindow: BrowserWindow;
  owner: WebContents;
  view: WebContentsView;
  active: boolean;
  deactivated: boolean;
  browserRevision: number;
  lastSnapshotRevision: number;
  lastChangeReason?: string;
  lastChangedAt?: string;
}

function getState(webContents: WebContents, entry?: WorkbenchBrowserViewEntry): WorkbenchBrowserState {
  const nav = webContents.navigationHistory;
  return {
    url: webContents.getURL(),
    title: webContents.getTitle(),
    loading: webContents.isLoadingMainFrame(),
    canGoBack: nav.canGoBack(),
    canGoForward: nav.canGoForward(),
    active: entry?.active === true,
    browserRevision: entry?.browserRevision ?? 0,
    lastSnapshotRevision: entry?.lastSnapshotRevision ?? 0,
    changedSinceLastSnapshot: entry?.active === true && (entry?.browserRevision ?? 0) > (entry?.lastSnapshotRevision ?? 0),
    ...(entry?.lastChangeReason ? { lastChangeReason: entry.lastChangeReason } : {}),
    ...(entry?.lastChangedAt ? { lastChangedAt: entry.lastChangedAt } : {}),
  };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function withCdp<T>(webContents: WebContents, callback: (send: CdpCommand) => Promise<T>): Promise<T> {
  if (!webContents.debugger.isAttached()) {
    webContents.debugger.attach('1.3');
  }
  return callback((method, params) => webContents.debugger.sendCommand(method, params));
}

function cdpRuntimeValue(raw: unknown): unknown {
  const result = raw as CdpRuntimeResult;
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'CDP evaluation failed.');
  }
  if (result.result && 'value' in result.result) {
    return result.result.value;
  }
  return result.result?.unserializableValue ?? result.result?.description ?? null;
}

async function cdpEvaluate(webContents: WebContents, expression: string): Promise<unknown> {
  return withCdp(webContents, async (send) =>
    cdpRuntimeValue(
      await send('Runtime.evaluate', {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      }),
    ),
  );
}

export class WorkbenchBrowserViewController {
  private views = new Map<string, WorkbenchBrowserViewEntry>();
  private activeViewKeysByOwner = new Map<number, string>();

  getState(ownerWebContentsId: number, sessionKey?: string | null): WorkbenchBrowserState | null {
    const entry = this.views.get(this.viewKey(ownerWebContentsId, sessionKey));
    return entry ? getState(entry.view.webContents, entry) : null;
  }

  getActiveSessionKey(ownerWebContentsId: number): string | null {
    const viewKey = this.activeViewKeysByOwner.get(ownerWebContentsId);
    if (!viewKey) {
      return null;
    }

    const colonIndex = viewKey.indexOf(':');
    return colonIndex >= 0 ? viewKey.slice(colonIndex + 1) : null;
  }

  listTabs(ownerWebContentsId: number): Array<{ sessionKey: string; url: string; title: string }> {
    const tabs: Array<{ sessionKey: string; url: string; title: string }> = [];
    for (const [viewKey, entry] of this.views) {
      if (!viewKey.startsWith(`${ownerWebContentsId}:`)) {
        continue;
      }

      const colonIndex = viewKey.indexOf(':');
      const sessionKey = colonIndex >= 0 ? viewKey.slice(colonIndex + 1) : viewKey;
      if (!sessionKey.startsWith('@global:tab-')) {
        continue;
      }

      if (entry.view.webContents.isDestroyed()) {
        continue;
      }

      tabs.push({
        sessionKey,
        url: entry.view.webContents.getURL(),
        title: entry.view.webContents.getTitle() || 'New Tab',
      });
    }

    return tabs;
  }

  hasView(ownerWebContentsId: number, sessionKey?: string | null): boolean {
    const entry = this.views.get(this.viewKey(ownerWebContentsId, sessionKey));
    return Boolean(entry && !entry.view.webContents.isDestroyed());
  }

  setBounds(
    owner: WebContents,
    visible: boolean,
    bounds: WorkbenchBrowserBounds | null,
    sessionKey?: string | null,
    deactivate?: boolean,
  ): WorkbenchBrowserState | null {
    const ownerWindow = BrowserWindow.fromWebContents(owner);
    if (!ownerWindow || ownerWindow.isDestroyed()) {
      return null;
    }

    if (!visible || !bounds) {
      this.hide(this.viewKey(owner.id, sessionKey), deactivate === true);
      return this.getState(owner.id, sessionKey);
    }

    const viewKey = this.viewKey(owner.id, sessionKey);
    this.hideActiveOwnerView(owner.id, viewKey);
    const view = this.ensureView(ownerWindow, owner.id, sessionKey);
    const entry = this.views.get(viewKey);
    if (entry) {
      entry.active = true;
      entry.deactivated = false;
    }
    view.setBounds(bounds);
    this.activeViewKeysByOwner.set(owner.id, viewKey);
    return getState(view.webContents, this.views.get(viewKey));
  }

  async navigate(owner: WebContents, inputUrl: unknown, sessionKey?: string | null): Promise<WorkbenchBrowserState> {
    const ownerWindow = this.requireOwnerWindow(owner);
    const view = this.ensureView(ownerWindow, owner.id, sessionKey);
    const url = normalizeWorkbenchBrowserUrl(inputUrl);
    await view.webContents.loadURL(url);
    return getState(view.webContents, this.views.get(this.viewKey(owner.id, sessionKey)));
  }

  async goBack(owner: WebContents, sessionKey?: string | null): Promise<WorkbenchBrowserState> {
    const view = this.requireView(owner, sessionKey);
    const nav = view.webContents.navigationHistory;
    if (nav.canGoBack()) {
      nav.goBack();
      await wait(120);
    }
    return getState(view.webContents, this.views.get(this.viewKey(owner.id, sessionKey)));
  }

  async goForward(owner: WebContents, sessionKey?: string | null): Promise<WorkbenchBrowserState> {
    const view = this.requireView(owner, sessionKey);
    const nav = view.webContents.navigationHistory;
    if (nav.canGoForward()) {
      nav.goForward();
      await wait(120);
    }
    return getState(view.webContents, this.views.get(this.viewKey(owner.id, sessionKey)));
  }

  async reload(owner: WebContents, sessionKey?: string | null): Promise<WorkbenchBrowserState> {
    const view = this.requireView(owner, sessionKey);
    view.webContents.reload();
    await wait(120);
    return getState(view.webContents, this.views.get(this.viewKey(owner.id, sessionKey)));
  }

  stop(owner: WebContents, sessionKey?: string | null): WorkbenchBrowserState {
    const view = this.requireView(owner, sessionKey);
    view.webContents.stop();
    return getState(view.webContents, this.views.get(this.viewKey(owner.id, sessionKey)));
  }

  async snapshot(owner: WebContents, sessionKey?: string | null): Promise<WorkbenchBrowserSnapshot> {
    const view = this.requireView(owner, sessionKey);
    let raw: unknown;
    try {
      raw = await cdpEvaluate(
        view.webContents,
        `(() => {
      ${this.pageHelperSource()}
      const nl = '\\n';
      const title = document.title ? 'Title: ' + document.title + nl : '';
      const url = location.href ? 'URL: ' + location.href + nl : '';
      const body = document.body ? document.body.innerText : '';
      const candidates = Array.from(document.querySelectorAll('a, button, input, textarea, select, [role], [tabindex], label, summary')).slice(0, 120);
      const elements = candidates.map((element, index) => {
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
          ref: '@e' + (index + 1),
          role: elementRole(element),
          name: accessibleName(element),
          selector: selectorFor(element),
          xpath: xpathFor(element),
          text: max(element.innerText || element.textContent || element.value || '', 240),
          enabled: !element.disabled && element.getAttribute('aria-disabled') !== 'true',
          checked: typeof element.checked === 'boolean' ? element.checked : undefined,
          bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        };
      }).filter(Boolean);
      return { text: (url + title + body).slice(0, ${MAX_SNAPSHOT_TEXT_LENGTH}), elements };
    })()`,
      );
    } catch {
      // Fallback: if the complex evaluation fails (e.g. JS syntax issues on some pages),
      // use simpler individual evaluations to get basic page state.
      const fallbackTitle =
        (await withCdp(view.webContents, async (send) =>
          cdpRuntimeValue(
            await send('Runtime.evaluate', {
              expression: 'document.title',
              returnByValue: true,
            }),
          ),
        )) ?? '';
      const fallbackUrl =
        (await withCdp(view.webContents, async (send) =>
          cdpRuntimeValue(
            await send('Runtime.evaluate', {
              expression: 'location.href',
              returnByValue: true,
            }),
          ),
        )) ?? '';
      const fallbackBody =
        (await withCdp(view.webContents, async (send) =>
          cdpRuntimeValue(
            await send('Runtime.evaluate', {
              expression: "document.body ? document.body.innerText : ''",
              returnByValue: true,
            }),
          ),
        )) ?? '';
      raw = {
        text: (
          (fallbackUrl ? 'URL: ' + String(fallbackUrl) + '\n' : '') +
          (fallbackTitle ? 'Title: ' + String(fallbackTitle) + '\n' : '') +
          String(fallbackBody)
        ).slice(0, MAX_SNAPSHOT_TEXT_LENGTH),
        elements: [],
      };
    }

    const rawSnapshot = raw && typeof raw === 'object' ? (raw as { text?: unknown; elements?: unknown }) : {};
    const text = typeof rawSnapshot.text === 'string' ? rawSnapshot.text : '';
    const elements = Array.isArray(rawSnapshot.elements) ? (rawSnapshot.elements as WorkbenchBrowserSnapshotElement[]) : [];
    const entry = this.views.get(this.viewKey(owner.id, sessionKey));
    if (entry) {
      entry.lastSnapshotRevision = entry.browserRevision;
    }

    return {
      ...getState(view.webContents, entry),
      text,
      elements,
    };
  }

  async screenshot(owner: WebContents, sessionKey?: string | null): Promise<WorkbenchBrowserScreenshot> {
    const view = this.requireView(owner, sessionKey);
    const capture = (await withCdp(view.webContents, async (send) =>
      send('Page.captureScreenshot', { format: 'png', fromSurface: true }),
    )) as { data?: string };
    const bounds = view.getBounds();
    return {
      ...getState(view.webContents, this.views.get(this.viewKey(owner.id, sessionKey))),
      mimeType: 'image/png',
      dataBase64: capture.data ?? '',
      viewport: { width: bounds.width, height: bounds.height },
      capturedAt: new Date().toISOString(),
    };
  }

  async cdp(
    owner: WebContents,
    input: { command?: unknown; continueOnError?: unknown; sessionKey?: string | null },
  ): Promise<WorkbenchBrowserCdpResult> {
    const view = this.requireView(owner, input.sessionKey);
    const commands = normalizeWorkbenchBrowserCdpCommands(input.command);
    const continueOnError = input.continueOnError === true;
    const results: unknown[] = [];
    let failedAt: number | undefined;
    let error: string | undefined;

    await withCdp(view.webContents, async (send) => {
      for (let index = 0; index < commands.length; index += 1) {
        const { method, params } = commands[index]!;
        try {
          results.push(await send(method, params));
        } catch (err) {
          failedAt ??= index;
          error ??= err instanceof Error ? err.message : String(err);
          if (!continueOnError) {
            break;
          }
          results.push({ error: err instanceof Error ? err.message : String(err) });
        }
      }
    });

    return {
      ok: failedAt === undefined,
      state: getState(view.webContents, this.views.get(this.viewKey(owner.id, input.sessionKey))),
      results,
      ...(failedAt !== undefined ? { failedAt } : {}),
      ...(error ? { error } : {}),
    };
  }

  destroy(ownerWebContentsId: number): void {
    for (const [viewKey, entry] of this.views) {
      if (!viewKey.startsWith(`${ownerWebContentsId}:`)) {
        continue;
      }
      this.views.delete(viewKey);
      try {
        entry.ownerWindow.contentView.removeChildView(entry.view);
      } catch {
        // Best-effort cleanup. Electron may already have torn down the window.
      }
      entry.view.webContents.close();
    }
    this.activeViewKeysByOwner.delete(ownerWebContentsId);
  }

  private viewKey(ownerWebContentsId: number, sessionKey?: string | null): string {
    const normalizedSessionKey = sessionKey?.trim() || 'default';
    return `${ownerWebContentsId}:${normalizedSessionKey}`;
  }

  private hide(viewKey: string, deactivate = false): void {
    const entry = this.views.get(viewKey);
    if (!entry) {
      return;
    }
    if (deactivate) {
      entry.active = false;
      entry.deactivated = true;
      this.activeViewKeysByOwner.delete(entry.owner.id);
      entry.view.webContents.stop();
    }
    entry.view.setBounds({ x: -10_000, y: -10_000, width: 1, height: 1 });
  }

  private hideActiveOwnerView(ownerWebContentsId: number, exceptViewKey: string): void {
    const activeViewKey = this.activeViewKeysByOwner.get(ownerWebContentsId);
    if (activeViewKey && activeViewKey !== exceptViewKey) {
      this.hide(activeViewKey);
    }
  }

  private requireOwnerWindow(owner: WebContents): BrowserWindow {
    const ownerWindow = BrowserWindow.fromWebContents(owner);
    if (!ownerWindow || ownerWindow.isDestroyed()) {
      throw new Error('Workbench browser owner window is unavailable.');
    }
    return ownerWindow;
  }

  private requireView(owner: WebContents, sessionKey?: string | null): WebContentsView {
    const ownerWindow = this.requireOwnerWindow(owner);
    return this.ensureView(ownerWindow, owner.id, sessionKey);
  }

  private ensureView(ownerWindow: BrowserWindow, ownerWebContentsId: number, sessionKey?: string | null): WebContentsView {
    const viewKey = this.viewKey(ownerWebContentsId, sessionKey);
    const existing = this.views.get(viewKey);
    if (existing && !existing.view.webContents.isDestroyed()) {
      return existing.view;
    }

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const entry: WorkbenchBrowserViewEntry = {
      ownerWindow,
      owner: ownerWindow.webContents,
      view,
      active: false,
      deactivated: false,
      browserRevision: 0,
      lastSnapshotRevision: 0,
    };
    this.views.set(viewKey, entry);
    ownerWindow.contentView.addChildView(view);
    view.setBounds({ x: -10_000, y: -10_000, width: 1, height: 1 });
    view.webContents.setWindowOpenHandler(({ url }) => {
      let target: string;
      try {
        target = normalizeWorkbenchBrowserUrl(url);
      } catch {
        void shell.openExternal(url).catch(() => undefined);
        return { action: 'deny' };
      }
      void view.webContents.loadURL(target).catch(() => shell.openExternal(target));
      return { action: 'deny' };
    });
    view.webContents.on('context-menu', (_event, params) => {
      this.showContextMenu(viewKey, params.x, params.y);
    });
    view.webContents.on('did-start-loading', () => this.bumpRevision(viewKey, 'page started loading'));
    view.webContents.on('did-finish-load', () => {
      this.bumpRevision(viewKey, 'page finished loading');
      this.persistCurrentUrl(sessionKey, view.webContents.getURL());
    });
    view.webContents.on('did-navigate', (_event, url) => {
      this.bumpRevision(viewKey, 'navigated');
      this.persistCurrentUrl(sessionKey, url);
    });
    view.webContents.on('did-navigate-in-page', (_event, url) => {
      this.bumpRevision(viewKey, 'in-page navigation');
      this.persistCurrentUrl(sessionKey, url);
    });
    view.webContents.on('page-title-updated', () => this.bumpRevision(viewKey, 'page title changed'));
    view.webContents.on('before-input-event', () => this.bumpRevision(viewKey, 'page input'));
    void view.webContents.loadURL(readStoredWorkbenchBrowserUrl(sessionKey) ?? DEFAULT_BROWSER_URL).catch(() => undefined);
    return view;
  }

  private persistCurrentUrl(sessionKey: string | null | undefined, url: string): void {
    try {
      writeStoredWorkbenchBrowserUrl(sessionKey, url);
    } catch {
      // Browser URL persistence is a convenience; never break navigation for it.
    }
  }

  private bumpRevision(viewKey: string, reason: string): void {
    const entry = this.views.get(viewKey);
    if (!entry || entry.view.webContents.isDestroyed()) {
      return;
    }
    if (!entry.deactivated) {
      entry.active = true;
    }
    entry.browserRevision += 1;
    entry.lastChangeReason = reason;
    entry.lastChangedAt = new Date().toISOString();
  }

  private showContextMenu(viewKey: string, x: number, y: number): void {
    const entry = this.views.get(viewKey);
    if (!entry || entry.owner.isDestroyed() || entry.view.webContents.isDestroyed()) {
      return;
    }

    const menu = Menu.buildFromTemplate([
      {
        label: 'Comment on this',
        click: () => {
          void this.captureCommentTarget(entry.view, x, y)
            .then((target) => {
              if (!entry.owner.isDestroyed()) {
                entry.owner.send(BROWSER_COMMENT_CHANNEL, target);
              }
            })
            .catch(() => undefined);
        },
      },
      { type: 'separator' },
      { role: 'copy', label: 'Copy' },
      { role: 'selectAll', label: 'Select All' },
    ]);
    menu.popup({ window: entry.ownerWindow });
  }

  private async captureCommentTarget(view: WebContentsView, x: number, y: number): Promise<WorkbenchBrowserCommentTarget> {
    const target = await cdpEvaluate(
      view.webContents,
      `(() => {
      ${this.pageHelperSource()}
      const element = document.elementFromPoint(${Math.round(x)}, ${Math.round(y)}) || document.body;
      const rect = element.getBoundingClientRect();
      const parentText = element.parentElement?.innerText || document.body?.innerText || '';
      const target = {
        url: location.href,
        title: document.title || '',
        selector: selectorFor(element),
        xpath: xpathFor(element),
        role: elementRole(element),
        accessibleName: accessibleName(element),
        testId: element.getAttribute('data-testid') || element.getAttribute('data-test') || element.getAttribute('data-qa') || undefined,
        textSnippet: max(element.innerText || element.textContent || element.value || '', 500),
        surroundingText: max(parentText, 1000),
        elementHtmlPreview: max(element.outerHTML, 1200),
        pageTextQuote: max(document.body?.innerText || '', 1500),
        viewportRect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
        scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
        devicePixelRatio: window.devicePixelRatio || 1,
      };
      return JSON.parse(JSON.stringify(target));
    })()`,
    );
    return target as WorkbenchBrowserCommentTarget;
  }

  private pageHelperSource(): string {
    return String.raw`
      const max = (value, length) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
      const cssEscape = (value) => {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      };
      const elementRole = (element) => {
        const explicit = element.getAttribute('role');
        if (explicit) return explicit;
        const tag = element.tagName.toLowerCase();
        if (tag === 'button') return 'button';
        if (tag === 'a' && element.hasAttribute('href')) return 'link';
        if (tag === 'input') return element.type === 'checkbox' ? 'checkbox' : element.type === 'radio' ? 'radio' : 'textbox';
        if (tag === 'textarea') return 'textbox';
        if (tag === 'select') return 'combobox';
        if (/^h[1-6]$/.test(tag)) return 'heading';
        return tag;
      };
      const accessibleName = (element) => {
        const aria = element.getAttribute('aria-label');
        if (aria) return max(aria, 240);
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
          const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ');
          if (text.trim()) return max(text, 240);
        }
        if (element.id) {
          const label = document.querySelector('label[for="' + cssEscape(element.id) + '"]');
          if (label?.textContent?.trim()) return max(label.textContent, 240);
        }
        if (element.alt) return max(element.alt, 240);
        if (element.title) return max(element.title, 240);
        return max(element.innerText || element.textContent || element.value || '', 240);
      };
      const unique = (selector) => {
        try { return document.querySelectorAll(selector).length === 1; } catch { return false; }
      };
      const selectorFor = (element) => {
        const testIdAttribute = element.hasAttribute('data-testid') ? 'data-testid' : element.hasAttribute('data-test') ? 'data-test' : element.hasAttribute('data-qa') ? 'data-qa' : '';
        const testId = testIdAttribute ? element.getAttribute(testIdAttribute) : '';
        if (testIdAttribute && testId) {
          const selector = '[' + testIdAttribute + '="' + cssEscape(testId) + '"]';
          if (unique(selector)) return selector;
        }
        if (element.id) {
          const selector = '#' + cssEscape(element.id);
          if (unique(selector)) return selector;
        }
        const tag = element.tagName.toLowerCase();
        if (element.getAttribute('aria-label')) {
          const selector = tag + '[aria-label="' + cssEscape(element.getAttribute('aria-label')) + '"]';
          if (unique(selector)) return selector;
        }
        if (element.getAttribute('name')) {
          const selector = tag + '[name="' + cssEscape(element.getAttribute('name')) + '"]';
          if (unique(selector)) return selector;
        }
        if (tag === 'a' && element.getAttribute('href')) {
          const selector = 'a[href="' + cssEscape(element.getAttribute('href')) + '"]';
          if (unique(selector)) return selector;
        }
        const role = elementRole(element);
        const name = accessibleName(element);
        if (role && name && element.getAttribute('aria-label')) {
          const selector = '[role="' + cssEscape(role) + '"][aria-label="' + cssEscape(name) + '"]';
          if (unique(selector)) return selector;
        }
        const parts = [];
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && parts.length < 6) {
          const tag = current.tagName.toLowerCase();
          let part = tag;
          if (current.classList.length > 0) {
            part += '.' + Array.from(current.classList).slice(0, 2).map(cssEscape).join('.');
          }
          const parent = current.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
            if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
          }
          parts.unshift(part);
          const selector = parts.join(' > ');
          if (unique(selector)) return selector;
          current = parent;
        }
        return parts.join(' > ');
      };
      const xpathFor = (element) => {
        const parts = [];
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE) {
          const tag = current.tagName.toLowerCase();
          const parent = current.parentElement;
          const index = parent ? Array.from(parent.children).filter((child) => child.tagName === current.tagName).indexOf(current) + 1 : 1;
          parts.unshift(tag + '[' + index + ']');
          current = parent;
        }
        return '/' + parts.join('/');
      };
    `;
  }
}
