import { Worker } from 'node:worker_threads';

interface WorkerRequest {
  id: number;
  action: string;
  params: Record<string, unknown>;
}

interface WorkerSuccess {
  id: number;
  ok: true;
  action: string;
  result: unknown;
  text: string;
}

interface WorkerError {
  id: number;
  ok: false;
  error: string;
}

type WorkerResponse = WorkerSuccess | WorkerError;

interface PendingRequest {
  resolve: (response: WorkerSuccess) => void;
  reject: (error: Error) => void;
}

let workerInstance: Worker | null = null;
let nextRequestId = 0;
const pendingRequests = new Map<number, PendingRequest>();
let workerError: Error | null = null;

function handleWorkerMessage(response: WorkerResponse): void {
  const pending = pendingRequests.get(response.id);
  if (!pending) {
    return;
  }

  pendingRequests.delete(response.id);

  if (response.ok) {
    pending.resolve(response);
  } else {
    pending.reject(new Error(response.error));
  }
}

function handleWorkerError(error: Error): void {
  workerError = error;
  // Reject all pending requests
  for (const [, pending] of pendingRequests) {
    pending.reject(error);
  }
  pendingRequests.clear();
}

function handleWorkerExit(code: number): void {
  if (code !== 0 && workerInstance) {
    const error = new Error(`Conversation inspect worker exited unexpectedly (code ${code}).`);
    workerError = error;
    for (const [, pending] of pendingRequests) {
      pending.reject(error);
    }
    pendingRequests.clear();
  }
  workerInstance = null;
}

function getOrCreateWorker(): Worker {
  if (workerInstance) {
    return workerInstance;
  }

  workerError = null;

  // Resolve the worker script URL relative to the main bundle location.
  // The main bundle is at server/dist/app/localApi.js and the worker is at
  // server/dist/conversations/conversationInspectWorker.js.
  const workerUrl = new URL('../conversations/conversationInspectWorker.js', import.meta.url);

  const worker = new Worker(workerUrl);
  worker.on('message', handleWorkerMessage);
  worker.on('error', handleWorkerError);
  worker.on('exit', handleWorkerExit);
  workerInstance = worker;
  return worker;
}

export async function executeConversationInspect(
  action: string,
  params: Record<string, unknown>,
): Promise<{ action: string; result: unknown; text: string }> {
  if (workerError) {
    throw new Error(`Conversation inspect worker is unavailable: ${workerError.message}`);
  }

  const worker = getOrCreateWorker();
  const id = ++nextRequestId;

  return new Promise<{ action: string; result: unknown; text: string }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error(`Conversation inspect ${action} timed out.`));
    }, 30_000);

    pendingRequests.set(id, {
      resolve: (response) => {
        clearTimeout(timeout);
        resolve({ action: response.action, result: response.result, text: response.text });
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    });

    try {
      worker.postMessage({ id, action, params } satisfies WorkerRequest);
    } catch (error) {
      clearTimeout(timeout);
      pendingRequests.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
