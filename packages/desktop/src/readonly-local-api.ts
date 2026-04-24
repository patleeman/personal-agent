import { Worker } from 'node:worker_threads';
import type { DesktopLocalApiDispatchResult } from './local-api-module.js';

const READONLY_LOCAL_API_PATHS = new Set([
  '/api/knowledge-base',
  '/api/vault-files',
  '/api/vault/file',
  '/api/vault/backlinks',
  '/api/vault/tree',
  '/api/vault/search',
  '/api/vault/note-search',
]);

interface ReadonlyLocalApiRequest {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

interface ReadonlyLocalApiWorkerRequest {
  id: number;
  input: ReadonlyLocalApiRequest;
}

interface ReadonlyLocalApiWorkerSuccess {
  id: number;
  ok: true;
  result: DesktopLocalApiDispatchResult;
}

interface ReadonlyLocalApiWorkerFailure {
  id: number;
  ok: false;
  error: string;
}

function renderWorkerExitError(code: number | null): Error {
  return new Error(`Readonly local API worker exited unexpectedly${code === null ? '' : ` (code ${code})`}.`);
}

function createReadonlyLocalApiWorker(): Worker {
  return new Worker(new URL('./readonly-local-api-worker.js', import.meta.url));
}

export function shouldDispatchReadonlyLocalApiInWorker(input: { method: string; path: string; hostId?: string | null }): boolean {
  if (input.hostId && input.hostId !== 'local') {
    return false;
  }

  if (input.method !== 'GET') {
    return false;
  }

  const pathname = new URL(input.path, 'http://desktop.local').pathname;
  return READONLY_LOCAL_API_PATHS.has(pathname);
}

class ReadonlyLocalApiWorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 0;
  private pending = new Map<number, {
    resolve: (value: DesktopLocalApiDispatchResult) => void;
    reject: (error: Error) => void;
  }>();

  async dispatch(input: ReadonlyLocalApiRequest): Promise<DesktopLocalApiDispatchResult> {
    const worker = this.ensureWorker();

    return new Promise<DesktopLocalApiDispatchResult>((resolve, reject) => {
      const id = this.nextRequestId + 1;
      this.nextRequestId = id;
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, input } satisfies ReadonlyLocalApiWorkerRequest);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const worker = createReadonlyLocalApiWorker();
    worker.on('message', (message: ReadonlyLocalApiWorkerSuccess | ReadonlyLocalApiWorkerFailure) => {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }

      this.pending.delete(message.id);
      if (message.ok) {
        pending.resolve(message.result);
        return;
      }

      pending.reject(new Error(message.error));
    });
    worker.on('error', (error) => {
      this.failPending(error instanceof Error ? error : new Error(String(error)));
      this.disposeWorker(worker);
    });
    worker.on('exit', (code) => {
      if (code === 0) {
        this.disposeWorker(worker);
        return;
      }

      this.failPending(renderWorkerExitError(code));
      this.disposeWorker(worker);
    });
    this.worker = worker;
    return worker;
  }

  private failPending(error: Error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private disposeWorker(worker: Worker) {
    if (this.worker === worker) {
      this.worker = null;
    }
  }
}

let readonlyLocalApiWorkerClient: ReadonlyLocalApiWorkerClient | null = null;

export function dispatchReadonlyLocalApiRequest(input: ReadonlyLocalApiRequest): Promise<DesktopLocalApiDispatchResult> {
  if (!readonlyLocalApiWorkerClient) {
    readonlyLocalApiWorkerClient = new ReadonlyLocalApiWorkerClient();
  }

  return readonlyLocalApiWorkerClient.dispatch(input);
}
