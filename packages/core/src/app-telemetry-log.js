import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getStateRoot } from './runtime/paths.js';

const LOG_DIR = 'telemetry';
const LOG_PREFIX = 'app-telemetry-';
const LOG_SUFFIX = '.jsonl';
const DEFAULT_RETENTION_DAYS = 30;
const PRUNE_EVERY_WRITES = 250;
const writeCounts = new Map();
export function resolveAppTelemetryLogDir(stateRoot) {
  return join(stateRoot ?? getStateRoot(), 'logs', LOG_DIR);
}
export function resolveAppTelemetryLogPath(ts, stateRoot) {
  const day = /^\d{4}-\d{2}-\d{2}/.exec(ts)?.[0] ?? new Date().toISOString().slice(0, 10);
  return join(resolveAppTelemetryLogDir(stateRoot), `${LOG_PREFIX}${day}${LOG_SUFFIX}`);
}
function resolveRetentionDays() {
  const raw = process.env.PERSONAL_AGENT_APP_TELEMETRY_LOG_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_RETENTION_DAYS;
}
export function closeAppTelemetryLogs() {
  writeCounts.clear();
}
export function writeAppTelemetryLogEvent(event, stateRoot) {
  try {
    const path = resolveAppTelemetryLogPath(event.ts, stateRoot);
    const dir = resolveAppTelemetryLogDir(stateRoot);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf-8');
    maybePruneAppTelemetryLogs(stateRoot);
  } catch {
    // Raw telemetry must never affect app behavior.
  }
}
function maybePruneAppTelemetryLogs(stateRoot) {
  const dir = resolveAppTelemetryLogDir(stateRoot);
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
  } catch {
    // Best-effort retention only.
  }
}
function parseLogEvent(line) {
  try {
    const parsed = JSON.parse(line);
    if (parsed.schemaVersion !== 1 || !parsed.id || !parsed.ts || !parsed.source || !parsed.category || !parsed.name) return null;
    return {
      schemaVersion: 1,
      id: String(parsed.id),
      ts: String(parsed.ts),
      source: String(parsed.source),
      category: String(parsed.category),
      name: String(parsed.name),
      sessionId: parsed.sessionId == null ? null : String(parsed.sessionId),
      runId: parsed.runId == null ? null : String(parsed.runId),
      route: parsed.route == null ? null : String(parsed.route),
      status: typeof parsed.status === 'number' && Number.isFinite(parsed.status) ? parsed.status : null,
      durationMs: typeof parsed.durationMs === 'number' && Number.isFinite(parsed.durationMs) ? parsed.durationMs : null,
      count: typeof parsed.count === 'number' && Number.isFinite(parsed.count) ? parsed.count : null,
      value: typeof parsed.value === 'number' && Number.isFinite(parsed.value) ? parsed.value : null,
      metadata: parsed.metadata && typeof parsed.metadata === 'object' && !Array.isArray(parsed.metadata) ? parsed.metadata : null,
    };
  } catch {
    return null;
  }
}
export function listAppTelemetryLogFiles(stateRoot) {
  const dir = resolveAppTelemetryLogDir(stateRoot);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((fileName) => fileName.startsWith(LOG_PREFIX) && fileName.endsWith(LOG_SUFFIX))
      .sort((left, right) => right.localeCompare(left))
      .map((fileName) => {
        const path = join(dir, fileName);
        const stat = statSync(path);
        return { path, name: fileName, sizeBytes: stat.size, modifiedAt: stat.mtime.toISOString() };
      });
  } catch {
    return [];
  }
}
export function exportAppTelemetryLogBundle(input = {}) {
  const files = listAppTelemetryLogFiles(input.stateRoot);
  const exportDir = join(input.stateRoot ?? getStateRoot(), 'exports', 'telemetry');
  mkdirSync(exportDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(exportDir, `app-telemetry-${timestamp}.jsonl`);
  const lines = [];
  let fileCount = 0;
  const seenFiles = new Set();
  for (const file of files.slice().reverse()) {
    try {
      const fileLines = readFileSync(file.path, 'utf-8').split('\n').filter(Boolean);
      let included = false;
      for (const line of fileLines) {
        const event = parseLogEvent(line);
        if (!event || (input.since && event.ts < input.since)) continue;
        lines.push(JSON.stringify(event));
        included = true;
      }
      if (included && !seenFiles.has(file.path)) {
        seenFiles.add(file.path);
        fileCount += 1;
      }
    } catch {
      // Ignore files that disappear while exporting.
    }
  }
  writeFileSync(path, `${lines.join('\n')}${lines.length > 0 ? '\n' : ''}`, 'utf-8');
  const stat = statSync(path);
  return { path, fileCount, eventCount: lines.length, sizeBytes: stat.size };
}
export function readAppTelemetryLogEvents(input) {
  const dir = resolveAppTelemetryLogDir(input.stateRoot);
  if (!existsSync(dir)) return [];
  const events = [];
  try {
    const files = readdirSync(dir)
      .filter((fileName) => fileName.startsWith(LOG_PREFIX) && fileName.endsWith(LOG_SUFFIX))
      .sort((left, right) => right.localeCompare(left));
    for (const fileName of files) {
      const content = readFileSync(join(dir, fileName), 'utf-8');
      const lines = content.split('\n').filter(Boolean).reverse();
      for (const line of lines) {
        const event = parseLogEvent(line);
        if (!event || event.ts < input.since) continue;
        events.push(event);
        if (events.length >= input.limit) return events.sort((a, b) => b.ts.localeCompare(a.ts));
      }
    }
  } catch {
    return events.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, input.limit);
  }
  return events.sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, input.limit);
}
