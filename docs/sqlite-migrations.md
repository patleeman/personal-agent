# SQLite Schema Migrations

This doc describes the versioned schema migration framework in `@personal-agent/core` (`packages/core/src/sqlite-migrations.ts`).

## Why

Before this framework, each SQLite store handled schema migration ad-hoc:

- **Automation store**: `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` for each new column, plus one destructive `ALTER TABLE RENAME` that broke child table foreign keys
- **Activity store**: One-time legacy migration from markdown files, mixed with every-open schema creation
- **Runs store**, **Search index**, **Summaries**, **Trace DB**: Pure `CREATE TABLE IF NOT EXISTS` — no version tracking at all

This caused the exact bug we hit: renaming `automations` → `automations_legacy_profile` silently rewrote FK references in child tables, and the repair was a post-hoc hack (`repairAutomationChildForeignKeys`).

## Core Concepts

### `PRAGMA user_version`

SQLite provides a single-integer schema version via `PRAGMA user_version`. This is the foundation of the migration system.

### `Migration`

```typescript
interface Migration {
  version: number;       // Monotonically increasing
  description: string;   // Human-readable label
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
  columns: ['id', 'title', /* all columns except runtime_scope */],
  additionalColumns: ['runtime_scope'],
  additionalValues: ['shared'],
  childTableDefs: [
    {
      tableName: 'automation_state',
      createSql: `CREATE TABLE automation_state ( ... FK REFERENCES automations(id) ... )`,
      columns: ['automation_id', 'running', /* ... */],
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

## Rules

1. **Never use `ALTER TABLE ... RENAME` directly**. Use `safeRebuildTable` which handles FK rewriting.
2. **Always validate after destructive migrations**. Add `validate: true` and `strict: true` to `safeRebuildTable`.
3. **Add column checks inside migrations**. Each migration should use `readTableColumnNames` to check if columns exist before `ALTER TABLE ADD COLUMN`.
4. **Test the upgrade path**. Create a fixture DB with the old schema, run migrations, assert data preservation and `PRAGMA foreign_key_check = []`.
5. **Store-specific version constants**. Each store has its own `SCHEMA_VERSION` constant that's bumped when new migrations are added.
