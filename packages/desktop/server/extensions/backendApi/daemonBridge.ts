import { importServerModule } from './serverModuleResolver.js';

export async function loadDaemonModule(): Promise<Record<string, unknown>> {
  return importServerModule('@personal-agent/daemon');
}

export async function callDaemonExport<T>(name: string, ...args: unknown[]): Promise<T> {
  const daemon = await loadDaemonModule();
  const fn = daemon[name];
  if (typeof fn !== 'function') {
    throw new Error(`Daemon export ${name} is unavailable.`);
  }
  return (fn as (...callArgs: unknown[]) => Promise<T> | T)(...args);
}
