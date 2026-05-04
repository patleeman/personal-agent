import { Worker } from 'node:worker_threads';

interface LocalApiWorkerRequest {
  id: number;
  methodName: string;
  args: unknown[];
}

interface LocalApiWorkerSuccess {
  id: number;
  ok: true;
  result: unknown;
}

interface LocalApiWorkerFailure {
  id: number;
  ok: false;
  error: string;
}

type LocalApiWorkerResponse = LocalApiWorkerSuccess | LocalApiWorkerFailure;

function renderWorkerExitError(code: number | null): Error {
  return new Error(`Local API worker exited unexpectedly${code === null ? '' : ` (code ${code})`}.`);
}

function createLocalApiWorker(): Worker {
  return new Worker(new URL('./local-api-worker.js', import.meta.url));
}

export class LocalApiWorkerClient {
  private worker: Worker | null = null;
  private nextRequestId = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  call(methodName: string, args: unknown[]): Promise<unknown> {
    const worker = this.ensureWorker();

    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextRequestId + 1;
      this.nextRequestId = id;
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, methodName, args } satisfies LocalApiWorkerRequest);
    });
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker;
    }

    const worker = createLocalApiWorker();
    worker.on('message', (message: LocalApiWorkerResponse) => {
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

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private disposeWorker(worker: Worker): void {
    if (this.worker === worker) {
      this.worker = null;
    }
  }
}
