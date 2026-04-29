import { BrowserWindow, WebContentsView, shell, type WebContents } from 'electron';

const DEFAULT_BROWSER_URL = 'https://www.google.com/search?q=personal%20agent';
const MAX_SNAPSHOT_TEXT_LENGTH = 30_000;
const MAX_ACTIONS_PER_BATCH = 25;
const MAX_ACTION_TEXT_LENGTH = 5_000;

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
}

export interface WorkbenchBrowserSnapshot extends WorkbenchBrowserState {
  text: string;
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

function getState(webContents: WebContents): WorkbenchBrowserState {
  return {
    url: webContents.getURL(),
    title: webContents.getTitle(),
    loading: webContents.isLoadingMainFrame(),
    canGoBack: webContents.canGoBack(),
    canGoForward: webContents.canGoForward(),
  };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export class WorkbenchBrowserViewController {
  private views = new Map<number, { ownerWindow: BrowserWindow; view: WebContentsView }>();

  getState(ownerWebContentsId: number): WorkbenchBrowserState | null {
    const view = this.views.get(ownerWebContentsId);
    return view ? getState(view.view.webContents) : null;
  }

  setBounds(owner: WebContents, visible: boolean, bounds: WorkbenchBrowserBounds | null): WorkbenchBrowserState | null {
    const ownerWindow = BrowserWindow.fromWebContents(owner);
    if (!ownerWindow || ownerWindow.isDestroyed()) {
      return null;
    }

    if (!visible || !bounds) {
      this.hide(owner.id);
      return this.getState(owner.id);
    }

    const view = this.ensureView(ownerWindow, owner.id);
    view.setBounds(bounds);
    return getState(view.webContents);
  }

  async navigate(owner: WebContents, inputUrl: unknown): Promise<WorkbenchBrowserState> {
    const ownerWindow = this.requireOwnerWindow(owner);
    const view = this.ensureView(ownerWindow, owner.id);
    const url = normalizeWorkbenchBrowserUrl(inputUrl);
    await view.webContents.loadURL(url);
    return getState(view.webContents);
  }

  async goBack(owner: WebContents): Promise<WorkbenchBrowserState> {
    const view = this.requireView(owner);
    if (view.webContents.canGoBack()) {
      view.webContents.goBack();
      await wait(120);
    }
    return getState(view.webContents);
  }

  async goForward(owner: WebContents): Promise<WorkbenchBrowserState> {
    const view = this.requireView(owner);
    if (view.webContents.canGoForward()) {
      view.webContents.goForward();
      await wait(120);
    }
    return getState(view.webContents);
  }

  async reload(owner: WebContents): Promise<WorkbenchBrowserState> {
    const view = this.requireView(owner);
    view.webContents.reload();
    await wait(120);
    return getState(view.webContents);
  }

  stop(owner: WebContents): WorkbenchBrowserState {
    const view = this.requireView(owner);
    view.webContents.stop();
    return getState(view.webContents);
  }

  async snapshot(owner: WebContents): Promise<WorkbenchBrowserSnapshot> {
    const view = this.requireView(owner);
    const text = await view.webContents.executeJavaScript(`(() => {
      const title = document.title ? 'Title: ' + document.title + '\\n' : '';
      const url = location.href ? 'URL: ' + location.href + '\\n' : '';
      const body = document.body ? document.body.innerText : '';
      return (url + title + body).slice(0, ${MAX_SNAPSHOT_TEXT_LENGTH});
    })()`, true);

    return {
      ...getState(view.webContents),
      text: typeof text === 'string' ? text : '',
    };
  }

  async runActions(owner: WebContents, rawActions: unknown): Promise<WorkbenchBrowserBatchResult> {
    const actions = normalizeWorkbenchBrowserActions(rawActions);
    const view = this.requireView(owner);
    const completed: WorkbenchBrowserBatchResult['actions'] = [];

    for (let index = 0; index < actions.length; index += 1) {
      const action = actions[index]!;
      await this.runAction(view, action);
      completed.push({ index, type: action.type, ok: true });
    }

    return {
      ok: true,
      actions: completed,
      snapshot: await this.snapshot(owner),
    };
  }

  destroy(ownerWebContentsId: number): void {
    const entry = this.views.get(ownerWebContentsId);
    if (!entry) {
      return;
    }
    this.views.delete(ownerWebContentsId);
    try {
      entry.ownerWindow.contentView.removeChildView(entry.view);
    } catch {
      // Best-effort cleanup. Electron may already have torn down the window.
    }
    entry.view.webContents.close();
  }

  private hide(ownerWebContentsId: number): void {
    const entry = this.views.get(ownerWebContentsId);
    if (!entry) {
      return;
    }
    entry.view.setBounds({ x: -10_000, y: -10_000, width: 1, height: 1 });
  }

  private requireOwnerWindow(owner: WebContents): BrowserWindow {
    const ownerWindow = BrowserWindow.fromWebContents(owner);
    if (!ownerWindow || ownerWindow.isDestroyed()) {
      throw new Error('Workbench browser owner window is unavailable.');
    }
    return ownerWindow;
  }

  private requireView(owner: WebContents): WebContentsView {
    const ownerWindow = this.requireOwnerWindow(owner);
    return this.ensureView(ownerWindow, owner.id);
  }

  private ensureView(ownerWindow: BrowserWindow, ownerWebContentsId: number): WebContentsView {
    const existing = this.views.get(ownerWebContentsId);
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
    this.views.set(ownerWebContentsId, { ownerWindow, view });
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
    void view.webContents.loadURL(DEFAULT_BROWSER_URL).catch(() => undefined);
    return view;
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
