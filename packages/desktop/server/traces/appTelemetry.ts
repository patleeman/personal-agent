import { type AppTelemetryEventInput, writeAppTelemetryEvent } from '@personal-agent/core';

const MAX_QUEUE_SIZE = 1000;
const FLUSH_BATCH_SIZE = 100;

let queue: AppTelemetryEventInput[] = [];
let flushScheduled = false;

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(flushAppTelemetryQueue, 0).unref?.();
}

export function flushAppTelemetryQueue(): void {
  flushScheduled = false;
  const batch = queue.splice(0, FLUSH_BATCH_SIZE);
  for (const event of batch) {
    writeAppTelemetryEvent(event);
  }
  if (queue.length > 0) scheduleFlush();
}

export function persistAppTelemetryEvent(event: AppTelemetryEventInput): void {
  try {
    if (queue.length >= MAX_QUEUE_SIZE) {
      queue = queue.slice(queue.length - Math.floor(MAX_QUEUE_SIZE / 2));
    }
    queue.push(event);
    scheduleFlush();
  } catch {
    // Telemetry must never affect app behavior.
  }
}
