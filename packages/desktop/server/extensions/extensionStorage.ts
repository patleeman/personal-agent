import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { getStateRoot, openSqliteDatabase, type SqliteDatabase } from '@personal-agent/core';

export interface ExtensionStateDocument<T = unknown> {
  key: string;
  value: T;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export interface ExtensionStatePutOptions {
  expectedVersion?: number;
}

const dbCache = new Map<string, SqliteDatabase>();

function getExtensionStateDbPath(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'app-state', 'app-state.sqlite');
}

function normalizeStateKey(key: string): string {
  const normalized = key
    .trim()
    .replace(/^\/+/, '')
    .replace(/\.json$/, '');
  if (!normalized || normalized.includes('\0') || normalized.split('/').includes('..')) {
    throw new Error('Extension state key is invalid.');
  }
  return normalized;
}

function openExtensionStateDb(dbPath: string = getExtensionStateDbPath()): SqliteDatabase {
  const resolved = dbPath;
  const cached = dbCache.get(resolved);
  if (cached) return cached;

  mkdirSync(dirname(resolved), { recursive: true });
  const db = openSqliteDatabase(resolved);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS extension_state (
      extension_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (extension_id, key)
    );
  `);
  dbCache.set(resolved, db);
  return db;
}

interface ExtensionStateRow {
  key: string;
  value_json: string;
  version: number;
  created_at: number;
  updated_at: number;
}

function rowToDocument<T = unknown>(row: ExtensionStateRow): ExtensionStateDocument<T> {
  return {
    key: row.key,
    value: JSON.parse(row.value_json) as T,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function readExtensionState<T = unknown>(extensionId: string, key: string): ExtensionStateDocument<T> | null {
  const normalizedKey = normalizeStateKey(key);
  const row = openExtensionStateDb()
    .prepare('SELECT key, value_json, version, created_at, updated_at FROM extension_state WHERE extension_id = ? AND key = ?')
    .get(extensionId, normalizedKey) as ExtensionStateRow | undefined;
  return row ? rowToDocument<T>(row) : null;
}

export function writeExtensionState<T = unknown>(
  extensionId: string,
  key: string,
  value: T,
  options: ExtensionStatePutOptions = {},
): ExtensionStateDocument<T> {
  const normalizedKey = normalizeStateKey(key);
  const db = openExtensionStateDb();
  const existing = readExtensionState<T>(extensionId, normalizedKey);
  if (options.expectedVersion !== undefined && existing?.version !== options.expectedVersion) {
    const error = new Error('Extension state version conflict.');
    (error as Error & { current?: ExtensionStateDocument<T> | null }).current = existing;
    throw error;
  }

  const now = Date.now();
  const nextVersion = (existing?.version ?? 0) + 1;
  const createdAt = existing?.createdAt ?? now;
  db.prepare(
    `INSERT INTO extension_state (extension_id, key, value_json, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(extension_id, key) DO UPDATE SET
       value_json = excluded.value_json,
       version = excluded.version,
       updated_at = excluded.updated_at`,
  ).run(extensionId, normalizedKey, JSON.stringify(value), nextVersion, createdAt, now);

  return { key: normalizedKey, value, version: nextVersion, createdAt, updatedAt: now };
}

export function deleteExtensionState(extensionId: string, key: string): { ok: true; deleted: boolean } {
  const normalizedKey = normalizeStateKey(key);
  const result = openExtensionStateDb()
    .prepare('DELETE FROM extension_state WHERE extension_id = ? AND key = ?')
    .run(extensionId, normalizedKey);
  return { ok: true, deleted: result.changes > 0 };
}

export function listExtensionState<T = unknown>(extensionId: string, prefix = ''): Array<ExtensionStateDocument<T>> {
  const normalizedPrefix = prefix
    .trim()
    .replace(/^\/+/, '')
    .replace(/\.json$/, '');
  if (normalizedPrefix.includes('\0') || normalizedPrefix.split('/').includes('..')) {
    throw new Error('Extension state prefix is invalid.');
  }
  const rows = openExtensionStateDb()
    .prepare(
      normalizedPrefix
        ? 'SELECT key, value_json, version, created_at, updated_at FROM extension_state WHERE extension_id = ? AND key LIKE ? ORDER BY key'
        : 'SELECT key, value_json, version, created_at, updated_at FROM extension_state WHERE extension_id = ? ORDER BY key',
    )
    .all(...(normalizedPrefix ? [extensionId, `${normalizedPrefix}%`] : [extensionId])) as ExtensionStateRow[];
  return rows.map((row) => rowToDocument<T>(row));
}

export function clearExtensionStateDbCacheForTests(): void {
  for (const db of dbCache.values()) {
    db.close();
  }
  dbCache.clear();
}
