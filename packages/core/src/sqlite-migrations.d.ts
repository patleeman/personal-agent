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
/**
 * Read the current schema version from PRAGMA user_version.
 * Returns 0 if unset or the DB is new.
 */
export declare function readSchemaVersion(db: SqliteDatabase): number;
/**
 * Write the schema version to PRAGMA user_version.
 */
export declare function setSchemaVersion(db: SqliteDatabase, version: number): void;
/**
 * Apply pending migrations in order.
 *
 * @param db - Open SQLite database handle.
 * @param label - Store label for error messages (e.g. "automations").
 * @param migrations - Ordered array of all possible migrations.
 * @returns The number of migrations applied.
 */
export declare function applyMigrations(db: SqliteDatabase, label: string, migrations: Migration[]): number;
/**
 * Get the set of column names for a table.
 * Returns an empty set if the table doesn't exist.
 */
export declare function readTableColumnNames(db: SqliteDatabase, tableName: string): Set<string>;
/**
 * Get the CREATE TABLE SQL for a table from sqlite_master.
 * Returns undefined if the table doesn't exist.
 */
export declare function readTableCreateSql(db: SqliteDatabase, tableName: string): string | undefined;
/**
 * Check whether a table's CREATE TABLE SQL references the given identifier
 * in a FOREIGN KEY clause. Useful for detecting child tables that point to
 * a renamed parent table.
 */
export declare function tableReferencesTable(db: SqliteDatabase, tableName: string, referencedTable: string): boolean;
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
export declare function safeRebuildTable(opts: SafeRebuildOptions): void;
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
export declare function rebuildChildForeignKeys(db: SqliteDatabase, _parentTable: string, oldParentTable: string, childTableDefs: Array<{
    tableName: string;
    createSql: string;
    columns: string[];
    selectColumns?: string[];
}>): void;
/**
 * Check whether a table exists in the database.
 */
export declare function tableExists(db: SqliteDatabase, tableName: string): boolean;
/**
 * Check whether a table has any given column.
 */
export declare function hasAnyColumn(db: SqliteDatabase, tableName: string, ...columnNames: string[]): boolean;
/**
 * Check whether a table has ALL given columns.
 */
export declare function hasAllColumns(db: SqliteDatabase, tableName: string, ...columnNames: string[]): boolean;
/**
 * Default number of recent migration backups to keep.
 */
export declare const DEFAULT_BACKUP_RETENTION = 3;
/**
 * Get the backup directory path for a given DB file.
 * Backups are stored alongside the DB file in a `.backups` subdirectory.
 *
 * Example: `/path/to/runtime.db` → `/path/to/.backups/`
 */
export declare function resolveBackupDir(dbPath: string): string;
/**
 * Resolve the backup file path for a given DB file and timestamp.
 */
export declare function resolveBackupPath(dbPath: string, timestamp: string): string;
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
export declare function createDbBackup(dbPath: string, db?: SqliteDatabase): string;
/**
 * List available backups for a database file, ordered newest-first.
 */
export declare function listDbBackups(dbPath: string): string[];
/**
 * Prune old backups, keeping only the most recent N.
 */
export declare function pruneBackups(dbPath: string, keep?: number): void;
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
export declare function migrateWithBackup(db: SqliteDatabase, dbPath: string, label: string, migrations: Migration[]): {
    applied: number;
    backupPath?: string;
};
/**
 * Restore a database file from a backup.
 *
 * Closes the WAL/SHM files first by removing them, then copies the
 * backup back to the original path.
 */
export declare function restoreDbBackup(dbPath: string, backupPath: string): void;
