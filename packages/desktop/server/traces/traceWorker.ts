/**
 * Trace Worker
 *
 * Runs all trace-db writes off the Electron main thread.
 * Receives fire-and-forget write messages via postMessage.
 * Never sends responses — callers don't await.
 */

import { parentPort } from 'node:worker_threads';

import {
  writeTraceAutoMode,
  writeTraceCompaction,
  writeTraceContext,
  writeTraceContextPointerInspect,
  writeTraceQueue,
  writeTraceStats,
  writeTraceSuggestedContext,
  writeTraceToolCall,
} from '@personal-agent/core';

export type TraceWorkerMessage =
  | ({ type: 'stats' } & Parameters<typeof writeTraceStats>[0])
  | ({ type: 'tool_call' } & Parameters<typeof writeTraceToolCall>[0])
  | ({ type: 'context' } & Parameters<typeof writeTraceContext>[0])
  | ({ type: 'compaction' } & Parameters<typeof writeTraceCompaction>[0])
  | ({ type: 'queue' } & Parameters<typeof writeTraceQueue>[0])
  | ({ type: 'auto_mode' } & Parameters<typeof writeTraceAutoMode>[0])
  | ({ type: 'suggested_context' } & Parameters<typeof writeTraceSuggestedContext>[0])
  | ({ type: 'context_pointer_inspect' } & Parameters<typeof writeTraceContextPointerInspect>[0]);

if (!parentPort) {
  throw new Error('traceWorker must run as a worker thread.');
}

parentPort.on('message', (msg: TraceWorkerMessage) => {
  try {
    switch (msg.type) {
      case 'stats':
        writeTraceStats(msg);
        break;
      case 'tool_call':
        writeTraceToolCall(msg);
        break;
      case 'context':
        writeTraceContext(msg);
        break;
      case 'compaction':
        writeTraceCompaction(msg);
        break;
      case 'queue':
        writeTraceQueue(msg);
        break;
      case 'auto_mode':
        writeTraceAutoMode(msg);
        break;
      case 'suggested_context':
        writeTraceSuggestedContext(msg);
        break;
      case 'context_pointer_inspect':
        writeTraceContextPointerInspect(msg);
        break;
    }
  } catch {
    // Fire-and-forget: swallow all write failures
  }
});
