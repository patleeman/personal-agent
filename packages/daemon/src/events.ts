import { randomUUID } from 'crypto';
import type { DaemonEvent, DaemonEventInput } from './types.js';

export const DAEMON_EVENT_VERSION = 1;

function normalizeTimestamp(value: unknown): string {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return new Date().toISOString();
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
    Number.isFinite(Date.parse(value.timestamp)) &&
    isRecord(value.payload)
  );
}
