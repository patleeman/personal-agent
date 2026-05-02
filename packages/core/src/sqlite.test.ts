import { afterEach, describe, expect, it, vi } from 'vitest';

describe('openSqliteDatabase', () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('node:module');
    delete process.env.PERSONAL_AGENT_DESKTOP_NATIVE_MODULES_DIR;
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
    const transaction = vi.fn(
      (fn: (...args: unknown[]) => void) =>
        (...args: unknown[]) =>
          fn(...args),
    );
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

    expect(calls).toEqual(['PRAGMA foreign_keys = ON', 'BEGIN', 'body:ok', 'COMMIT', 'close']);
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

  it('loads better-sqlite3 from the desktop native modules dir when provided', async () => {
    const rootRequire = vi.fn((id: string) => {
      if (id === 'node:sqlite') {
        throw new Error('missing');
      }

      throw new Error(`Unexpected root require: ${id}`);
    });

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

    const externalRequire = vi.fn((id: string) => {
      if (id === 'better-sqlite3') {
        return FakeDatabase;
      }

      throw new Error(`Unexpected external require: ${id}`);
    });

    const createRequireMock = vi.fn((value: string) => {
      if (value === '/tmp/electron-native/package.json') {
        return externalRequire;
      }

      return rootRequire;
    });

    vi.resetModules();
    process.env.PERSONAL_AGENT_DESKTOP_NATIVE_MODULES_DIR = '/tmp/electron-native';
    vi.doMock('node:module', () => ({
      createRequire: createRequireMock,
    }));

    const { openSqliteDatabase } = await import('./sqlite.js');
    const db = openSqliteDatabase('/tmp/external.db');
    db.pragma('journal_mode = WAL');
    db.close();

    expect(externalRequire).toHaveBeenCalledWith('better-sqlite3');
    expect(calls).toEqual(['PRAGMA journal_mode = WAL', 'close']);
  });

  it('does not fall back to the repo better-sqlite3 when the desktop native module fails to load', async () => {
    const rootRequire = vi.fn((id: string) => {
      if (id === 'node:sqlite') {
        throw new Error('missing');
      }

      throw new Error(`Unexpected root require: ${id}`);
    });
    const externalRequire = vi.fn(() => {
      throw new Error('ABI mismatch');
    });
    const createRequireMock = vi.fn((value: string) => {
      if (value === '/tmp/electron-native/package.json') {
        return externalRequire;
      }

      return rootRequire;
    });

    vi.resetModules();
    process.env.PERSONAL_AGENT_DESKTOP_NATIVE_MODULES_DIR = '/tmp/electron-native';
    vi.doMock('node:module', () => ({
      createRequire: createRequireMock,
    }));

    const { openSqliteDatabase } = await import('./sqlite.js');

    expect(() => openSqliteDatabase('/tmp/external.db')).toThrow(
      'Could not load Electron-native better-sqlite3 from /tmp/electron-native: ABI mismatch',
    );
    expect(externalRequire).toHaveBeenCalledWith('better-sqlite3');
    expect(rootRequire).not.toHaveBeenCalledWith('better-sqlite3');
  });
});
