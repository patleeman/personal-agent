import { afterEach, describe, expect, it, vi } from 'vitest';

describe('openSqliteDatabase', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('node:module');
  });

  async function importWithRequire(fakeRequire: (id: string) => unknown) {
    vi.resetModules();
    vi.doMock('node:module', () => ({
      createRequire: () => fakeRequire,
    }));

    return import('./sqlite.js');
  }

  it('delegates pragma and transaction when the raw driver exposes them', async () => {
    const exec = vi.fn();
    const prepare = vi.fn(() => ({ run: vi.fn(), get: vi.fn(), all: vi.fn() }));
    const close = vi.fn();
    const pragma = vi.fn();
    const transaction = vi.fn((fn: (...args: unknown[]) => void) => (...args: unknown[]) => fn(...args));
    const seenPaths: string[] = [];
    const values: string[] = [];

    class FakeDatabase {
      constructor(path: string) {
        seenPaths.push(path);
      }
      exec = exec;
      prepare = prepare;
      close = close;
      pragma = pragma;
      transaction = transaction;
    }

    const { openSqliteDatabase } = await importWithRequire((id: string) => {
      if (id === 'node:sqlite') {
        return { DatabaseSync: FakeDatabase };
      }
      throw new Error(`Unexpected require: ${id}`);
    });

    const db = openSqliteDatabase('/tmp/test.db');
    db.exec('SELECT 1');
    db.prepare('SELECT 2');
    db.pragma('journal_mode = WAL');
    db.transaction((value: string) => {
      values.push(value);
    })('ok');
    db.close();

    expect(seenPaths).toEqual(['/tmp/test.db']);
    expect(exec).toHaveBeenCalledWith('SELECT 1');
    expect(prepare).toHaveBeenCalledWith('SELECT 2');
    expect(pragma).toHaveBeenCalledWith('journal_mode = WAL');
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(values).toEqual(['ok']);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('falls back to better-sqlite3 helpers when node:sqlite is unavailable', async () => {
    const calls: string[] = [];

    class FakeDatabase {
      constructor(_path: string) {}
      exec(sql: string) {
        calls.push(sql);
      }
      prepare() {
        return { run: vi.fn(), get: vi.fn(), all: vi.fn() };
      }
      close() {
        calls.push('close');
      }
    }

    const { openSqliteDatabase } = await importWithRequire((id: string) => {
      if (id === 'node:sqlite') {
        throw new Error('missing');
      }
      if (id === 'better-sqlite3') {
        return FakeDatabase;
      }
      throw new Error(`Unexpected require: ${id}`);
    });

    const db = openSqliteDatabase('/tmp/fallback.db');
    db.pragma('foreign_keys = ON');
    db.transaction((value: string) => {
      calls.push(`body:${value}`);
    })('ok');
    db.close();

    expect(calls).toEqual([
      'PRAGMA foreign_keys = ON',
      'BEGIN',
      'body:ok',
      'COMMIT',
      'close',
    ]);
  });

  it('rolls back and rethrows when the emulated transaction body fails', async () => {
    const calls: string[] = [];

    class FakeDatabase {
      constructor(_path: string) {}
      exec(sql: string) {
        calls.push(sql);
      }
      prepare() {
        return { run: vi.fn(), get: vi.fn(), all: vi.fn() };
      }
      close() {}
    }

    const { openSqliteDatabase } = await importWithRequire((id: string) => {
      if (id === 'node:sqlite') {
        return { DatabaseSync: undefined };
      }
      if (id === 'better-sqlite3') {
        return FakeDatabase;
      }
      throw new Error(`Unexpected require: ${id}`);
    });

    const db = openSqliteDatabase('/tmp/fallback.db');
    const tx = db.transaction(() => {
      throw new Error('boom');
    });

    expect(() => tx()).toThrow('boom');
    expect(calls).toEqual(['BEGIN', 'ROLLBACK']);
  });
});
