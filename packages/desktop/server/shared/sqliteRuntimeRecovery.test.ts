import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { openRecoveringRuntimeSqliteDb } from './sqliteRuntimeRecovery.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('runtime sqlite recovery', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('quarantines an unrecoverable runtime database and recreates a healthy one', async () => {
    const dir = createTempDir('pa-runtime-sqlite-recovery-');
    const dbPath = join(dir, 'runtime.db');
    writeFileSync(dbPath, 'not sqlite', 'utf-8');

    const db = openRecoveringRuntimeSqliteDb(dbPath);
    try {
      expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{ integrity_check: 'ok' }]);
    } finally {
      db.close();
    }

    expect(existsSync(dbPath)).toBe(true);
    const quarantined = await readdir(join(dir, '.corrupt'));
    expect(quarantined.some((name) => name.includes('runtime.db') && name.endsWith('.db'))).toBe(true);
  });
});
