import { api } from '../client/api';

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
  ui: {
    toast(message: string): void;
    confirm(options: { title?: string; message: string }): Promise<boolean>;
  };
}

export function createNativeExtensionClient(extensionId: string): NativeExtensionClient {
  return {
    extension: {
      async invoke(actionId, input) {
        return (await api.invokeExtensionAction(extensionId, actionId, input ?? {})).result;
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
    ui: {
      toast(message) {
        window.dispatchEvent(new CustomEvent('pa-extension-toast', { detail: { extensionId, message } }));
      },
      async confirm(options) {
        return window.confirm(options.title ? `${options.title}\n\n${options.message}` : options.message);
      },
    },
  };
}
