import { existsSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
    const error = workerError ?? new Error(`Conversation inspect worker exited unexpectedly (code ${code}).`);
    workerError = error;
    for (const [, pending] of pendingRequests) {
      pending.reject(error);
    }
    pendingRequests.clear();
  }
  workerInstance = null;
}

export function resolveConversationInspectWorkerUrlFrom(importMetaUrl: string): URL {
  // Normal server bundle path: server/dist/app/localApi.js -> server/dist/conversations/...
  // Extension backend cache path: extension-cache/<extension>/backend.mjs may also contain
  // a transpiled sibling worker, but that copy cannot resolve repo package dependencies.
  // Prefer the bundled repo/build worker whenever the client itself is running from the
  // extension cache.
  const currentDir = dirname(fileURLToPath(importMetaUrl));
  const isExtensionCacheClient = currentDir.includes(`${sep}extension-cache${sep}`);
  const isPackagedExtensionClient =
    typeof process.resourcesPath === 'string' && currentDir.includes(`${sep}extensions${sep}`) && currentDir.endsWith(`${sep}dist`);
  const isTranspiledServerClient = currentDir.includes(`${sep}packages${sep}desktop${sep}dist${sep}server${sep}`);
  const relativeUrl = new URL('../conversations/conversationInspectWorker.js', importMetaUrl);

  if (!isExtensionCacheClient && !isPackagedExtensionClient && !isTranspiledServerClient) {
    try {
      if (existsSync(fileURLToPath(relativeUrl))) {
        return relativeUrl;
      }
    } catch {
      // Keep walking fallbacks below.
    }
  }

  const packagedCandidates =
    typeof process.resourcesPath === 'string'
      ? [
          // Node worker_threads cannot execute JavaScript directly from app.asar.
          // electron-builder mirrors asarUnpack matches under app.asar.unpacked,
          // so prefer that real filesystem path in packaged builds.
          resolve(process.resourcesPath, 'app.asar.unpacked/server/dist/conversations/conversationInspectWorker.js'),
          resolve(process.resourcesPath, 'app/server/dist/conversations/conversationInspectWorker.js'),
          resolve(process.resourcesPath, 'server/dist/conversations/conversationInspectWorker.js'),
          resolve(process.resourcesPath, 'app.asar/server/dist/conversations/conversationInspectWorker.js'),
        ]
      : [];

  const candidates = [
    ...packagedCandidates,
    ...(process.env.PERSONAL_AGENT_REPO_ROOT
      ? [resolve(process.env.PERSONAL_AGENT_REPO_ROOT, 'packages/desktop/server/dist/conversations/conversationInspectWorker.js')]
      : []),
    resolve(process.cwd(), 'packages/desktop/server/dist/conversations/conversationInspectWorker.js'),
    resolve(currentDir, '../../packages/desktop/server/dist/conversations/conversationInspectWorker.js'),
    resolve(currentDir, '../../../packages/desktop/server/dist/conversations/conversationInspectWorker.js'),
    resolve(currentDir, '../server/dist/conversations/conversationInspectWorker.js'),
    resolve(currentDir, 'server/dist/conversations/conversationInspectWorker.js'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate);
    }
  }

  if (isExtensionCacheClient || isPackagedExtensionClient) {
    throw new Error('Unable to locate bundled conversation inspect worker outside extension backend bundle.');
  }

  return relativeUrl;
}

function resolveConversationInspectWorkerUrl(): URL {
  return resolveConversationInspectWorkerUrlFrom(import.meta.url);
}

function getOrCreateWorker(): Worker {
  if (workerInstance) {
    return workerInstance;
  }

  workerError = null;

  const workerUrl = resolveConversationInspectWorkerUrl();

  const worker = new Worker(workerUrl, { execArgv: [] });
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
  if (workerError && workerInstance) {
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
