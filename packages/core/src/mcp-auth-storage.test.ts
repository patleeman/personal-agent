import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';


const DIRS: string[] = [];
const origAuth = process.env.PERSONAL_AGENT_MCP_AUTH_DIR;

beforeEach(() => {
  const tmp = mkdtempSync(join(tmpdir(), 'mcp-auth-test-'));
  DIRS.push(tmp);
  process.env.PERSONAL_AGENT_MCP_AUTH_DIR = tmp;
});

afterEach(() => {
  for (const dir of DIRS.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (origAuth) {
    process.env.PERSONAL_AGENT_MCP_AUTH_DIR = origAuth;
  } else {
    delete process.env.PERSONAL_AGENT_MCP_AUTH_DIR;
  }
});

import {
  checkLockfile,
  createLockfile,
  deleteConfigFile,
  deleteLockfile,
  readJsonFile,
  readTextFile,
  writeJsonFile,
  writeTextFile,
} from './mcp-auth-storage.js';

const SCHEMA = {
  parseAsync: async (v: unknown) => v as Record<string, unknown>,
};

describe('mcp-auth-storage', () => {
  describe('json file round-trip', () => {
    it('writes and reads a JSON file', async () => {
      const data = { key: 'value', num: 42 };
      await writeJsonFile('hash1', 'test.json', data);
      const result = await readJsonFile('hash1', 'test.json', SCHEMA);
      expect(result).toEqual(data);
    });

    it('returns undefined for missing file', async () => {
      const result = await readJsonFile('nonexistent', 'missing.json', SCHEMA);
      expect(result).toBeUndefined();
    });

    it('overwrites existing file', async () => {
      await writeJsonFile('hash2', 'test.json', { first: 'value' });
      await writeJsonFile('hash2', 'test.json', { second: 'updated' });
      const result = await readJsonFile('hash2', 'test.json', SCHEMA);
      expect(result).toEqual({ second: 'updated' });
    });
  });

  describe('text file round-trip', () => {
    it('writes and reads a text file', async () => {
      await writeTextFile('hash3', 'note.txt', 'hello world');
      const result = await readTextFile('hash3', 'note.txt');
      expect(result).toBe('hello world');
    });

    it('returns undefined for missing text file', async () => {
      const result = await readTextFile('hash3', 'nonexistent.txt');
      expect(result).toBeUndefined();
    });
  });

  describe('delete', () => {
    it('deletes an existing file', async () => {
      await writeTextFile('hash4', 'temp.txt', 'delete me');
      await deleteConfigFile('hash4', 'temp.txt');
      const result = await readTextFile('hash4', 'temp.txt');
      expect(result).toBeUndefined();
    });

    it('does not throw when deleting a missing file', async () => {
      await expect(deleteConfigFile('hash5', 'never-existed.json')).resolves.toBeUndefined();
    });
  });

  describe('lockfile', () => {
    it('creates and checks a lockfile', async () => {
      const port = 8888;
      await createLockfile('hash6', process.pid, port);
      const lock = await checkLockfile('hash6');
      expect(lock).not.toBeNull();
      expect(lock!.pid).toBe(process.pid);
      expect(lock!.port).toBe(port);
      expect(typeof lock!.timestamp).toBe('number');
    });

    it('returns null for missing lockfile', async () => {
      const lock = await checkLockfile('nonexistent');
      expect(lock).toBeNull();
    });

    it('deletes a lockfile', async () => {
      await createLockfile('hash7', process.pid, 9999);
      await deleteLockfile('hash7');
      const lock = await checkLockfile('hash7');
      expect(lock).toBeNull();
    });
  });

  describe('isolation', () => {
    it('isolates files per serverUrlHash', async () => {
      await writeTextFile('hash-a', 'data.txt', 'content-a');
      await writeTextFile('hash-b', 'data.txt', 'content-b');

      expect(await readTextFile('hash-a', 'data.txt')).toBe('content-a');
      expect(await readTextFile('hash-b', 'data.txt')).toBe('content-b');
    });
  });
});
