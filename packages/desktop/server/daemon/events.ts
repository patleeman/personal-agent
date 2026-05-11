import { randomUUID } from 'crypto';

import type { DaemonEvent, DaemonEventInput } from './types.js';

export const DAEMON_EVENT_VERSION = 1;

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = parseIsoTimestamp(value);
    if (parsed !== undefined) {
      return new Date(parsed).toISOString();
    }
  }

  return new Date().toISOString();
}

function parseIsoTimestamp(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return undefined;
  }

  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : undefined;
}

export function createDaemonEvent(input: DaemonEventInput): DaemonEvent {
  return {
    id: input.id ?? `evt_${randomUUID()}`,
    version: DAEMON_EVENT_VERSION,
    type: input.type,
    source: input.source,
    timestamp: normalizeTimestamp(input.timestamp),
    payload: input.payload ?? {},
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isDaemonEvent(value: unknown): value is DaemonEvent {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === 'string' &&
    typeof value.version === 'number' &&
    typeof value.type === 'string' &&
    typeof value.source === 'string' &&
    typeof value.timestamp === 'string' &&
    parseIsoTimestamp(value.timestamp) !== undefined &&
    isRecord(value.payload)
  );
}
