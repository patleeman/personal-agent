/**
 * Application telemetry database.
 *
 * Generic event sink for low-cardinality runtime signals that are useful later
 * but not yet first-class trace metrics.
 */

import { randomUUID } from 'node:crypto';
import { existsSync, rmSync } from 'node:fs';

import {
  type AppTelemetryLogEvent,
  closeAppTelemetryLogs,
  readAppTelemetryLogEvents,
  writeAppTelemetryLogEvent,
} from './app-telemetry-log.js';
import {
  applyObservabilityMigrations,
  ensureObservabilityDbDir,
  resolveLegacyAppTelemetryDbPath,
  resolveObservabilityDbPath,
} from './observability-db.js';
import { openSqliteDatabase, type SqliteDatabase } from './sqlite.js';
import type { Migration } from './sqlite-migrations.js';

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

const APP_TELEMETRY_MIGRATIONS: Migration[] = [];
const DEFAULT_MAX_EVENTS = 50_000;
const PRUNE_EVERY_WRITES = 250;

const dbCache = new Map<string, SqliteDatabase>();
const writeCounts = new Map<string, number>();

export function closeAppTelemetryDbs(): void {
  for (const db of dbCache.values()) {
    db.close();
  }
  dbCache.clear();
  writeCounts.clear();
  closeAppTelemetryLogs();
}

function resolveAppTelemetryDbPath(stateRoot?: string): string {
  return resolveObservabilityDbPath(stateRoot);
}

function logTelemetryStorageError(message: string, error: unknown): void {
  console.error(
    `[telemetry] ${message}`,
    error instanceof Error ? { message: error.message, stack: error.stack } : { error: String(error) },
  );
}

function deleteLegacyAppTelemetryDb(legacyPath: string): void {
  try {
    rmSync(legacyPath, { force: true });
  } catch (error) {
    logTelemetryStorageError(`failed to delete imported legacy app telemetry DB at ${legacyPath}`, error);
  }
}

function importLegacyAppTelemetryEvents(db: SqliteDatabase, stateRoot?: string): void {
  const legacyPath = resolveLegacyAppTelemetryDbPath(stateRoot);
  if (!existsSync(legacyPath) || legacyPath === resolveAppTelemetryDbPath(stateRoot)) return;

  const imported = db.prepare(`SELECT value FROM observability_imports WHERE key = ?`).get('app-telemetry') as
    | { value?: string }
    | undefined;
  if (imported?.value === legacyPath) {
    deleteLegacyAppTelemetryDb(legacyPath);
    return;
  }

  let importedSuccessfully = false;
  try {
    db.exec(`ATTACH DATABASE ${JSON.stringify(legacyPath)} AS legacy_app_telemetry`);
    db.exec(`
      INSERT OR IGNORE INTO app_telemetry_events (
        id, ts, source, category, name, session_id, run_id, route, status, duration_ms, count, value, metadata_json
      )
      SELECT id, ts, source, category, name, session_id, run_id, route, status, duration_ms, count, value, metadata_json
      FROM legacy_app_telemetry.app_telemetry_events
    `);
    db.prepare(`INSERT OR REPLACE INTO observability_imports (key, value, imported_at) VALUES (?, ?, ?)`).run(
      'app-telemetry',
      legacyPath,
      new Date().toISOString(),
    );
    importedSuccessfully = true;
  } catch (error) {
    logTelemetryStorageError(`failed to import legacy app telemetry DB at ${legacyPath}`, error);
  } finally {
    try {
      db.exec(`DETACH DATABASE legacy_app_telemetry`);
    } catch {
      // ignore
    }
    if (importedSuccessfully) deleteLegacyAppTelemetryDb(legacyPath);
  }
}

function getAppTelemetryDb(stateRoot?: string): SqliteDatabase {
  const path = resolveAppTelemetryDbPath(stateRoot);
  const cached = dbCache.get(path);
  if (cached) return cached;

  ensureObservabilityDbDir(stateRoot);

  const db = openSqliteDatabase(path);
  db.exec(SCHEMA);
  db.exec(`CREATE TABLE IF NOT EXISTS observability_imports (key TEXT PRIMARY KEY, value TEXT NOT NULL, imported_at TEXT NOT NULL)`);
  applyObservabilityMigrations(db, 'app-telemetry', APP_TELEMETRY_MIGRATIONS);
  importLegacyAppTelemetryEvents(db, stateRoot);
  maybePruneAppTelemetryEvents(db, path, { force: true });
  dbCache.set(path, db);
  return db;
}

export type AppTelemetrySource = 'server' | 'renderer' | 'agent' | 'system';

export interface AppTelemetryEventInput {
  source: AppTelemetrySource;
  category: string;
  name: string;
  sessionId?: string;
  runId?: string;
  route?: string;
  status?: number;
  durationMs?: number;
  count?: number;
  value?: number;
  metadata?: Record<string, unknown>;
  stateRoot?: string;
}

export interface AppTelemetryEventRow {
  id: string;
  ts: string;
  source: AppTelemetrySource;
  category: string;
  name: string;
  sessionId: string | null;
  runId: string | null;
  route: string | null;
  status: number | null;
  durationMs: number | null;
  count: number | null;
  value: number | null;
  metadataJson: string | null;
}

function nowIso(): string {
  return new Date().toISOString();
}

function truncate(value: string, max = 2000): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function normalizeString(value: string | undefined, max = 240): string | null {
  const trimmed = value?.trim();
  return trimmed ? truncate(trimmed, max) : null;
}

function normalizeFiniteNumber(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    return JSON.parse(truncate(JSON.stringify(metadata), 4000)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringifyMetadata(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  try {
    return truncate(JSON.stringify(metadata), 4000);
  } catch {
    return null;
  }
}

function resolveMaxEvents(): number {
  const raw = process.env.PERSONAL_AGENT_APP_TELEMETRY_MAX_EVENTS;
  if (!raw) return DEFAULT_MAX_EVENTS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed >= 1_000 ? parsed : DEFAULT_MAX_EVENTS;
}

function countAppTelemetryEvents(db: SqliteDatabase): number {
  const row = db.prepare(`SELECT COUNT(*) AS count FROM app_telemetry_events`).get() as { count?: unknown } | undefined;
  return typeof row?.count === 'number' ? row.count : 0;
}

function maybePruneAppTelemetryEvents(db: SqliteDatabase, dbPath: string, input: { force?: boolean } = {}): void {
  if (!input.force) {
    const count = (writeCounts.get(dbPath) ?? 0) + 1;
    writeCounts.set(dbPath, count);
    if (count % PRUNE_EVERY_WRITES !== 0) return;
  }

  const maxEvents = resolveMaxEvents();
  db.prepare(
    `
    DELETE FROM app_telemetry_events
    WHERE id IN (
      SELECT id FROM app_telemetry_events
      ORDER BY ts DESC
      LIMIT -1 OFFSET ?
    )
  `,
  ).run(maxEvents);
}

export function writeAppTelemetryEvent(input: AppTelemetryEventInput): void {
  try {
    const category = normalizeString(input.category, 120);
    const name = normalizeString(input.name, 160);
    if (!category || !name) return;

    const event: AppTelemetryLogEvent = {
      schemaVersion: 1,
      id: randomUUID(),
      ts: nowIso(),
      source: input.source,
      category,
      name,
      sessionId: normalizeString(input.sessionId, 160),
      runId: normalizeString(input.runId, 200),
      route: normalizeString(input.route, 500),
      status: typeof input.status === 'number' && Number.isInteger(input.status) ? input.status : null,
      durationMs: normalizeFiniteNumber(input.durationMs),
      count: typeof input.count === 'number' && Number.isInteger(input.count) ? input.count : null,
      value: normalizeFiniteNumber(input.value),
      metadata: normalizeMetadata(input.metadata),
    };

    writeAppTelemetryLogEvent(event, input.stateRoot);

    try {
      const dbPath = resolveAppTelemetryDbPath(input.stateRoot);
      const db = getAppTelemetryDb(input.stateRoot);

      db.prepare(
        `
      INSERT INTO app_telemetry_events (
        id, ts, source, category, name, session_id, run_id, route, status, duration_ms, count, value, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      ).run(
        event.id,
        event.ts,
        event.source,
        event.category,
        event.name,
        event.sessionId,
        event.runId,
        event.route,
        event.status,
        event.durationMs,
        event.count,
        event.value,
        stringifyMetadata(event.metadata),
      );

      maybePruneAppTelemetryEvents(db, dbPath);
    } catch (error) {
      logTelemetryStorageError('failed to index app telemetry event into SQLite', error);
    }
  } catch (error) {
    logTelemetryStorageError('failed to normalize app telemetry event', error);
  }
}

export interface AppTelemetryDbMaintenanceResult {
  dbPath: string;
  maxEvents: number;
  deletedRows: number;
  remainingRows: number;
  vacuumed: boolean;
}

export function maintainAppTelemetryDb(stateRoot?: string): AppTelemetryDbMaintenanceResult {
  const dbPath = resolveAppTelemetryDbPath(stateRoot);
  const db = getAppTelemetryDb(stateRoot);
  const before = countAppTelemetryEvents(db);
  maybePruneAppTelemetryEvents(db, dbPath, { force: true });
  const after = countAppTelemetryEvents(db);
  db.exec(`VACUUM`);
  return { dbPath, maxEvents: resolveMaxEvents(), deletedRows: Math.max(0, before - after), remainingRows: after, vacuumed: true };
}

function mapEventRow(row: Record<string, unknown>): AppTelemetryEventRow {
  return {
    id: String(row.id),
    ts: String(row.ts),
    source: row.source as AppTelemetrySource,
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

export function queryAppTelemetryEvents(input: { since: string; limit?: number; stateRoot?: string }): AppTelemetryEventRow[] {
  const limit = Math.max(1, Math.min(input.limit ?? 200, 1000));
  const loggedEvents = readAppTelemetryLogEvents({ since: input.since, limit, stateRoot: input.stateRoot });
  if (loggedEvents.length > 0) {
    return loggedEvents.map((event) => ({
      id: event.id,
      ts: event.ts,
      source: event.source as AppTelemetrySource,
      category: event.category,
      name: event.name,
      sessionId: event.sessionId,
      runId: event.runId,
      route: event.route,
      status: event.status,
      durationMs: event.durationMs,
      count: event.count,
      value: event.value,
      metadataJson: stringifyMetadata(event.metadata),
    }));
  }

  const rows = getAppTelemetryDb(input.stateRoot)
    .prepare(
      `
    SELECT * FROM app_telemetry_events
    WHERE ts >= ?
    ORDER BY ts DESC
    LIMIT ?
  `,
    )
    .all(input.since, limit) as Record<string, unknown>[];
  return rows.map(mapEventRow);
}
