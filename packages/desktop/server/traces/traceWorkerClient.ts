/**
 * Trace Worker Client
 *
 * Manages the singleton trace worker thread and routes all write calls
 * to it via fire-and-forget postMessage. The main thread never blocks
 * on trace writes.
 */

import { Worker } from 'node:worker_threads';

import type { TraceWorkerMessage } from './traceWorker.js';

let workerInstance: Worker | null = null;

function getOrCreateWorker(): Worker {
  if (workerInstance) {
    return workerInstance;
  }

  // The main bundle is at server/dist/app/localApi.js and the worker is at
  // server/dist/traces/traceWorker.js.
  const workerUrl = new URL('../traces/traceWorker.js', import.meta.url);

  const worker = new Worker(workerUrl);

  worker.on('error', () => {
    workerInstance = null;
  });

  worker.on('exit', (code) => {
    if (code !== 0) {
      workerInstance = null;
    }
  });

  workerInstance = worker;
  return worker;
}

function send(msg: TraceWorkerMessage): void {
  try {
    getOrCreateWorker().postMessage(msg);
  } catch {
    // Fire-and-forget: drop the write if the worker is unavailable
  }
}

export function traceWorkerStats(params: Omit<TraceWorkerMessage & { type: 'stats' }, 'type'>): void {
  send({ type: 'stats', ...params });
}

export function traceWorkerToolCall(params: Omit<TraceWorkerMessage & { type: 'tool_call' }, 'type'>): void {
  send({ type: 'tool_call', ...params });
}

export function traceWorkerContext(params: Omit<TraceWorkerMessage & { type: 'context' }, 'type'>): void {
  send({ type: 'context', ...params });
}

export function traceWorkerCompaction(params: Omit<TraceWorkerMessage & { type: 'compaction' }, 'type'>): void {
  send({ type: 'compaction', ...params });
}

export function traceWorkerAutoMode(params: Omit<TraceWorkerMessage & { type: 'auto_mode' }, 'type'>): void {
  send({ type: 'auto_mode', ...params });
}

export function traceWorkerSuggestedContext(params: Omit<TraceWorkerMessage & { type: 'suggested_context' }, 'type'>): void {
  send({ type: 'suggested_context', ...params });
}

export function traceWorkerContextPointerInspect(params: Omit<TraceWorkerMessage & { type: 'context_pointer_inspect' }, 'type'>): void {
  send({ type: 'context_pointer_inspect', ...params });
}

export function closeTraceWorker(): void {
  if (workerInstance) {
    void workerInstance.terminate();
    workerInstance = null;
  }
}
