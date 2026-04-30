import { BrowserWindow, Menu, WebContentsView, shell, type WebContents } from 'electron';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DEFAULT_BROWSER_URL = 'https://www.google.com/';
const MAX_SNAPSHOT_TEXT_LENGTH = 30_000;
const MAX_ACTIONS_PER_BATCH = 25;
const MAX_ACTION_TEXT_LENGTH = 5_000;
const MAX_BROWSER_SCRIPT_LENGTH = 80_000;
const MAX_BROWSER_SCRIPT_TIMEOUT_MS = 60_000;
const BROWSER_COMMENT_CHANNEL = 'personal-agent-desktop:workbench-browser-comment';

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

export interface WorkbenchBrowserScriptResult {
  ok: true;
  result: unknown;
  logs: string[];
  snapshot: WorkbenchBrowserSnapshot;
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

export type WorkbenchBrowserAction =
  | { type: 'click'; selector: string }
  | { type: 'type'; selector: string; text: string }
  | { type: 'key'; key: string }
  | { type: 'scroll'; x?: number; y?: number }
  | { type: 'wait'; ms: number };

export interface WorkbenchBrowserBatchResult {
  ok: true;
  actions: Array<{ index: number; type: WorkbenchBrowserAction['type']; ok: true }>;
  snapshot: WorkbenchBrowserSnapshot;
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

function normalizeSelector(input: unknown, label: string): string {
  const selector = typeof input === 'string' ? input.trim() : '';
  if (!selector) {
    throw new Error(`${label} selector is required.`);
  }
  if (selector.length > 1_000) {
    throw new Error(`${label} selector is too long.`);
  }
  return selector;
}

function normalizeAction(input: unknown): WorkbenchBrowserAction {
  if (!input || typeof input !== 'object') {
    throw new Error('Action must be an object.');
  }

  const action = input as Record<string, unknown>;
  switch (action.type) {
    case 'click':
      return { type: 'click', selector: normalizeSelector(action.selector, 'Click') };
    case 'type': {
      const text = typeof action.text === 'string' ? action.text : '';
      if (text.length > MAX_ACTION_TEXT_LENGTH) {
        throw new Error('Type action text is too long.');
      }
      return { type: 'type', selector: normalizeSelector(action.selector, 'Type'), text };
    }
    case 'key': {
      const key = typeof action.key === 'string' ? action.key.trim() : '';
      if (!key || key.length > 80) {
        throw new Error('Key action requires a short key name.');
      }
      return { type: 'key', key };
    }
    case 'scroll': {
      const x = typeof action.x === 'number' && Number.isFinite(action.x) ? action.x : 0;
      const y = typeof action.y === 'number' && Number.isFinite(action.y) ? action.y : 0;
      return { type: 'scroll', x, y };
    }
    case 'wait': {
      const ms = typeof action.ms === 'number' && Number.isFinite(action.ms) ? Math.max(0, Math.min(10_000, Math.round(action.ms))) : 500;
      return { type: 'wait', ms };
    }
    default:
      throw new Error('Unsupported browser action type.');
  }
}

export function normalizeWorkbenchBrowserActions(input: unknown): WorkbenchBrowserAction[] {
  if (!Array.isArray(input)) {
    throw new Error('Actions must be an array.');
  }
  if (input.length > MAX_ACTIONS_PER_BATCH) {
    throw new Error(`A batch can run at most ${MAX_ACTIONS_PER_BATCH} actions.`);
  }
  return input.map(normalizeAction);
}

interface WorkbenchBrowserViewEntry {
  ownerWindow: BrowserWindow;
  owner: WebContents;
  view: WebContentsView;
  browserRevision: number;
  lastSnapshotRevision: number;
  lastChangeReason?: string;
  lastChangedAt?: string;
}

function getState(webContents: WebContents, entry?: WorkbenchBrowserViewEntry): WorkbenchBrowserState {
  return {
    url: webContents.getURL(),
    title: webContents.getTitle(),
    loading: webContents.isLoadingMainFrame(),
    canGoBack: webContents.canGoBack(),
    canGoForward: webContents.canGoForward(),
    browserRevision: entry?.browserRevision ?? 0,
    lastSnapshotRevision: entry?.lastSnapshotRevision ?? 0,
    changedSinceLastSnapshot: (entry?.browserRevision ?? 0) > (entry?.lastSnapshotRevision ?? 0),
    ...(entry?.lastChangeReason ? { lastChangeReason: entry.lastChangeReason } : {}),
    ...(entry?.lastChangedAt ? { lastChangedAt: entry.lastChangedAt } : {}),
  };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function getScriptWorkerPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), 'workbench-browser-script-worker.js');
}

export class WorkbenchBrowserViewController {
  private views = new Map<string, WorkbenchBrowserViewEntry>();
  private activeViewKeysByOwner = new Map<number, string>();
  private snapshotRefs = new Map<string, Map<string, { selector: string; xpath: string }>>();

  getState(ownerWebContentsId: number, sessionKey?: string | null): WorkbenchBrowserState | null {
    const entry = this.views.get(this.viewKey(ownerWebContentsId, sessionKey));
    return entry ? getState(entry.view.webContents, entry) : null;
  }

  hasView(ownerWebContentsId: number, sessionKey?: string | null): boolean {
    const entry = this.views.get(this.viewKey(ownerWebContentsId, sessionKey));
    return Boolean(entry && !entry.view.webContents.isDestroyed());
  }

  setBounds(owner: WebContents, visible: boolean, bounds: WorkbenchBrowserBounds | null, sessionKey?: string | null): WorkbenchBrowserState | null {
    const ownerWindow = BrowserWindow.fromWebContents(owner);
    if (!ownerWindow || ownerWindow.isDestroyed()) {
      return null;
    }

    if (!visible || !bounds) {
      this.hide(this.viewKey(owner.id, sessionKey));
      return this.getState(owner.id, sessionKey);
    }

    const viewKey = this.viewKey(owner.id, sessionKey);
    this.hideActiveOwnerView(owner.id, viewKey);
    const view = this.ensureView(ownerWindow, owner.id, sessionKey);
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
    if (view.webContents.canGoBack()) {
      view.webContents.goBack();
      await wait(120);
    }
    return getState(view.webContents, this.views.get(this.viewKey(owner.id, sessionKey)));
  }

  async goForward(owner: WebContents, sessionKey?: string | null): Promise<WorkbenchBrowserState> {
    const view = this.requireView(owner, sessionKey);
    if (view.webContents.canGoForward()) {
      view.webContents.goForward();
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
    const raw = await view.webContents.executeJavaScript(`(() => {
      ${this.pageHelperSource()}
      const title = document.title ? 'Title: ' + document.title + '\n' : '';
      const url = location.href ? 'URL: ' + location.href + '\n' : '';
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
    })()`, true);

    const text = raw && typeof raw === 'object' && typeof raw.text === 'string' ? raw.text : '';
    const elements = raw && typeof raw === 'object' && Array.isArray(raw.elements)
      ? raw.elements as WorkbenchBrowserSnapshotElement[]
      : [];
    const viewKey = this.viewKey(owner.id, sessionKey);
    this.snapshotRefs.set(viewKey, new Map(elements.map((element) => [element.ref, { selector: element.selector, xpath: element.xpath }])));
    const entry = this.views.get(viewKey);
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
    const image = await view.webContents.capturePage();
    const bounds = view.getBounds();
    return {
      ...getState(view.webContents, this.views.get(this.viewKey(owner.id, sessionKey))),
      mimeType: 'image/png',
      dataBase64: image.toPNG().toString('base64'),
      viewport: { width: bounds.width, height: bounds.height },
      capturedAt: new Date().toISOString(),
    };
  }

  async runScript(owner: WebContents, input: { script?: unknown; timeoutMs?: unknown; sessionKey?: string | null }): Promise<WorkbenchBrowserScriptResult> {
    const script = typeof input.script === 'string' ? input.script : '';
    if (!script.trim()) {
      throw new Error('browser_script requires a script.');
    }
    if (script.length > MAX_BROWSER_SCRIPT_LENGTH) {
      throw new Error(`browser_script script is too long. Max ${MAX_BROWSER_SCRIPT_LENGTH} characters.`);
    }
    const timeoutMs = typeof input.timeoutMs === 'number' && Number.isFinite(input.timeoutMs)
      ? Math.max(1_000, Math.min(MAX_BROWSER_SCRIPT_TIMEOUT_MS, Math.round(input.timeoutMs)))
      : 30_000;
    const view = this.requireView(owner, input.sessionKey);
    const worker = new Worker(getScriptWorkerPath());

    try {
      const output = await new Promise<{ result: unknown; logs: string[] }>((resolvePromise, rejectPromise) => {
        const timeout = setTimeout(() => {
          rejectPromise(new Error(`browser_script timed out after ${timeoutMs}ms.`));
        }, timeoutMs);

        worker.on('message', (message: unknown) => {
          const payload = message as { type?: string; request?: { id: number; op: string; args: unknown[] }; result?: unknown; logs?: string[]; error?: string };
          if (payload.type === 'done') {
            clearTimeout(timeout);
            resolvePromise({ result: payload.result, logs: Array.isArray(payload.logs) ? payload.logs : [] });
            return;
          }
          if (payload.type === 'error') {
            clearTimeout(timeout);
            rejectPromise(new Error(payload.error || 'browser_script failed.'));
            return;
          }
          if (payload.type === 'rpc' && payload.request) {
            const request = payload.request;
            void this.runScriptOperation(owner, view, request.op, request.args, input.sessionKey)
              .then((value) => worker.postMessage({ type: 'rpc-response', response: { id: request.id, ok: true, value } }))
              .catch((error) => worker.postMessage({ type: 'rpc-response', response: { id: request.id, ok: false, error: error instanceof Error ? error.message : String(error) } }));
          }
        });
        worker.on('error', (error) => {
          clearTimeout(timeout);
          rejectPromise(error);
        });
        worker.postMessage({ type: 'start', script });
      });

      return {
        ok: true,
        result: output.result,
        logs: output.logs,
        snapshot: await this.snapshot(owner, input.sessionKey),
      };
    } finally {
      await worker.terminate().catch(() => undefined);
    }
  }

  async runActions(owner: WebContents, rawActions: unknown, sessionKey?: string | null): Promise<WorkbenchBrowserBatchResult> {
    const actions = normalizeWorkbenchBrowserActions(rawActions);
    const view = this.requireView(owner, sessionKey);
    const completed: WorkbenchBrowserBatchResult['actions'] = [];

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index]!;
      await this.runAction(view, action);
      completed.push({ index, type: action.type, ok: true });
    }

    return {
      ok: true,
      actions: completed,
      snapshot: await this.snapshot(owner, sessionKey),
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
      this.snapshotRefs.delete(viewKey);
    }
    this.activeViewKeysByOwner.delete(ownerWebContentsId);
  }

  private viewKey(ownerWebContentsId: number, sessionKey?: string | null): string {
    const normalizedSessionKey = sessionKey?.trim() || 'default';
    return `${ownerWebContentsId}:${normalizedSessionKey}`;
  }

  private hide(viewKey: string): void {
    const entry = this.views.get(viewKey);
    if (!entry) {
      return;
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
      browserRevision: 0,
      lastSnapshotRevision: 0,
    };
    this.views.set(viewKey, entry);
    ownerWindow.contentView.addChildView(view);
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
    view.webContents.on('did-finish-load', () => this.bumpRevision(viewKey, 'page finished loading'));
    view.webContents.on('did-navigate', () => this.bumpRevision(viewKey, 'navigated'));
    view.webContents.on('did-navigate-in-page', () => this.bumpRevision(viewKey, 'in-page navigation'));
    view.webContents.on('page-title-updated', () => this.bumpRevision(viewKey, 'page title changed'));
    view.webContents.on('before-input-event', () => this.bumpRevision(viewKey, 'page input'));
    void view.webContents.loadURL(DEFAULT_BROWSER_URL).catch(() => undefined);
    return view;
  }

  private bumpRevision(viewKey: string, reason: string): void {
    const entry = this.views.get(viewKey);
    if (!entry || entry.view.webContents.isDestroyed()) {
      return;
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
    const script = `(() => {
      const max = (value, length) => String(value || '').replace(/\\s+/g, ' ').trim().slice(0, length);
      const cssEscape = (value) => {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
        return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
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
          const text = labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.innerText || '').join(' ');
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
          const ariaSelector = tag + '[aria-label="' + cssEscape(element.getAttribute('aria-label')) + '"]';
          if (unique(ariaSelector)) return ariaSelector;
        }
        if (element.getAttribute('name')) {
          const nameSelector = tag + '[name="' + cssEscape(element.getAttribute('name')) + '"]';
          if (unique(nameSelector)) return nameSelector;
        }
        if (tag === 'a' && element.getAttribute('href')) {
          const hrefSelector = 'a[href="' + cssEscape(element.getAttribute('href')) + '"]';
          if (unique(hrefSelector)) return hrefSelector;
        }
        const role = elementRole(element);
        const name = accessibleName(element);
        if (role && name && element.getAttribute('aria-label')) {
          const roleSelector = '[role="' + cssEscape(role) + '"][aria-label="' + cssEscape(name) + '"]';
          if (unique(roleSelector)) return roleSelector;
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
    })()`;
    const target = await view.webContents.executeJavaScript(script, true);
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
        const parts = [];
        let current = element;
        while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.body && parts.length < 6) {
          const tag = current.tagName.toLowerCase();
          let part = tag;
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
      const resolveTarget = (selectorOrRef, refs) => {
        const ref = refs[String(selectorOrRef || '')];
        const selector = ref?.selector || String(selectorOrRef || '');
        let element = selector ? document.querySelector(selector) : null;
        if (!element && ref?.xpath) {
          element = document.evaluate(ref.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
        }
        if (!element) throw new Error('No element matches: ' + selectorOrRef);
        return element;
      };
    `;
  }

  private resolveRefs(owner: WebContents, sessionKey?: string | null): Record<string, { selector: string; xpath: string }> {
    return Object.fromEntries(this.snapshotRefs.get(this.viewKey(owner.id, sessionKey))?.entries() ?? []);
  }

  private async runScriptOperation(owner: WebContents, view: WebContentsView, op: string, args: unknown[], sessionKey?: string | null): Promise<unknown> {
    switch (op) {
      case 'goto': return this.navigate(owner, args[0], sessionKey);
      case 'reload': return this.reload(owner, sessionKey);
      case 'back': return this.goBack(owner, sessionKey);
      case 'forward': return this.goForward(owner, sessionKey);
      case 'url': return view.webContents.getURL();
      case 'title': return view.webContents.getTitle();
      case 'snapshot': return this.snapshot(owner, sessionKey);
      case 'screenshot': return this.screenshot(owner, sessionKey);
      case 'click': await this.runAction(view, { type: 'click', selector: this.resolveSelector(owner, args[0], sessionKey) }); return true;
      case 'type': await this.runAction(view, { type: 'type', selector: this.resolveSelector(owner, args[0], sessionKey), text: String(args[1] ?? '') }); return true;
      case 'press': await this.runAction(view, { type: 'key', key: String(args[0] ?? '') }); return true;
      case 'scroll': await this.runAction(view, { type: 'scroll', x: Number(args[0] ?? 0), y: Number(args[1] ?? 0) }); return true;
      case 'wait': await wait(Math.max(0, Math.min(30_000, Math.round(Number(args[0] ?? 500))))); return true;
      case 'text': return this.evaluateDomOperation(owner, view, 'text', args, sessionKey);
      case 'html': return this.evaluateDomOperation(owner, view, 'html', args, sessionKey);
      case 'exists': return this.evaluateDomOperation(owner, view, 'exists', args, sessionKey);
      case 'query': return this.evaluateDomOperation(owner, view, 'query', args, sessionKey);
      case 'select': return this.evaluateDomOperation(owner, view, 'select', args, sessionKey);
      case 'check': return this.evaluateDomOperation(owner, view, 'check', args, sessionKey);
      case 'uncheck': return this.evaluateDomOperation(owner, view, 'uncheck', args, sessionKey);
      case 'setInputFiles': return this.evaluateDomOperation(owner, view, 'setInputFiles', args, sessionKey);
      case 'waitFor': return this.waitForDom(owner, view, String(args[0] ?? ''), false, sessionKey);
      case 'waitForText': return this.waitForDom(owner, view, String(args[0] ?? ''), true, sessionKey);
      case 'waitForLoadState': return this.waitForLoadState(view);
      case 'evaluate': return this.evaluatePage(view, args);
      default: throw new Error(`Unsupported browser operation: ${op}`);
    }
  }

  private resolveSelector(owner: WebContents, selectorOrRef: unknown, sessionKey?: string | null): string {
    const raw = typeof selectorOrRef === 'string' ? selectorOrRef.trim() : '';
    if (!raw) throw new Error('selector/ref is required.');
    return this.snapshotRefs.get(this.viewKey(owner.id, sessionKey))?.get(raw)?.selector ?? raw;
  }

  private async evaluateDomOperation(owner: WebContents, view: WebContentsView, op: string, args: unknown[], sessionKey?: string | null): Promise<unknown> {
    const refs = this.resolveRefs(owner, sessionKey);
    return view.webContents.executeJavaScript(`(() => {
      ${this.pageHelperSource()}
      const refs = ${JSON.stringify(refs)};
      const op = ${JSON.stringify(op)};
      const selectorOrRef = ${JSON.stringify(args[0] ?? '')};
      if (op === 'text' && !selectorOrRef) return document.body?.innerText || '';
      if (op === 'html' && !selectorOrRef) return document.documentElement?.outerHTML || '';
      let element;
      try { element = resolveTarget(selectorOrRef, refs); } catch (error) { if (op === 'exists') return false; throw error; }
      if (op === 'exists') return true;
      if (op === 'text') return element.innerText || element.textContent || element.value || '';
      if (op === 'html') return element.outerHTML || '';
      if (op === 'query') { const rect = element.getBoundingClientRect(); return { selector: selectorFor(element), xpath: xpathFor(element), role: elementRole(element), name: accessibleName(element), text: max(element.innerText || element.textContent || element.value || '', 500), bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) } }; }
      if (op === 'select') { element.value = ${JSON.stringify(args[1] ?? '')}; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return true; }
      if (op === 'check' || op === 'uncheck') { element.checked = op === 'check'; element.dispatchEvent(new Event('input', { bubbles: true })); element.dispatchEvent(new Event('change', { bubbles: true })); return true; }
      if (op === 'setInputFiles') throw new Error('setInputFiles is not supported by the embedded browser yet.');
      throw new Error('Unsupported DOM operation: ' + op);
    })()`, true);
  }

  private async waitForDom(owner: WebContents, view: WebContentsView, target: string, textMode: boolean, sessionKey?: string | null): Promise<boolean> {
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const found = textMode
        ? await view.webContents.executeJavaScript(`(document.body?.innerText || '').includes(${JSON.stringify(target)})`, true)
        : await this.evaluateDomOperation(owner, view, 'exists', [target], sessionKey);
      if (found) return true;
      await wait(100);
    }
    throw new Error(`Timed out waiting for ${textMode ? 'text' : 'selector'}: ${target}`);
  }

  private async waitForLoadState(view: WebContentsView): Promise<boolean> {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (!view.webContents.isLoadingMainFrame()) return true;
      await wait(100);
    }
    throw new Error('Timed out waiting for page load.');
  }

  private async evaluatePage(view: WebContentsView, args: unknown[]): Promise<unknown> {
    const source = typeof args[0] === 'string' ? args[0] : '';
    if (!source.trim()) throw new Error('evaluate requires source.');
    if (view.webContents.getURL().startsWith('personal-agent://app')) {
      throw new Error('browser.evaluate is blocked on Personal Agent app pages.');
    }
    const fnArgs = args.slice(1);
    return view.webContents.executeJavaScript(`(() => {
      const source = ${JSON.stringify(source)};
      const args = ${JSON.stringify(fnArgs)};
      const fn = source.trim().startsWith('function') || source.trim().startsWith('(') ? (0, eval)('(' + source + ')') : null;
      return fn ? fn(...args) : (0, eval)(source);
    })()`, true);
  }

  private async runAction(view: WebContentsView, action: WorkbenchBrowserAction): Promise<void> {
    switch (action.type) {
      case 'click':
        await view.webContents.executeJavaScript(`(() => {
          const selector = ${JSON.stringify(action.selector)};
          const element = document.querySelector(selector);
          if (!element) throw new Error('No element matches selector: ' + selector);
          element.scrollIntoView({ block: 'center', inline: 'center' });
          element.click();
        })()`, true);
        return;
      case 'type':
        await view.webContents.executeJavaScript(`(() => {
          const selector = ${JSON.stringify(action.selector)};
          const element = document.querySelector(selector);
          if (!element) throw new Error('No element matches selector: ' + selector);
          element.focus();
          const value = ${JSON.stringify(action.text)};
          if ('value' in element) {
            element.value = value;
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            element.textContent = value;
          }
        })()`, true);
        return;
      case 'key':
        view.webContents.sendInputEvent({ type: 'keyDown', keyCode: action.key });
        view.webContents.sendInputEvent({ type: 'keyUp', keyCode: action.key });
        await wait(60);
        return;
      case 'scroll':
        await view.webContents.executeJavaScript(`window.scrollBy(${Number(action.x ?? 0)}, ${Number(action.y ?? 0)})`, true);
        return;
      case 'wait':
        await wait(action.ms);
        return;
    }
  }
}
