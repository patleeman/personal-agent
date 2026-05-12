import { mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { pruneStaleRecoveryFiles } from './sqliteDbLifecycle.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('pruneStaleRecoveryFiles', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('removes files older than 7 days', () => {
    const root = createTempDir('pa-prune-old-');
    const corruptDir = join(root, '.corrupt');
    mkdirSync(corruptDir, { recursive: true });

    // Create an old file (mtime set to 10 days ago)
    const oldFile = join(corruptDir, 'runtime.db.old.db');
    writeFileSync(oldFile, 'old');
    const tenDaysAgoSec = (Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000;
    utimesSync(oldFile, tenDaysAgoSec, tenDaysAgoSec);

    // Create a recent file
    const recentFile = join(corruptDir, 'runtime.db.recent.db');
    writeFileSync(recentFile, 'recent');

    pruneStaleRecoveryFiles(root);

    expect(readdirSync(corruptDir)).toEqual(['runtime.db.recent.db']);
  });

  it('keeps at most 10 files per directory', () => {
    const root = createTempDir('pa-prune-limit-');
    const backupsDir = join(root, '.backups');
    mkdirSync(backupsDir, { recursive: true });

    // Create 15 recent files with staggered mtimes
    for (let i = 0; i < 15; i++) {
      const file = join(backupsDir, `backup-${String(i).padStart(2, '0')}.db`);
      writeFileSync(file, `data-${i}`);
      const mtimeSec = (Date.now() - i * 1000) / 1000;
      utimesSync(file, mtimeSec, mtimeSec);
    }

    pruneStaleRecoveryFiles(root);

    const remaining = readdirSync(backupsDir);
    expect(remaining.length).toBe(10);
    // The 10 newest should be kept (00–09)
    expect(remaining.sort()).toEqual(Array.from({ length: 10 }, (_, i) => `backup-${String(i).padStart(2, '0')}.db`).sort());
  });

  it('does nothing when directories do not exist', () => {
    const root = createTempDir('pa-prune-empty-');
    // Should not throw
    pruneStaleRecoveryFiles(root);
  });
});
