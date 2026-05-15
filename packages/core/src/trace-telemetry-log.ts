import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { getStateRoot } from './runtime/paths.js';

const LOG_DIR = 'telemetry';
const LOG_PREFIX = 'trace-telemetry-';
const LOG_SUFFIX = '.jsonl';
const DEFAULT_RETENTION_DAYS = 30;
const DEFAULT_MAX_LOG_FILE_BYTES = 10 * 1024 * 1024;
const PRUNE_EVERY_WRITES = 250;

const writeCounts = new Map<string, number>();

export type TraceTelemetryLogEventType =
  | 'stats'
  | 'tool_call'
  | 'context'
  | 'compaction'
  | 'auto_mode'
  | 'suggested_context'
  | 'context_pointer_inspect';

export interface TraceTelemetryLogEvent {
  schemaVersion: 1;
  id: string;
  ts: string;
  type: TraceTelemetryLogEventType;
  sessionId: string;
  runId: string | null;
  profile: string;
  payload: Record<string, unknown>;
}

export function resolveTraceTelemetryLogDir(stateRoot?: string): string {
  return join(stateRoot ?? getStateRoot(), 'logs', LOG_DIR);
}

function resolveTraceTelemetryLogDay(ts: string): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(ts)?.[0] ?? new Date().toISOString().slice(0, 10);
}

function resolveMaxLogFileBytes(): number {
  const raw = process.env.PERSONAL_AGENT_TRACE_TELEMETRY_LOG_MAX_BYTES ?? process.env.PERSONAL_AGENT_APP_TELEMETRY_LOG_MAX_BYTES;
  if (!raw) return DEFAULT_MAX_LOG_FILE_BYTES;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_LOG_FILE_BYTES;
}

export function resolveTraceTelemetryLogPath(ts: string, stateRoot?: string, lineBytes = 0): string {
  const day = resolveTraceTelemetryLogDay(ts);
  const dir = resolveTraceTelemetryLogDir(stateRoot);
  const basePath = join(dir, `${LOG_PREFIX}${day}${LOG_SUFFIX}`);
  const maxBytes = resolveMaxLogFileBytes();

  try {
    if (!existsSync(basePath) || statSync(basePath).size + lineBytes <= maxBytes) return basePath;

    let nextSegment = 1;
    const segmentPrefix = `${LOG_PREFIX}${day}.`;
    for (const fileName of readdirSync(dir)) {
      if (!fileName.startsWith(segmentPrefix) || !fileName.endsWith(LOG_SUFFIX)) continue;
      const segment = Number.parseInt(fileName.slice(segmentPrefix.length, -LOG_SUFFIX.length), 10);
      if (!Number.isSafeInteger(segment)) continue;
      nextSegment = Math.max(nextSegment, segment + 1);
      const candidate = join(dir, fileName);
      if (statSync(candidate).size + lineBytes <= maxBytes) return candidate;
    }
    return join(dir, `${LOG_PREFIX}${day}.${nextSegment}${LOG_SUFFIX}`);
  } catch {
    return basePath;
  }
}

function resolveRetentionDays(): number {
  const raw = process.env.PERSONAL_AGENT_TRACE_TELEMETRY_LOG_RETENTION_DAYS ?? process.env.PERSONAL_AGENT_APP_TELEMETRY_LOG_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_RETENTION_DAYS;
}

export function closeTraceTelemetryLogs(): void {
  writeCounts.clear();
}

function logTraceTelemetryStorageError(message: string, error: unknown): void {
  console.error(
    `[telemetry] ${message}`,
    error instanceof Error ? { message: error.message, stack: error.stack } : { error: String(error) },
  );
}

export function writeTraceTelemetryLogEvent(event: TraceTelemetryLogEvent, stateRoot?: string): void {
  const line = `${JSON.stringify(event)}\n`;
  try {
    const dir = resolveTraceTelemetryLogDir(stateRoot);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = resolveTraceTelemetryLogPath(event.ts, stateRoot, Buffer.byteLength(line, 'utf-8'));
    appendFileSync(path, line, 'utf-8');
    maybePruneTraceTelemetryLogs(stateRoot);
  } catch (error) {
    logTraceTelemetryStorageError('failed to write trace telemetry JSONL event', error);
  }
}

function maybePruneTraceTelemetryLogs(stateRoot?: string): void {
  const dir = resolveTraceTelemetryLogDir(stateRoot);
  const count = (writeCounts.get(dir) ?? 0) + 1;
  writeCounts.set(dir, count);
  if (count % PRUNE_EVERY_WRITES !== 0) return;

  try {
    const retentionMs = resolveRetentionDays() * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - retentionMs;
    for (const fileName of readdirSync(dir)) {
      if (!fileName.startsWith(LOG_PREFIX) || !fileName.endsWith(LOG_SUFFIX)) continue;
      const path = join(dir, fileName);
      const stat = statSync(path);
      if (stat.mtimeMs < cutoff) rmSync(path, { force: true });
    }
  } catch (error) {
    logTraceTelemetryStorageError('failed to prune trace telemetry JSONL logs', error);
  }
}
