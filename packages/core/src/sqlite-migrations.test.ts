import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  applyMigrations,
  createDbBackup,
  hasAllColumns,
  hasAnyColumn,
  listDbBackups,
  migrateWithBackup,
  type Migration,
  readSchemaVersion,
  readTableColumnNames,
  readTableCreateSql,
  rebuildChildForeignKeys,
  restoreDbBackup,
  safeRebuildTable,
  setSchemaVersion,
  type SqliteDatabase,
  tableExists,
  tableReferencesTable,
} from './index.js';
import { openSqliteDatabase } from './sqlite.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const tempFiles: string[] = [];

function createTempDb(): { db: SqliteDatabase; path: string } {
  const path = join(mkdtempSync(join(tmpdir(), 'sqlite-migrations-test-')), 'test.db');
  const db = openSqliteDatabase(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  tempFiles.push(path);
  return { db, path };
}

afterEach(() => {
  for (const path of tempFiles) {
    try {
      rmSync(path, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tempFiles.length = 0;
});

// ── Schema version helpers ────────────────────────────────────────────────────

describe('readSchemaVersion / setSchemaVersion', () => {
  it('returns 0 for a fresh database', () => {
    const { db } = createTempDb();
    expect(readSchemaVersion(db)).toBe(0);
  });

  it('returns the value set by setSchemaVersion', () => {
    const { db } = createTempDb();
    setSchemaVersion(db, 42);
    expect(readSchemaVersion(db)).toBe(42);
  });

  it('can be set multiple times', () => {
    const { db } = createTempDb();
    setSchemaVersion(db, 1);
    setSchemaVersion(db, 2);
    setSchemaVersion(db, 3);
    expect(readSchemaVersion(db)).toBe(3);
  });
});

// ── applyMigrations ───────────────────────────────────────────────────────────

describe('applyMigrations', () => {
  it('applies pending migrations in order', () => {
    const { db } = createTempDb();
    const applied: number[] = [];

    const migrations: Migration[] = [
      { version: 1, description: 'v1', up: () => applied.push(1) },
      { version: 2, description: 'v2', up: () => applied.push(2) },
      { version: 3, description: 'v3', up: () => applied.push(3) },
    ];

    // Set version to 1 and expect migrations 2,3 to run
    setSchemaVersion(db, 1);
    applyMigrations(db, 'test', migrations);
    expect(applied).toEqual([2, 3]);
  });

  it('applies nothing when already at latest', () => {
    const { db } = createTempDb();
    const applied: number[] = [];

    const migrations: Migration[] = [
      { version: 1, description: 'v1', up: () => applied.push(1) },
      { version: 2, description: 'v2', up: () => applied.push(2) },
    ];

    setSchemaVersion(db, 2);
    applyMigrations(db, 'test', migrations);
    expect(applied).toEqual([]);
  });

  it('applies all migrations when version is 0 (pre-migration DB)', () => {
    const { db } = createTempDb();
    const applied: number[] = [];

    const migrations: Migration[] = [
      { version: 1, description: 'v1', up: () => applied.push(1) },
      { version: 2, description: 'v2', up: () => applied.push(2) },
    ];

    applyMigrations(db, 'test', migrations);
    // Version 0 means pre-migration — run all migrations from scratch
    expect(applied).toEqual([1, 2]);
    expect(readSchemaVersion(db)).toBe(2);
  });

  it('throws when DB version exceeds latest migration', () => {
    const { db } = createTempDb();
    setSchemaVersion(db, 99);

    const migrations: Migration[] = [{ version: 1, description: 'v1', up: () => {} }];

    expect(() => applyMigrations(db, 'test', migrations)).toThrow(/newer/);
  });

  it('updates user_version after each migration', () => {
    const { db } = createTempDb();
    setSchemaVersion(db, 1);

    const migrations: Migration[] = [
      { version: 2, description: 'v2', up: (d) => d.exec('CREATE TABLE v2_check (x TEXT)') },
      { version: 3, description: 'v3', up: (d) => d.exec('CREATE TABLE v3_check (x TEXT)') },
    ];

    applyMigrations(db, 'test', migrations);
    expect(readSchemaVersion(db)).toBe(3);
    expect(tableExists(db, 'v2_check')).toBe(true);
    expect(tableExists(db, 'v3_check')).toBe(true);
  });
});

// ── Column detection ──────────────────────────────────────────────────────────

describe('readTableColumnNames', () => {
  it('returns columns for a created table', () => {
    const { db } = createTempDb();
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL, value REAL)');
    const cols = readTableColumnNames(db, 't');
    expect([...cols].sort()).toEqual(['id', 'name', 'value']);
  });

  it('returns empty set for non-existent table', () => {
    const { db } = createTempDb();
    expect([...readTableColumnNames(db, 'nonexistent')]).toEqual([]);
  });
});

describe('readTableCreateSql', () => {
  it('returns CREATE TABLE SQL', () => {
    const { db } = createTempDb();
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)');
    const sql = readTableCreateSql(db, 't');
    expect(sql).toContain('CREATE TABLE');
    expect(sql).toContain('t');
  });

  it('returns undefined for non-existent table', () => {
    const { db } = createTempDb();
    expect(readTableCreateSql(db, 'nonexistent')).toBeUndefined();
  });
});

describe('tableReferencesTable', () => {
  it('detects FK references', () => {
    const { db } = createTempDb();
    db.exec(`
      CREATE TABLE parent (id TEXT PRIMARY KEY);
      CREATE TABLE child (
        id TEXT PRIMARY KEY,
        parent_id TEXT,
        FOREIGN KEY (parent_id) REFERENCES parent(id)
      );
    `);
    expect(tableReferencesTable(db, 'child', 'parent')).toBe(true);
    expect(tableReferencesTable(db, 'child', 'other')).toBe(false);
    expect(tableReferencesTable(db, 'parent', 'child')).toBe(false);
  });
});

describe('tableExists', () => {
  it('returns true for existing table', () => {
    const { db } = createTempDb();
    db.exec('CREATE TABLE t (x TEXT)');
    expect(tableExists(db, 't')).toBe(true);
  });

  it('returns false for non-existent table', () => {
    const { db } = createTempDb();
    expect(tableExists(db, 'nonexistent')).toBe(false);
  });
});

describe('hasAnyColumn / hasAllColumns', () => {
  it('checks column presence correctly', () => {
    const { db } = createTempDb();
    db.exec('CREATE TABLE t (a TEXT, b TEXT, c TEXT)');

    expect(hasAnyColumn(db, 't', 'a', 'z')).toBe(true);
    expect(hasAnyColumn(db, 't', 'x', 'y')).toBe(false);
    expect(hasAllColumns(db, 't', 'a', 'b')).toBe(true);
    expect(hasAllColumns(db, 't', 'a', 'd')).toBe(false);
  });
});

// ── SafeRebuildTable ──────────────────────────────────────────────────────────

describe('safeRebuildTable', () => {
  it('rebuilds a table and preserves data', () => {
    const { db } = createTempDb();
    db.exec(`CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT
    )`);
    db.exec(`INSERT INTO users VALUES ('u1', 'Alice', 'alice@test.com')`);
    db.exec(`INSERT INTO users VALUES ('u2', 'Bob', 'bob@test.com')`);

    const newSchema = `CREATE TABLE users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'user'
    )`;

    safeRebuildTable({
      db,
      tableName: 'users',
      createSql: newSchema,
      columns: ['id', 'name', 'email'],
      additionalColumns: ['role'],
      additionalValues: ['user'],
      validate: true,
      strict: true,
    });

    const rows = db.prepare('SELECT id, name, email, role FROM users ORDER BY id').all() as Array<{
      id: string;
      name: string;
      email: string;
      role: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ id: 'u1', name: 'Alice', email: 'alice@test.com', role: 'user' });
    expect(rows[1]).toEqual({ id: 'u2', name: 'Bob', email: 'bob@test.com', role: 'user' });
  });

  it('preserves child FK references through rebuild', () => {
    const { db } = createTempDb();
    db.exec(`CREATE TABLE parent (
      id TEXT PRIMARY KEY
    )`);
    db.exec(`CREATE TABLE child (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      FOREIGN KEY (parent_id) REFERENCES parent(id)
    )`);
    db.exec(`INSERT INTO parent VALUES ('p1')`);
    db.exec(`INSERT INTO child VALUES ('c1', 'p1')`);

    // Rebuild parent with child table defs so child FKs auto-repair
    const newParentSchema = `CREATE TABLE parent (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL DEFAULT 'default'
    )`;
    safeRebuildTable({
      db,
      tableName: 'parent',
      createSql: newParentSchema,
      columns: ['id'],
      additionalColumns: ['label'],
      additionalValues: ['default'],
      childTableDefs: [
        {
          tableName: 'child',
          createSql: `CREATE TABLE child (
            id TEXT PRIMARY KEY,
            parent_id TEXT,
            FOREIGN KEY (parent_id) REFERENCES parent(id)
          )`,
          columns: ['id', 'parent_id'],
        },
      ],
      validate: true,
      strict: true,
    });

    // Child FK should still work
    const childRows = db.prepare('SELECT id, parent_id FROM child').all() as Array<{
      id: string;
      parent_id: string;
    }>;
    expect(childRows).toEqual([{ id: 'c1', parent_id: 'p1' }]);

    // No FK violations
    const fkIssues = db.prepare('PRAGMA foreign_key_check').all();
    expect(fkIssues).toEqual([]);
  });

  it('restores the original table on failure', () => {
    const { db } = createTempDb();
    db.exec(`CREATE TABLE target (
      id TEXT PRIMARY KEY,
      value TEXT
    )`);
    db.exec(`INSERT INTO target VALUES ('k1', 'v1')`);

    // Use a broken CREATE SQL (missing comma)
    expect(() =>
      safeRebuildTable({
        db,
        tableName: 'target',
        createSql: 'CREATE TABLE target (id TEXT PRIMARY KEY value TEXT)',
        columns: ['id', 'value'],
        validate: false,
      }),
    ).toThrow();

    // Original table should still be intact
    const row = db.prepare("SELECT value FROM target WHERE id = 'k1'").get() as { value: string };
    expect(row.value).toBe('v1');
  });
});

// ── rebuildChildForeignKeys ───────────────────────────────────────────────────

describe('rebuildChildForeignKeys', () => {
  it('rebuilds child tables with stale FK references', () => {
    const { db } = createTempDb();

    // Simulate the scenario: parent was renamed (e.g. users → users_old),
    // and a new parent table was created with the original name.
    // The child table still has FK → users_old.
    db.exec(`CREATE TABLE users_old (
      id TEXT PRIMARY KEY
    )`);
    db.exec(`INSERT INTO users_old VALUES ('u1')`);

    // New parent created with original name
    db.exec(`CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT
    )`);
    db.exec(`INSERT INTO users VALUES ('u1', 'u1@test.com')`);

    // This is the bug scenario: child was created when parent was named users_old,
    // and SQLite rewrote the FK to reference users_old
    db.exec(`CREATE TABLE posts (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      FOREIGN KEY (user_id) REFERENCES users_old(id)
    )`);
    db.exec(`INSERT INTO posts VALUES ('p1', 'u1')`);

    // Verify broken FK reference
    expect(tableReferencesTable(db, 'posts', 'users_old')).toBe(true);

    // Fix it
    rebuildChildForeignKeys(db, 'users', 'users_old', [
      {
        tableName: 'posts',
        createSql: `CREATE TABLE posts (
          id TEXT PRIMARY KEY,
          user_id TEXT,
          FOREIGN KEY (user_id) REFERENCES users(id)
        )`,
        columns: ['id', 'user_id'],
      },
    ]);

    // FK should now point to users
    expect(tableReferencesTable(db, 'posts', 'users_old')).toBe(false);

    // Verify data preserved
    const row = db.prepare('SELECT id, user_id FROM posts').get() as { id: string; user_id: string };
    expect(row).toEqual({ id: 'p1', user_id: 'u1' });

    // No FK violations
    const fkIssues = db.prepare('PRAGMA foreign_key_check').all();
    expect(fkIssues).toEqual([]);
  });
});

// ── Pre-migration backups ─────────────────────────────────────────────────────

describe('createDbBackup / restoreDbBackup', () => {
  it('creates a backup of a database file', () => {
    const { db, path: dbPath } = createTempDb();
    db.exec('CREATE TABLE t (x TEXT)');
    db.exec("INSERT INTO t VALUES ('hello')");

    // Pass the db handle so WAL gets flushed before copy
    const backupPath = createDbBackup(dbPath, db);
    expect(backupPath).toContain('.backups');
    expect(backupPath).toMatch(/\.backup$/);

    // Verify the backup exists and can be opened
    const backupDb = openSqliteDatabase(backupPath);
    const row = backupDb.prepare('SELECT x FROM t').get() as { x: string };
    expect(row.x).toBe('hello');
    backupDb.close();
  });

  it('lists backups newest-first', () => {
    const { db, path: dbPath } = createTempDb();
    db.exec('CREATE TABLE t (x TEXT)');

    const first = createDbBackup(dbPath, db);
    const second = createDbBackup(dbPath, db);
    const all = listDbBackups(dbPath);

    expect(all).toHaveLength(2);
    expect(all).toEqual(expect.arrayContaining([first, second]));
  });

  it('restores a database from backup', () => {
    const { db, path: dbPath } = createTempDb();
    db.exec('CREATE TABLE t (x TEXT)');
    db.exec("INSERT INTO t VALUES ('original')");

    // Flush WAL and create backup
    const backupPath = createDbBackup(dbPath, db);
    db.close();

    // Corrupt the database
    const corruptedDb = openSqliteDatabase(dbPath);
    corruptedDb.exec('DROP TABLE t');
    corruptedDb.exec('CREATE TABLE t (x TEXT)');
    corruptedDb.exec("INSERT INTO t VALUES ('corrupted')");
    corruptedDb.close();

    // Restore from backup
    restoreDbBackup(dbPath, backupPath);

    const restoredDb = openSqliteDatabase(dbPath);
    const row = restoredDb.prepare('SELECT x FROM t').get() as { x: string };
    expect(row.x).toBe('original');
    restoredDb.close();
  });
});

describe('migrateWithBackup', () => {
  it('creates backup before applying pending migrations', () => {
    const { db, path: dbPath } = createTempDb();

    // Create initial schema and set version to 1
    db.exec('CREATE TABLE t (x TEXT)');
    db.exec("INSERT INTO t VALUES ('pre-migration')");
    setSchemaVersion(db, 1);

    const migrations: Migration[] = [
      {
        version: 2,
        description: 'Add column',
        up: (d) => d.exec('ALTER TABLE t ADD COLUMN y TEXT'),
      },
    ];

    const result = migrateWithBackup(db, dbPath, 'test', migrations);
    expect(result.applied).toBe(1);
    expect(result.backupPath).toBeDefined();

    // Backup should exist on disk
    expect(result.backupPath && require('fs').existsSync(result.backupPath)).toBe(true);

    // Migration applied
    const cols = readTableColumnNames(db, 't');
    expect(cols.has('y')).toBe(true);
  });

  it('does not create backup when no migrations are pending', () => {
    const { db, path: dbPath } = createTempDb();
    db.exec('CREATE TABLE t (x TEXT)');
    setSchemaVersion(db, 1);

    const migrations: Migration[] = [{ version: 1, description: 'v1', up: () => {} }];

    const result = migrateWithBackup(db, dbPath, 'test', migrations);
    expect(result.applied).toBe(0);
    expect(result.backupPath).toBeUndefined();
  });

  it('throws with backup path on migration failure', () => {
    const { db, path: dbPath } = createTempDb();
    db.exec('CREATE TABLE t (x TEXT)');
    db.exec("INSERT INTO t VALUES ('data')");
    setSchemaVersion(db, 1);

    const migrations: Migration[] = [
      {
        version: 2,
        description: 'Broken migration',
        up: () => {
          throw new Error('simulated failure');
        },
      },
    ];

    expect(() => migrateWithBackup(db, dbPath, 'test', migrations)).toThrow(/backup/);

    // Original data should still be intact
    const row = db.prepare('SELECT x FROM t').get() as { x: string };
    expect(row.x).toBe('data');
  });
});
