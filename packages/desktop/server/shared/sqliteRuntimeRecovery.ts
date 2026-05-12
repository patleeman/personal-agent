import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { openSqliteDatabase, type SqliteDatabase } from '@personal-agent/core';

function timestampSegment(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function readIntegrityCheck(db: SqliteDatabase): string {
  const rows = db.prepare('PRAGMA integrity_check').all();
  const first = rows[0];
  if (!first || typeof first !== 'object') {
    return 'integrity_check returned no rows';
  }

  const value = Object.values(first as Record<string, unknown>)[0];
  return typeof value === 'string' ? value : String(value);
}

function isCorruptSqliteError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    message.includes('sqlite integrity check failed') ||
    message.includes('database disk image is malformed') ||
    message.includes('database corruption') ||
    message.includes('database is corrupt') ||
    message.includes('file is not a database')
  );
}

function quarantineDbFiles(dbPath: string, reason: string): string {
  const quarantineDir = join(dirname(dbPath), '.corrupt');
  mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });

  const prefix = `${basename(dbPath)}.${timestampSegment()}.${process.pid}.${reason.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 48)}`;
  for (const suffix of ['', '-wal', '-shm']) {
    const source = `${dbPath}${suffix}`;
    if (!existsSync(source)) {
      continue;
    }

    const target = join(quarantineDir, `${prefix}${suffix || '.db'}`);
    try {
      renameSync(source, target);
    } catch {
      rmSync(source, { force: true });
    }
  }

  return quarantineDir;
}

function validateRecoveredDb(dbPath: string): boolean {
  let db: SqliteDatabase | undefined;
  try {
    db = openSqliteDatabase(dbPath);
    return readIntegrityCheck(db) === 'ok';
  } catch {
    return false;
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close failures during recovery.
    }
  }
}

function recoverWithSqliteCli(dbPath: string): string | undefined {
  const recoveredPath = `${dbPath}.recovered-${timestampSegment()}-${process.pid}`;
  const recoveredSql = spawnSync('sqlite3', [dbPath, '.recover'], {
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024,
  });

  if (recoveredSql.error || recoveredSql.status !== 0 || recoveredSql.stdout.trim().length === 0) {
    return undefined;
  }

  const imported = spawnSync('sqlite3', [recoveredPath], {
    input: recoveredSql.stdout,
    encoding: 'utf-8',
    maxBuffer: 100 * 1024 * 1024,
  });

  if (imported.error || imported.status !== 0 || !validateRecoveredDb(recoveredPath)) {
    rmSync(recoveredPath, { force: true });
    return undefined;
  }

  return recoveredPath;
}

function openConfiguredSqliteDb(dbPath: string): SqliteDatabase {
  const db = openSqliteDatabase(dbPath);
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    const integrity = readIntegrityCheck(db);
    if (integrity !== 'ok') {
      throw new Error(`SQLite integrity check failed for ${dbPath}: ${integrity}`);
    }

    return db;
  } catch (error) {
    try {
      db.close();
    } catch {
      // Ignore close failures so the original open/configuration error wins.
    }
    throw error;
  }
}

export function openRecoveringRuntimeSqliteDb(dbPath: string): SqliteDatabase {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });

  try {
    return openConfiguredSqliteDb(dbPath);
  } catch (error) {
    if (!existsSync(dbPath) || !isCorruptSqliteError(error)) {
      throw error;
    }
  }

  const recoveredPath = recoverWithSqliteCli(dbPath);
  quarantineDbFiles(dbPath, recoveredPath ? 'recovered' : 'unrecoverable');

  if (recoveredPath) {
    renameSync(recoveredPath, dbPath);
    rmSync(`${recoveredPath}-wal`, { force: true });
    rmSync(`${recoveredPath}-shm`, { force: true });
  }

  return openConfiguredSqliteDb(dbPath);
}
