import { api } from '../client/api';
import { type DesktopWorkbenchBrowserState, getDesktopBridge } from '../desktop/desktopBridge';

function matchExtensionEventPattern(pattern: string, eventName: string): boolean {
  if (pattern === '*') return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return eventName === prefix || eventName.startsWith(`${prefix}:`);
  }
  return pattern === eventName;
}

export interface NativeExtensionClient {
  extension: {
    invoke(actionId: string, input?: unknown): Promise<unknown>;
    getManifest(): Promise<unknown>;
    listSurfaces(): Promise<unknown>;
  };
  automations: typeof api.automations;
  runs: {
    start(input: unknown): Promise<unknown>;
    get(runId: string): Promise<unknown>;
    list(): Promise<unknown>;
    readLog(runId: string, tail?: number): Promise<unknown>;
    cancel(runId: string): Promise<unknown>;
  };
  storage: {
    get<T = unknown>(key: string): Promise<T | null>;
    put(key: string, value: unknown, opts?: { expectedVersion?: number }): Promise<unknown>;
    delete(key: string): Promise<unknown>;
    list<T = unknown>(prefix?: string): Promise<Array<{ key: string; value: T }>>;
  };
  workspace: {
    tree(cwd: string, path?: string): Promise<unknown>;
    readFile(cwd: string, path: string, opts?: { force?: boolean }): Promise<unknown>;
    writeFile(cwd: string, path: string, content: string): Promise<unknown>;
    createFile(cwd: string, path: string, content?: string): Promise<unknown>;
    createFolder(cwd: string, path: string): Promise<unknown>;
    deletePath(cwd: string, path: string): Promise<unknown>;
    renamePath(cwd: string, path: string, newName: string): Promise<unknown>;
    movePath(cwd: string, path: string, targetDir: string): Promise<unknown>;
    diff(cwd: string, path: string): Promise<unknown>;
    uncommittedDiff(cwd: string): Promise<unknown>;
  };
  workbench: {
    getDetailState<T = unknown>(surfaceId: string): T | null;
    setDetailState(surfaceId: string, state: unknown): void;
  };
  browser: {
    isAvailable(): boolean;
    getState(input?: { tabId?: string | null }): Promise<DesktopWorkbenchBrowserState | null>;
    open(input: { url: string; tabId?: string | null }): Promise<DesktopWorkbenchBrowserState>;
    goBack(input?: { tabId?: string | null }): Promise<DesktopWorkbenchBrowserState>;
    goForward(input?: { tabId?: string | null }): Promise<DesktopWorkbenchBrowserState>;
    reload(input?: { tabId?: string | null }): Promise<DesktopWorkbenchBrowserState>;
    stop(input?: { tabId?: string | null }): Promise<DesktopWorkbenchBrowserState>;
    snapshot(input?: { tabId?: string | null }): Promise<unknown>;
  };
  events: {
    publish(event: string, payload: unknown): void;
    subscribe(pattern: string, handler: (event: { event: string; payload: unknown }) => void): { unsubscribe: () => void };
  };
  extensions: {
    callAction(extensionId: string, actionId: string, input?: unknown): Promise<unknown>;
    listActions(): Promise<
      Array<{ extensionId: string; extensionName: string; actions: Array<{ id: string; title?: string; description?: string }> }>
    >;
    getStatus(extensionId: string): Promise<{ enabled: boolean; healthy: boolean; errors?: string[] }>;
  };
  ui: {
    toast(message: string, type?: 'info' | 'warning' | 'error'): void;
    notify(options: { message: string; type?: 'info' | 'warning' | 'error'; details?: string; source?: string }): void;
    confirm(options: { title?: string; message: string }): Promise<boolean>;
    openModal(options: { title?: string; component: string; props?: Record<string, unknown> }): Promise<unknown>;
  };
}

function browserSessionKey(tabId?: string | null): string | null {
  return tabId ? `workbench-browser:${tabId}` : null;
}

function requireDesktopBridge() {
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error('Browser primitives are only available in the Electron desktop app.');
  return bridge;
}

const detailStateByExtensionSurface = new Map<string, unknown>();

function detailStateKey(extensionId: string, surfaceId: string): string {
  return `${extensionId}:${surfaceId}`;
}

function unwrapExtensionActionResult(response: Awaited<ReturnType<typeof api.invokeExtensionAction>>): unknown {
  if (!response.ok) {
    throw new Error(response.error);
  }
  return response.result;
}

export function createNativeExtensionClient(extensionId: string): NativeExtensionClient {
  return {
    extension: {
      async invoke(actionId, input) {
        return unwrapExtensionActionResult(await api.invokeExtensionAction(extensionId, actionId, input ?? {}));
      },
      async getManifest() {
        return api.extensionManifest(extensionId);
      },
      async listSurfaces() {
        return api.extensionSurfacesForExtension(extensionId);
      },
    },
    automations: api.automations,
    runs: {
      start(input) {
        return api.startExtensionRun(extensionId, input);
      },
      get(runId) {
        return api.durableRun(runId);
      },
      list() {
        return api.runs();
      },
      readLog(runId, tail) {
        return api.durableRunLog(runId, tail);
      },
      cancel(runId) {
        return api.cancelDurableRun(runId);
      },
    },
    storage: {
      async get<T = unknown>(key: string): Promise<T | null> {
        try {
          const document = await api.extensionState<T>(extensionId, key);
          return document.value;
        } catch (error) {
          if (error instanceof Error && /404|not found/i.test(error.message)) return null;
          throw error;
        }
      },
      put(key, value, opts) {
        return api.putExtensionState(extensionId, key, value, opts);
      },
      delete(key) {
        return api.deleteExtensionState(extensionId, key);
      },
      async list<T = unknown>(prefix = '') {
        const documents = await api.extensionStateList<T>(extensionId, prefix);
        return documents.map((document) => ({ key: document.key, value: document.value }));
      },
    },
    workspace: {
      tree(cwd, path) {
        return api.workspaceTree(cwd, path);
      },
      readFile(cwd, path, opts) {
        return api.workspaceFile(cwd, path, opts);
      },
      writeFile(cwd, path, content) {
        return api.writeWorkspaceFile(cwd, path, content);
      },
      createFile(cwd, path, content) {
        return api.createWorkspaceFile(cwd, path, content);
      },
      createFolder(cwd, path) {
        return api.createWorkspaceFolder(cwd, path);
      },
      deletePath(cwd, path) {
        return api.deleteWorkspacePath(cwd, path);
      },
      renamePath(cwd, path, newName) {
        return api.renameWorkspacePath(cwd, path, newName);
      },
      movePath(cwd, path, targetDir) {
        return api.moveWorkspacePath(cwd, path, targetDir);
      },
      diff(cwd, path) {
        return api.workspaceDiff(cwd, path);
      },
      uncommittedDiff(cwd) {
        return api.workspaceUncommittedDiff(cwd);
      },
    },
    workbench: {
      getDetailState<T = unknown>(surfaceId: string): T | null {
        return (detailStateByExtensionSurface.get(detailStateKey(extensionId, surfaceId)) as T | undefined) ?? null;
      },
      setDetailState(surfaceId, state) {
        detailStateByExtensionSurface.set(detailStateKey(extensionId, surfaceId), state);
        window.dispatchEvent(new CustomEvent('pa-extension-workbench-detail-state', { detail: { extensionId, surfaceId, state } }));
      },
    },
    browser: {
      isAvailable() {
        return getDesktopBridge() !== null;
      },
      getState(input) {
        return requireDesktopBridge().getWorkbenchBrowserState({ sessionKey: browserSessionKey(input?.tabId) });
      },
      open(input) {
        return requireDesktopBridge().navigateWorkbenchBrowser({ url: input.url, sessionKey: browserSessionKey(input.tabId) });
      },
      goBack(input) {
        return requireDesktopBridge().goBackWorkbenchBrowser({ sessionKey: browserSessionKey(input?.tabId) });
      },
      goForward(input) {
        return requireDesktopBridge().goForwardWorkbenchBrowser({ sessionKey: browserSessionKey(input?.tabId) });
      },
      reload(input) {
        return requireDesktopBridge().reloadWorkbenchBrowser({ sessionKey: browserSessionKey(input?.tabId) });
      },
      stop(input) {
        return requireDesktopBridge().stopWorkbenchBrowser({ sessionKey: browserSessionKey(input?.tabId) });
      },
      snapshot(input) {
        return requireDesktopBridge().snapshotWorkbenchBrowser({ sessionKey: browserSessionKey(input?.tabId) });
      },
    },
    events: {
      publish(event, payload) {
        window.dispatchEvent(
          new CustomEvent('pa-ext-event', {
            detail: { sourceExtensionId: extensionId, event, payload, publishedAt: new Date().toISOString() },
          }),
        );
      },
      subscribe(pattern, handler) {
        function listener(raw: CustomEvent) {
          const detail = raw.detail as { event: string; payload: unknown };
          if (!matchExtensionEventPattern(pattern, detail.event)) return;
          handler(detail);
        }
        window.addEventListener('pa-ext-event', listener as EventListener);
        return { unsubscribe: () => window.removeEventListener('pa-ext-event', listener as EventListener) };
      },
    },
    extensions: {
      async callAction(targetExtensionId, actionId, input) {
        return unwrapExtensionActionResult(await api.invokeExtensionAction(targetExtensionId, actionId, input ?? {}));
      },
      async listActions() {
        return api.listExtensionActions();
      },
      async getStatus(targetExtensionId) {
        return api.extensionStatus(targetExtensionId);
      },
    },
    ui: {
      toast(message, type) {
        window.dispatchEvent(new CustomEvent('pa-extension-toast', { detail: { extensionId, message, type: type ?? 'info' } }));
      },
      notify(options) {
        window.dispatchEvent(
          new CustomEvent('pa-notification', {
            detail: {
              message: options.message,
              type: options.type ?? 'info',
              details: options.details,
              source: options.source ?? extensionId,
            },
          }),
        );
      },
      async confirm(options) {
        return window.confirm(options.title ? `${options.title}\n\n${options.message}` : options.message);
      },
      openModal(options) {
        return new Promise((resolve, reject) => {
          window.dispatchEvent(new CustomEvent('pa-extension-modal', { detail: { extensionId, ...options, resolve, reject } }));
        });
      },
    },
  };
}
