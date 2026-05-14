import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

function candidateDaemonBundlePaths(): string[] {
  const candidates: string[] = [];
  if (process.env.PERSONAL_AGENT_REPO_ROOT) {
    candidates.push(resolve(process.env.PERSONAL_AGENT_REPO_ROOT, 'packages/desktop/server/dist/daemon/index.js'));
  }
  candidates.push(resolve(process.cwd(), 'packages/desktop/server/dist/daemon/index.js'));
  if (typeof process.resourcesPath === 'string') {
    candidates.push(resolve(process.resourcesPath, 'app.asar.unpacked/packages/desktop/server/dist/daemon/index.js'));
    candidates.push(resolve(process.resourcesPath, 'app.asar.unpacked/server/dist/daemon/index.js'));
    candidates.push(resolve(process.resourcesPath, 'server/dist/daemon/index.js'));
  }
  candidates.push(resolve(dirname(new URL(import.meta.url).pathname), '../../server/dist/daemon/index.js'));
  return candidates;
}

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

export async function loadDaemonModule(): Promise<Record<string, unknown>> {
  for (const candidate of candidateDaemonBundlePaths()) {
    if (existsSync(candidate)) {
      return dynamicImport(pathToFileURL(candidate).href);
    }
  }
  return dynamicImport('@personal-agent/daemon');
}

export async function callDaemonExport<T>(name: string, ...args: unknown[]): Promise<T> {
  const daemon = await loadDaemonModule();
  const fn = daemon[name];
  if (typeof fn !== 'function') {
    throw new Error(`Daemon export ${name} is unavailable.`);
  }
  return (fn as (...callArgs: unknown[]) => Promise<T> | T)(...args);
}
