import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import { app } from 'electron';

export interface CodexServerModule {
  startCodexAppServer(input: { listenUrl: string }): Promise<{ websocketUrl: string; close(): Promise<void> }>;
}

let codexServerModulePromise: Promise<CodexServerModule> | null = null;

function resolvePrimaryModuleUrl(): string {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const packaged = app.isPackaged && process.env.PERSONAL_AGENT_DESKTOP_DEV_BUNDLE !== '1';
  const filePath = packaged
    ? resolve(app.getAppPath(), 'node_modules', '@personal-agent', 'web', 'dist-server', 'codex-app-server.js')
    : resolve(currentDir, '..', '..', 'web', 'dist-server', 'codex-app-server.js');
  return pathToFileURL(filePath).href;
}

function resolveFallbackModuleUrl(): string | null {
  const repoRoot = process.env.PERSONAL_AGENT_REPO_ROOT?.trim();
  if (!repoRoot) {
    return null;
  }

  const filePath = resolve(repoRoot, 'packages', 'web', 'dist-server', 'codex-app-server.js');
  if (!existsSync(filePath)) {
    return null;
  }

  return pathToFileURL(filePath).href;
}

async function importModule(moduleUrl: string): Promise<CodexServerModule> {
  return import(moduleUrl) as Promise<CodexServerModule>;
}

export async function loadCodexServerModule(): Promise<CodexServerModule> {
  if (!codexServerModulePromise) {
    codexServerModulePromise = (async () => {
      try {
        return await importModule(resolvePrimaryModuleUrl());
      } catch (error) {
        const fallback = resolveFallbackModuleUrl();
        if (!fallback) {
          throw error;
        }
        return importModule(fallback);
      }
    })();
  }

  return codexServerModulePromise;
}
