/**
 * Application telemetry database.
 *
 * Generic event sink for low-cardinality runtime signals that are useful later
 * but not yet first-class trace metrics.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getStateRoot } from './runtime/paths.js';
import { openSqliteDatabase } from './sqlite.js';
import { applyMigrations } from './sqlite-migrations.js';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_telemetry_events (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  source TEXT NOT NULL,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  session_id TEXT,
  run_id TEXT,
  route TEXT,
  status INTEGER,
  duration_ms REAL,
  count INTEGER,
  value REAL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_telemetry_ts ON app_telemetry_events(ts);
CREATE INDEX IF NOT EXISTS idx_app_telemetry_source ON app_telemetry_events(source);
CREATE INDEX IF NOT EXISTS idx_app_telemetry_category_name ON app_telemetry_events(category, name);
CREATE INDEX IF NOT EXISTS idx_app_telemetry_session ON app_telemetry_events(session_id);
CREATE INDEX IF NOT EXISTS idx_app_telemetry_route ON app_telemetry_events(route);
`;
const APP_TELEMETRY_MIGRATIONS = [];
const dbCache = new Map();
export function closeAppTelemetryDbs() {
  for (const db of dbCache.values()) {
    db.close();
  }
  dbCache.clear();
}
function resolveAppTelemetryDbDir(stateRoot) {
  return join(stateRoot ?? getStateRoot(), 'pi-agent', 'state', 'trace');
}
function resolveAppTelemetryDbPath(stateRoot) {
  return join(resolveAppTelemetryDbDir(stateRoot), 'app-telemetry.db');
}
function getAppTelemetryDb(stateRoot) {
  const path = resolveAppTelemetryDbPath(stateRoot);
  const cached = dbCache.get(path);
  if (cached) return cached;
  const dir = resolveAppTelemetryDbDir(stateRoot);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const db = openSqliteDatabase(path);
  db.exec(SCHEMA);
  applyMigrations(db, 'app-telemetry-db', APP_TELEMETRY_MIGRATIONS);
  dbCache.set(path, db);
  return db;
}
function nowIso() {
  return new Date().toISOString();
}
function truncate(value, max = 2000) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
function normalizeString(value, max = 240) {
  const trimmed = value?.trim();
  return trimmed ? truncate(trimmed, max) : null;
}
function normalizeFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function stringifyMetadata(metadata) {
  if (!metadata) return null;
  try {
    return truncate(JSON.stringify(metadata), 4000);
  } catch {
    return null;
  }
}
export function writeAppTelemetryEvent(input) {
  try {
    const category = normalizeString(input.category, 120);
    const name = normalizeString(input.name, 160);
    if (!category || !name) return;
    getAppTelemetryDb(input.stateRoot)
      .prepare(
        `
      INSERT INTO app_telemetry_events (
        id, ts, source, category, name, session_id, run_id, route, status, duration_ms, count, value, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        randomUUID(),
        nowIso(),
        input.source,
        category,
        name,
        normalizeString(input.sessionId, 160),
        normalizeString(input.runId, 200),
        normalizeString(input.route, 500),
        Number.isInteger(input.status) ? input.status : null,
        normalizeFiniteNumber(input.durationMs),
        Number.isInteger(input.count) ? input.count : null,
        normalizeFiniteNumber(input.value),
        stringifyMetadata(input.metadata),
      );
  } catch {
    // Telemetry must never affect app behavior.
  }
}
function mapEventRow(row) {
  return {
    id: String(row.id),
    ts: String(row.ts),
    source: row.source,
    category: String(row.category),
    name: String(row.name),
    sessionId: row.session_id == null ? null : String(row.session_id),
    runId: row.run_id == null ? null : String(row.run_id),
    route: row.route == null ? null : String(row.route),
    status: row.status == null ? null : Number(row.status),
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    count: row.count == null ? null : Number(row.count),
    value: row.value == null ? null : Number(row.value),
    metadataJson: row.metadata_json == null ? null : String(row.metadata_json),
  };
}
export function queryAppTelemetryEvents(input) {
  const limit = Math.max(1, Math.min(input.limit ?? 200, 1000));
  const rows = getAppTelemetryDb(input.stateRoot)
    .prepare(
      `
    SELECT * FROM app_telemetry_events
    WHERE ts >= ?
    ORDER BY ts DESC
    LIMIT ?
  `,
    )
    .all(input.since, limit);
  return rows.map(mapEventRow);
}
