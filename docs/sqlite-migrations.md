# SQLite Schema Migrations

This doc describes the versioned schema migration framework in `@personal-agent/core` (`packages/core/src/sqlite-migrations.ts`).

## Why

Before this framework, each SQLite store handled schema migration ad-hoc:

- **Automation store**: `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` for each new column, plus one destructive `ALTER TABLE RENAME` that broke child table foreign keys
- **Activity store**: One-time legacy migration from markdown files, mixed with every-open schema creation
- **Runs store**, **Search index**, **Summaries**, older **Trace DB**: Pure `CREATE TABLE IF NOT EXISTS` — no version tracking at all

This caused the exact bug we hit: renaming `automations` → `automations_legacy_profile` silently rewrote FK references in child tables, and the repair was a post-hoc hack (`repairAutomationChildForeignKeys`).

## Core Concepts

### `PRAGMA user_version`

SQLite provides a single-integer schema version via `PRAGMA user_version`. This is the foundation of the migration system for single-schema stores. Shared stores, like the unified observability database, use a namespace table (`observability_schema_versions`) instead so trace and app-telemetry migrations do not fight over one global integer. Generic app telemetry is JSONL-first; its SQLite rows are a derived index, so prefer adding new metadata fields to the JSON event shape before introducing indexed columns or migrations.

### `Migration`

```typescript
interface Migration {
  version: number; // Monotonically increasing
  description: string; // Human-readable label
  up: (db: SqliteDatabase) => void; // Apply the migration
}
```

Each migration is **idempotent** — it checks `PRAGMA table_info` or other guards before applying changes.

### `safeRebuildTable`

For destructive schema changes (renaming columns, changing constraints), use `safeRebuildTable`. It handles the SQLite FK rewriting problem:

```typescript
safeRebuildTable({
  db,
  tableName: 'automations',
  createSql: `CREATE TABLE automations ( ... runtime_scope TEXT ... )`,
  columns: ['id', 'title' /* all columns except runtime_scope */],
  additionalColumns: ['runtime_scope'],
  additionalValues: ['shared'],
  childTableDefs: [
    {
      tableName: 'automation_state',
      createSql: `CREATE TABLE automation_state ( ... FK REFERENCES automations(id) ... )`,
      columns: ['automation_id', 'running' /* ... */],
    },
  ],
  validate: true,
  strict: true,
});
```

When a parent table is renamed, SQLite **automatically rewrites** FK references in child tables to point to the new name. The `childTableDefs` option detects and repairs those stale references.

## Usage

### Defining migrations

```typescript
import { applyMigrations, type Migration } from '@personal-agent/core';

const MY_MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Add columns from old schema',
    up: (db) => {
      const cols = readTableColumnNames(db, 'my_table');
      if (!cols.has('new_column')) {
        db.exec('ALTER TABLE my_table ADD COLUMN new_column TEXT');
      }
    },
  },
  {
    version: 2,
    description: 'Destructive column rename',
    up: (db) => {
      if (hasAnyColumn(db, 'my_table', 'old_name')) {
        safeRebuildTable({ ... });
      }
    },
  },
];
```

### Applying migrations on store open

```typescript
function openMyStore(): SqliteDatabase {
  const db = openSqliteDatabase(dbPath);
  db.pragma('foreign_keys = ON');

  // Create initial schema (no-op for existing tables)
  db.exec(`CREATE TABLE IF NOT EXISTS my_table (...)`);

  // Apply versioned migrations
  const tableExisted = tableExists(db, 'my_table');
  if (!tableExisted) {
    setSchemaVersion(db, MY_CURRENT_VERSION);
  } else {
    applyMigrations(db, 'my-store', MY_MIGRATIONS);
  }

  return db;
}
```

The flow:

1. **Fresh DB**: `CREATE TABLE IF NOT EXISTS` creates the table with the full schema → set version to latest → no migrations run
2. **Versioned DB**: `user_version > 0` → `applyMigrations` runs only pending steps
3. **Pre-migration DB**: `user_version` is 0 → `applyMigrations` runs **all** migrations from scratch. Each migration is idempotent (checks column presence before `ALTER TABLE`)

## Migrating a Store

To retrofit a store to use versioned migrations:

1. **Define current schema version**: `const MY_SCHEMA_VERSION = 1;`
2. **Define migrations**: Array of `Migration` objects representing every schema change since the first versioned schema
3. **Update `open*` function**: Replace ad-hoc column checks with `applyMigrations`
4. **Remove old migration code**: Delete functions like `migrateFooSchema`, `repairFooForeignKeys`
5. **Add tests**: Test fresh DB + pre-migration DB + versioned DB scenarios

## Pre-migration Backups

Before any schema-changing migration runs, `migrateWithBackup` creates a timestamped copy of the database file in a `.backups/` directory alongside the original DB.

```
/path/to/runtime.db
/path/to/.backups/
  runtime.db.2026-05-05T05-30-00-000Z.backup
  runtime.db.2026-05-05T05-00-00-000Z.backup
  runtime.db.2026-05-04T12-00-00-000Z.backup
```

The backup is taken **before** any schema changes, so it represents a known-good state. After a successful migration, old backups are pruned (keeping the 3 most recent by default). If a migration fails, the error includes the backup path and restore instructions.

### Restoring from a backup

```bash
# 1. Stop the daemon (close all DB handles)
# 2. Copy the backup back
cp /path/to/.backups/runtime.db.<timestamp>.backup /path/to/runtime.db
# 3. Remove stale WAL/SHM files
rm -f /path/to/runtime.db-wal /path/to/runtime.db-shm
# 4. Restart the daemon
```

Or programmatically:

```typescript
import { restoreDbBackup } from '@personal-agent/core';
restoreDbBackup('/path/to/runtime.db', '/path/to/.backups/runtime.db.<timestamp>.backup');
```

### Using migrateWithBackup

```typescript
import { migrateWithBackup } from '@personal-agent/core';

const result = migrateWithBackup(db, dbPath, 'my-store', MY_MIGRATIONS);
// result.applied    — number of migrations applied
// result.backupPath — path to the backup file (undefined if no migrations needed)
```

### Manual backup

```typescript
import { createDbBackup, listDbBackups } from '@personal-agent/core';

// Create a backup
const backupPath = createDbBackup('/path/to/runtime.db');

// List available backups (newest first)
const backups = listDbBackups('/path/to/runtime.db');
```

## Rules

1. **Never use `ALTER TABLE ... RENAME` directly**. Use `safeRebuildTable` which handles FK rewriting.
2. **Always validate after destructive migrations**. Add `validate: true` and `strict: true` to `safeRebuildTable`.
3. **Add column checks inside migrations**. Each migration should use `readTableColumnNames` to check if columns exist before `ALTER TABLE ADD COLUMN`.
4. **Test the upgrade path**. Create a fixture DB with the old schema, run migrations, assert data preservation and `PRAGMA foreign_key_check = []`.
5. **Store-specific version constants**. Each store has its own `SCHEMA_VERSION` constant that's bumped when new migrations are added.
6. **Use `migrateWithBackup` for production stores**. This creates a pre-migration backup so you can roll back if something goes wrong.
