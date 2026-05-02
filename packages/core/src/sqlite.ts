import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);

export interface SqliteRunResult {
  changes: number;
  lastInsertRowid: number | bigint;
}

export interface SqliteStatement {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
  pragma(statement: string): void;
  transaction<TArgs extends unknown[]>(fn: (...args: TArgs) => void): (...args: TArgs) => void;
}

type RawSqliteStatement = {
  run(...params: unknown[]): SqliteRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
};

type RawSqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): RawSqliteStatement;
  close(): void;
  pragma?(statement: string): void;
  transaction?<TArgs extends unknown[]>(fn: (...args: TArgs) => void): (...args: TArgs) => void;
};

type SqliteDatabaseCtor = new (path: string) => RawSqliteDatabase;

function loadNodeSqliteDatabaseCtor(): SqliteDatabaseCtor | undefined {
  const originalEmitWarning = process.emitWarning.bind(process);

  try {
    process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
      const message = typeof warning === 'string' ? warning : warning.message;
      if (message.includes('SQLite is an experimental feature')) {
        return;
      }

      (originalEmitWarning as (...values: unknown[]) => void)(warning, ...args);
    }) as typeof process.emitWarning;

    const nodeSqlite = require('node:sqlite') as { DatabaseSync?: SqliteDatabaseCtor };
    return typeof nodeSqlite.DatabaseSync === 'function' ? nodeSqlite.DatabaseSync : undefined;
  } catch {
    return undefined;
  } finally {
    process.emitWarning = originalEmitWarning as typeof process.emitWarning;
  }
}

function loadSqliteDatabaseCtor(): SqliteDatabaseCtor {
  const nodeSqliteCtor = loadNodeSqliteDatabaseCtor();
  if (nodeSqliteCtor) {
    return nodeSqliteCtor;
  }

  const desktopNativeModulesDir = process.env.PERSONAL_AGENT_DESKTOP_NATIVE_MODULES_DIR?.trim();
  if (desktopNativeModulesDir) {
    try {
      const desktopRequire = createRequire(resolve(desktopNativeModulesDir, 'package.json'));
      return desktopRequire('better-sqlite3') as SqliteDatabaseCtor;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not load Electron-native better-sqlite3 from ${desktopNativeModulesDir}: ${message}`);
    }
  }

  return require('better-sqlite3') as SqliteDatabaseCtor;
}

function wrapTransaction<TArgs extends unknown[]>(db: RawSqliteDatabase, fn: (...args: TArgs) => void): (...args: TArgs) => void {
  return (...args: TArgs) => {
    db.exec('BEGIN');

    try {
      fn(...args);
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // Ignore rollback failures so the original error wins.
      }
      throw error;
    }
  };
}

export function openSqliteDatabase(path: string): SqliteDatabase {
  const DatabaseCtor = loadSqliteDatabaseCtor();
  const rawDb = new DatabaseCtor(path);

  return {
    exec(sql: string): void {
      rawDb.exec(sql);
    },
    prepare(sql: string): SqliteStatement {
      return rawDb.prepare(sql);
    },
    close(): void {
      rawDb.close();
    },
    pragma(statement: string): void {
      if (typeof rawDb.pragma === 'function') {
        rawDb.pragma(statement);
        return;
      }

      rawDb.exec(`PRAGMA ${statement}`);
    },
    transaction<TArgs extends unknown[]>(fn: (...args: TArgs) => void): (...args: TArgs) => void {
      if (typeof rawDb.transaction === 'function') {
        return rawDb.transaction(fn);
      }

      return wrapTransaction(rawDb, fn);
    },
  };
}
