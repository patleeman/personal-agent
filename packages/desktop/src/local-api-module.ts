import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { DesktopApiStreamEvent } from './hosts/types.js';

export type DesktopAppBridgeEvent =
  | { type: 'open' }
  | { type: 'event'; event: unknown }
  | { type: 'error'; message: string }
  | { type: 'close' };

export interface DesktopLocalApiDispatchResult {
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface LocalApiModule {
  invokeDesktopLocalApi<T = unknown>(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<T>;
  dispatchDesktopLocalApiRequest(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<DesktopLocalApiDispatchResult>;
  subscribeDesktopLocalApiStream(
    path: string,
    onEvent: (event: DesktopApiStreamEvent) => void,
  ): Promise<() => void>;
  subscribeDesktopAppEvents(
    onEvent: (event: DesktopAppBridgeEvent) => void,
  ): Promise<() => void>;
}

export type LocalApiModuleLoader = () => Promise<LocalApiModule>;

let localApiModulePromise: Promise<LocalApiModule> | null = null;

export function loadLocalApiModule(): Promise<LocalApiModule> {
  if (!localApiModulePromise) {
    const currentDir = dirname(fileURLToPath(import.meta.url));
    const moduleUrl = pathToFileURL(resolve(currentDir, '..', '..', 'web', 'dist-server', 'app', 'localApi.js')).href;
    localApiModulePromise = import(moduleUrl) as Promise<LocalApiModule>;
  }

  return localApiModulePromise;
}
