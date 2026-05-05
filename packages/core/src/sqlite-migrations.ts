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

import type { SqliteDatabase } from './sqlite.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Migration {
  /** Monotonically increasing version number. */
  version: number;
  /** Human-readable description for debugging. */
  description: string;
  /** Apply the migration. Must be idempotent. */
  up: (db: SqliteDatabase) => void;
}

export interface SafeRebuildOptions {
  /** The database handle. */
  db: SqliteDatabase;
  /**
   * The name of the table to rebuild.
   * A temp copy is created and the original is swapped in.
   */
  tableName: string;
  /**
   * Complete CREATE TABLE SQL for the new table.
   * Must include all indexes, constraints, etc.
   */
  createSql: string;
  /**
   * Column names to SELECT from the old table when copying data.
   * These are also used as the INSERT column list for the new table.
   *
   * If a column exists in the new table but not in the old schema,
   * omit it from this list — the INSERT will use the column default.
   */
  columns: string[];
  /** Optional custom SELECT expression for each column. Order must match `columns`. */
  selectExpressions?: string[];
  /**
   * Optional additional INSERT column names that exist in the new table
   * but not in the old table (e.g. renamed columns with new defaults).
   * Their values come from `additionalValues`.
   */
  additionalColumns?: string[];
  /** Values for additional columns (same order as `additionalColumns`). */
  additionalValues?: unknown[];
  /**
   * Whether to run PRAGMA foreign_key_check after the rebuild.
   * Defaults to true for safety.
   */
  validate?: boolean;
  /**
   * If true, FK violations after rebuild throw an error instead of logging.
   * Defaults to true — callers should fix FK issues, not ignore them.
   */
  strict?: boolean;
  /**
   * Child table definitions to check and rebuild if their FKs were
   * rewritten by SQLite during the parent table rename.
   *
   * SQLite automatically rewrites FOREIGN KEY clauses in child tables
   * to reference the new name when a parent is renamed. If the old parent
   * is dropped and recreated, child FK references become stale.
   *
   * Provide these to auto-repair child tables after the parent rebuild.
   */
  childTableDefs?: Array<{
    tableName: string;
    createSql: string;
    columns: string[];
    selectColumns?: string[];
  }>;
}

// ── Schema version helpers ────────────────────────────────────────────────────

/**
 * Read the current schema version from PRAGMA user_version.
 * Returns 0 if unset or the DB is new.
 */
export function readSchemaVersion(db: SqliteDatabase): number {
  const row = db.prepare('PRAGMA user_version').get() as
    | {
        user_version: number | null;
      }
    | undefined;
  if (!row || typeof row.user_version !== 'number') {
    return 0;
  }
  return row.user_version;
}

/**
 * Write the schema version to PRAGMA user_version.
 */
export function setSchemaVersion(db: SqliteDatabase, version: number): void {
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
export function applyMigrations(db: SqliteDatabase, label: string, migrations: Migration[]): number {
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

function sanitizeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_');
}

/**
 * Get the set of column names for a table.
 * Returns an empty set if the table doesn't exist.
 */
export function readTableColumnNames(db: SqliteDatabase, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(\`${sanitizeIdentifier(tableName)}\`)`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/**
 * Get the CREATE TABLE SQL for a table from sqlite_master.
 * Returns undefined if the table doesn't exist.
 */
export function readTableCreateSql(db: SqliteDatabase, tableName: string): string | undefined {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName) as { sql: string } | undefined;
  return row?.sql;
}

/**
 * Check whether a table's CREATE TABLE SQL references the given identifier
 * in a FOREIGN KEY clause. Useful for detecting child tables that point to
 * a renamed parent table.
 */
export function tableReferencesTable(db: SqliteDatabase, tableName: string, referencedTable: string): boolean {
  const sql = readTableCreateSql(db, tableName);
  if (!sql) return false;
  return new RegExp(`REFERENCES\\s+["'\`]?${escapeRegex(referencedTable)}["'\`]?`, 'i').test(sql);
}

function escapeRegex(value: string): string {
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
export function safeRebuildTable(opts: SafeRebuildOptions): void {
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
      const insert = db.prepare(
        `INSERT INTO "${tableName}" (${destCols.map((c) => `"${c}"`).join(', ')})
         SELECT ${sourceCols.map((c) => `"${c}"`).join(', ')}, ${placeholders}
         FROM "${tempName}"`,
      );
      insert.run(...opts.additionalValues);
    } else {
      const insert = db.prepare(
        `INSERT INTO "${tableName}" (${destCols.map((c) => `"${c}"`).join(', ')})
         SELECT ${sourceCols.map((c) => `"${c}"`).join(', ')}
         FROM "${tempName}"`,
      );
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
      const fkIssues = db.prepare('PRAGMA foreign_key_check').all() as Array<{
        table: string;
        rowid: number;
        parent: string;
        fkid: number;
      }>;
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
export function rebuildChildForeignKeys(
  db: SqliteDatabase,
  _parentTable: string,
  oldParentTable: string,
  childTableDefs: Array<{
    tableName: string;
    createSql: string;
    columns: string[];
    selectColumns?: string[];
  }>,
): void {
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
export function tableExists(db: SqliteDatabase, tableName: string): boolean {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
  return !!row;
}

/**
 * Check whether a table has any given column.
 */
export function hasAnyColumn(db: SqliteDatabase, tableName: string, ...columnNames: string[]): boolean {
  const existing = readTableColumnNames(db, tableName);
  return columnNames.some((c) => existing.has(c));
}

/**
 * Check whether a table has ALL given columns.
 */
export function hasAllColumns(db: SqliteDatabase, tableName: string, ...columnNames: string[]): boolean {
  const existing = readTableColumnNames(db, tableName);
  return columnNames.every((c) => existing.has(c));
}
