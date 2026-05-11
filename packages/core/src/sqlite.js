import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
function loadNodeSqliteDatabaseCtor() {
  const originalEmitWarning = process.emitWarning.bind(process);
  try {
    process.emitWarning = (warning, ...args) => {
      const message = typeof warning === 'string' ? warning : warning.message;
      if (message.includes('SQLite is an experimental feature')) {
        return;
      }
      originalEmitWarning(warning, ...args);
    };
    const nodeSqlite = require('node:sqlite');
    return typeof nodeSqlite.DatabaseSync === 'function' ? nodeSqlite.DatabaseSync : undefined;
  } catch {
    return undefined;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}
function loadSqliteDatabaseCtor() {
  const nodeSqliteCtor = loadNodeSqliteDatabaseCtor();
  if (nodeSqliteCtor) {
    return nodeSqliteCtor;
  }
  const desktopNativeModulesDir = process.env.PERSONAL_AGENT_DESKTOP_NATIVE_MODULES_DIR?.trim();
  if (desktopNativeModulesDir) {
    try {
      const desktopRequire = createRequire(resolve(desktopNativeModulesDir, 'package.json'));
      return desktopRequire('better-sqlite3');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not load Electron-native better-sqlite3 from ${desktopNativeModulesDir}: ${message}`);
    }
  }
  return require('better-sqlite3');
}
function wrapTransaction(db, fn) {
  return (...args) => {
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
export function openSqliteDatabase(path) {
  const DatabaseCtor = loadSqliteDatabaseCtor();
  const rawDb = new DatabaseCtor(path);
  return {
    exec(sql) {
      rawDb.exec(sql);
    },
    prepare(sql) {
      return rawDb.prepare(sql);
    },
    close() {
      rawDb.close();
    },
    pragma(statement) {
      if (typeof rawDb.pragma === 'function') {
        rawDb.pragma(statement);
        return;
      }
      rawDb.exec(`PRAGMA ${statement}`);
    },
    transaction(fn) {
      if (typeof rawDb.transaction === 'function') {
        return rawDb.transaction(fn);
      }
      return wrapTransaction(rawDb, fn);
    },
  };
}
