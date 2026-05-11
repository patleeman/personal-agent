/**
 * SQLite schema migration framework.
 *
 * Provides versioned, sequential migrations for SQLite databases with
 * a safe table-rebuild helper that handles foreign key constraints correctly.
 *
 * Usage:
 *
 *   import { applyMigrations, safeRebuildTable } from '@personal-agent/core';
 *
 *   const MIGRATIONS: Migration[] = [
 *     { version: 1, description: 'Initial schema', up: (db) => { ... } },
 *     { version: 2, description: 'Add column',     up: (db) => { ... } },
 *   ];
 *
 *   applyMigrations(db, 'my-store', MIGRATIONS);
 */
// ── Schema version helpers ────────────────────────────────────────────────────
/**
 * Read the current schema version from PRAGMA user_version.
 * Returns 0 if unset or the DB is new.
 */
export function readSchemaVersion(db) {
  const row = db.prepare('PRAGMA user_version').get();
  if (!row || typeof row.user_version !== 'number') {
    return 0;
  }
  return row.user_version;
}
/**
 * Write the schema version to PRAGMA user_version.
 */
export function setSchemaVersion(db, version) {
  db.exec(`PRAGMA user_version = ${version}`);
}
// ── Migration runner ──────────────────────────────────────────────────────────
/**
 * Apply pending migrations in order.
 *
 * @param db - Open SQLite database handle.
 * @param label - Store label for error messages (e.g. "automations").
 * @param migrations - Ordered array of all possible migrations.
 * @returns The number of migrations applied.
 */
export function applyMigrations(db, label, migrations) {
  if (migrations.length === 0) return 0;
  const sorted = [...migrations].sort((a, b) => a.version - b.version);
  const latest = sorted[sorted.length - 1].version;
  const current = readSchemaVersion(db);
  let applied = 0;
  // Version 0 means unset — this is a pre-migration DB with no version tracking.
  // Run ALL migrations from the start to bring it to the latest schema.
  if (current === 0) {
    for (const m of sorted) {
      m.up(db);
      setSchemaVersion(db, m.version);
      applied++;
    }
    return applied;
  }
  if (current > latest) {
    throw new Error(
      `${label}: database schema version ${current} is newer than the latest migration version ${latest}. ` +
        'This likely means the application was downgraded.',
    );
  }
  for (const m of sorted) {
    if (m.version <= current) continue;
    m.up(db);
    setSchemaVersion(db, m.version);
    applied++;
  }
  return applied;
}
// ── Column detection ──────────────────────────────────────────────────────────
function sanitizeIdentifier(value) {
  return value.replace(/[^a-zA-Z0-9_]/g, '_');
}
/**
 * Get the set of column names for a table.
 * Returns an empty set if the table doesn't exist.
 */
export function readTableColumnNames(db, tableName) {
  const rows = db.prepare(`PRAGMA table_info(\`${sanitizeIdentifier(tableName)}\`)`).all();
  return new Set(rows.map((r) => r.name));
}
/**
 * Get the CREATE TABLE SQL for a table from sqlite_master.
 * Returns undefined if the table doesn't exist.
 */
export function readTableCreateSql(db, tableName) {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return row?.sql;
}
/**
 * Check whether a table's CREATE TABLE SQL references the given identifier
 * in a FOREIGN KEY clause. Useful for detecting child tables that point to
 * a renamed parent table.
 */
export function tableReferencesTable(db, tableName, referencedTable) {
  const sql = readTableCreateSql(db, tableName);
  if (!sql) return false;
  return new RegExp(`REFERENCES\\s+["'\`]?${escapeRegex(referencedTable)}["'\`]?`, 'i').test(sql);
}
function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
// ── Safe table rebuild ────────────────────────────────────────────────────────
/**
 * Rebuild a table safely, handling SQLite FK constraint rewriting on rename.
 *
 * SQLite automatically rewrites FOREIGN KEY clauses in child tables when
 * a parent table is renamed. This helper:
 *
 * 1. Disables FK enforcement
 * 2. Renames the old table to a temp name
 * 3. Creates the new table
 * 4. Copies data from the old table
 * 5. Drops the temp table
 * 6. Rebuilds child tables whose FKs were rewritten (if childTableDefs provided)
 * 7. Validates FK integrity via PRAGMA foreign_key_check
 * 8. Re-enables FK enforcement
 *
 * If any step fails, it tries to restore the original table.
 */
export function safeRebuildTable(opts) {
  const { db, tableName, createSql, columns, selectExpressions, validate, strict } = opts;
  const tempName = `${tableName}_migrate_${Date.now()}`;
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    // Rename old -> temp.  SQLite will rewrite FK references in child tables
    // to point at the temp name.  We auto-repair those after the rebuild.
    db.exec(`ALTER TABLE "${tableName}" RENAME TO "${tempName}"`);
    // Create new table
    db.exec(createSql);
    // Build column lists
    const sourceCols = selectExpressions ?? columns;
    const destCols = [...columns];
    if (opts.additionalColumns) {
      destCols.push(...opts.additionalColumns);
    }
    // Build INSERT with additional values
    if (opts.additionalColumns && opts.additionalValues) {
      const placeholders = opts.additionalValues.map(() => '?').join(', ');
      const insert = db.prepare(`INSERT INTO "${tableName}" (${destCols.map((c) => `"${c}"`).join(', ')})
         SELECT ${sourceCols.map((c) => `"${c}"`).join(', ')}, ${placeholders}
         FROM "${tempName}"`);
      insert.run(...opts.additionalValues);
    } else {
      const insert = db.prepare(`INSERT INTO "${tableName}" (${destCols.map((c) => `"${c}"`).join(', ')})
         SELECT ${sourceCols.map((c) => `"${c}"`).join(', ')}
         FROM "${tempName}"`);
      insert.run();
    }
    // Drop old table
    db.exec(`DROP TABLE "${tempName}"`);
    // Repair child tables whose FKs were rewritten by SQLite to point at the
    // temp name.  This is the step that prevents the exact bug class we hit.
    //
    // We skip validation on each intermediate child rebuild because sibling
    // tables may still have stale FKs at that point.  The final PRAGMA
    // foreign_key_check at the end of this function catches everything.
    if (opts.childTableDefs) {
      for (const def of opts.childTableDefs) {
        if (tableReferencesTable(db, def.tableName, tempName)) {
          safeRebuildTable({
            db,
            tableName: def.tableName,
            createSql: def.createSql,
            columns: def.columns,
            selectExpressions: def.selectColumns,
            validate: false,
            strict: false,
          });
        }
      }
    }
    // Validate
    if (validate !== false) {
      const fkIssues = db.prepare('PRAGMA foreign_key_check').all();
      if (fkIssues.length > 0) {
        const message = `${tableName}: ${fkIssues.length} foreign key violation(s) after rebuild: ${JSON.stringify(fkIssues)}`;
        if (strict) {
          throw new Error(message);
        }
        for (const issue of fkIssues) {
          db.exec(`SELECT 'FK_VIOLATION: table=${issue.table} rowid=${issue.rowid} parent=${issue.parent}'`);
        }
      }
    }
  } catch (error) {
    // Try to restore the original table, but don't swallow the original error
    try {
      const newTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
      if (!newTableExists) {
        const oldTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tempName);
        if (oldTableExists) {
          db.exec(`ALTER TABLE "${tempName}" RENAME TO "${tableName}"`);
        }
      }
    } catch {
      // Best-effort restore — original error wins
    }
    throw error;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}
// ── Child table FK repair (standalone) ────────────────────────────────────────
/**
 * Rebuild child tables whose FK references point to an old (renamed) parent table.
 *
 * After a parent table is renamed, SQLite rewrites FK clauses in child tables
 * to reference the new name. If the parent is then dropped and a new table
 * with the original name is created, the child FKs still point to the temp name.
 *
 * This function detects such stale FK references and rebuilds the affected child
 * tables so their FKs point to the correct parent.
 *
 * Prefer using `safeRebuildTable` with `childTableDefs` instead of this standalone
 * function, as that handles the repair automatically during the rebuild.
 */
export function rebuildChildForeignKeys(db, _parentTable, oldParentTable, childTableDefs) {
  for (const def of childTableDefs) {
    if (tableReferencesTable(db, def.tableName, oldParentTable)) {
      safeRebuildTable({
        db,
        tableName: def.tableName,
        createSql: def.createSql,
        columns: def.columns,
        selectExpressions: def.selectColumns,
        validate: true,
        strict: true,
      });
    }
  }
}
// ── Table introspection helpers ───────────────────────────────────────────────
/**
 * Check whether a table exists in the database.
 */
export function tableExists(db, tableName) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  return !!row;
}
/**
 * Check whether a table has any given column.
 */
export function hasAnyColumn(db, tableName, ...columnNames) {
  const existing = readTableColumnNames(db, tableName);
  return columnNames.some((c) => existing.has(c));
}
/**
 * Check whether a table has ALL given columns.
 */
export function hasAllColumns(db, tableName, ...columnNames) {
  const existing = readTableColumnNames(db, tableName);
  return columnNames.every((c) => existing.has(c));
}
// ── Pre-migration backups ─────────────────────────────────────────────────────
import { copyFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
/**
 * Default number of recent migration backups to keep.
 */
export const DEFAULT_BACKUP_RETENTION = 3;
/**
 * Get the backup directory path for a given DB file.
 * Backups are stored alongside the DB file in a `.backups` subdirectory.
 *
 * Example: `/path/to/runtime.db` → `/path/to/.backups/`
 */
export function resolveBackupDir(dbPath) {
  const dbDir = dirname(dbPath);
  return join(dbDir, '.backups');
}
/**
 * Resolve the backup file path for a given DB file and timestamp.
 */
export function resolveBackupPath(dbPath, timestamp) {
  const dbName = basename(dbPath);
  const dir = resolveBackupDir(dbPath);
  return join(dir, `${dbName}.${timestamp}.backup`);
}
/**
 * Create a timestamped backup copy of a SQLite database file.
 *
 * Best practice: pass the opened DB handle so we can flush the WAL first
 * via PRAGMA wal_checkpoint(TRUNCATE), ensuring the main DB file is
 * consistent. When no handle is provided, we copy whatever is on disk.
 *
 * @param dbPath - Absolute path to the SQLite database file.
 * @param db - Optional open database handle. If provided, a WAL checkpoint
 *   is run before copying to ensure consistency.
 * @returns The path to the created backup file.
 */
export function createDbBackup(dbPath, db) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = resolveBackupDir(dbPath);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  let backupPath = resolveBackupPath(dbPath, timestamp);
  for (let counter = 1; existsSync(backupPath); counter += 1) {
    backupPath = resolveBackupPath(dbPath, `${timestamp}-${String(counter).padStart(3, '0')}`);
  }
  // Flush WAL if we have a handle
  if (db) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      // Best-effort — copy whatever is on disk
    }
  }
  copyFileSync(dbPath, backupPath);
  // Clean up old backups beyond retention
  pruneBackups(dbPath);
  return backupPath;
}
/**
 * List available backups for a database file, ordered newest-first.
 */
export function listDbBackups(dbPath) {
  const dir = resolveBackupDir(dbPath);
  if (!existsSync(dir)) {
    return [];
  }
  const dbName = basename(dbPath);
  const prefix = `${dbName}.`;
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.backup'))
    .map((f) => join(dir, f))
    .sort()
    .reverse();
}
/**
 * Prune old backups, keeping only the most recent N.
 */
export function pruneBackups(dbPath, keep = DEFAULT_BACKUP_RETENTION) {
  const backups = listDbBackups(dbPath);
  if (backups.length <= keep) {
    return;
  }
  for (const oldBackup of backups.slice(keep)) {
    try {
      unlinkSync(oldBackup);
    } catch {
      // Best-effort cleanup
    }
  }
}
/**
 * Migrate with pre-migration backup.
 *
 * Before applying any pending migrations, creates a timestamped backup
 * of the database file.  If the migration succeeds, old backups are pruned.
 * If it fails, an error is thrown with the backup path so the caller can
 * restore manually.
 *
 * @returns Object with `applied` (number of migrations applied) and
 *   `backupPath` (path to the backup, if one was taken).
 */
export function migrateWithBackup(db, dbPath, label, migrations) {
  const pending = migrations.filter((m) => m.version > readSchemaVersion(db));
  if (pending.length === 0) {
    return { applied: 0 };
  }
  // Take a backup before making any schema changes.
  // Pass the DB handle so WAL is flushed first.
  const backupPath = createDbBackup(dbPath, db);
  try {
    const applied = applyMigrations(db, label, migrations);
    return { applied, backupPath };
  } catch (error) {
    // Migration failed — the backup is available for manual restore.
    // We don't auto-restore because the DB handle may be in an
    // inconsistent state. The caller or operator should:
    //   1. Close the database
    //   2. restoreDbBackup(dbPath, backupPath)
    //   3. Reopen
    const message =
      `Migration failed for ${label}. ` +
      `A backup was created at: ${backupPath}\n` +
      `To restore: close the database, then run:\n` +
      `  cp "${backupPath}" "${dbPath}"\n` +
      `  rm -f "${dbPath}-wal" "${dbPath}-shm"`;
    throw new Error(message, { cause: error });
  }
}
/**
 * Restore a database file from a backup.
 *
 * Closes the WAL/SHM files first by removing them, then copies the
 * backup back to the original path.
 */
export function restoreDbBackup(dbPath, backupPath) {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }
  // Remove stale WAL and SHM files so SQLite starts fresh
  for (const ext of ['-wal', '-shm']) {
    try {
      unlinkSync(`${dbPath}${ext}`);
    } catch {
      // Ignore if files don't exist
    }
  }
  copyFileSync(backupPath, dbPath);
}
