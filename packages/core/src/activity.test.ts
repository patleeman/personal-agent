import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  closeActivityDbs,
  listProfileActivityEntries,
  loadProfileActivityReadState,
  resolveActivityEntryPath,
  resolveActivityReadStatePath,
  resolveProfileActivityDbPath,
  resolveProfileActivityDir,
  resolveProfileActivityStateDir,
  saveProfileActivityReadState,
  validateActivityId,
  writeProfileActivityEntry,
} from './activity.js';
import { createProjectActivityEntry, writeProjectActivityEntry } from './project-artifacts.js';
import { openSqliteDatabase } from './sqlite.js';

const tempDirs: string[] = [];

afterEach(async () => {
  closeActivityDbs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempStateRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-activity-'));
  tempDirs.push(dir);
  return dir;
}

describe('activity paths', () => {
  it('resolves the profile-scoped activity state directory', () => {
    const stateRoot = createTempStateRoot();
    expect(resolveProfileActivityStateDir({ stateRoot, profile: 'datadog' })).toBe(
      join(stateRoot, 'pi-agent', 'state', 'activity', 'datadog'),
    );
  });

  it('resolves the profile-scoped activity directory', () => {
    const stateRoot = createTempStateRoot();
    expect(resolveProfileActivityDir({ stateRoot, profile: 'datadog' })).toBe(
      join(stateRoot, 'pi-agent', 'state', 'activity', 'datadog', 'activities'),
    );
  });

  it('resolves a profile activity entry path', () => {
    const stateRoot = createTempStateRoot();
    expect(resolveActivityEntryPath({ stateRoot, profile: 'datadog', activityId: 'daily-report' })).toBe(
      join(stateRoot, 'pi-agent', 'state', 'activity', 'datadog', 'activities', 'daily-report.md'),
    );
  });

  it('rejects invalid activity ids', () => {
    expect(() => validateActivityId('bad/id')).toThrow('Invalid activity id');
  });
});

describe('activity read state', () => {
  it('resolves the activity read-state path', () => {
    const stateRoot = createTempStateRoot();
    expect(resolveActivityReadStatePath({ stateRoot, profile: 'datadog' })).toBe(
      join(stateRoot, 'pi-agent', 'state', 'activity', 'datadog', 'read-state.json'),
    );
  });

  it('loads an empty read state when the file is missing', () => {
    const stateRoot = createTempStateRoot();
    expect(loadProfileActivityReadState({ stateRoot, profile: 'datadog' })).toEqual(new Set());
  });

  it('saves and reloads normalized read ids in sqlite', () => {
    const stateRoot = createTempStateRoot();
    const path = saveProfileActivityReadState({
      stateRoot,
      profile: 'datadog',
      ids: [' newer ', '', 'older', 'newer', 'bad/id'],
    });

    expect(path).toBe(resolveProfileActivityDbPath({ stateRoot, profile: 'datadog' }));
    expect(existsSync(path)).toBe(true);
    expect(loadProfileActivityReadState({ stateRoot, profile: 'datadog' })).toEqual(new Set(['newer', 'older']));
  });
});

describe('activity storage', () => {
  it('writes and lists activity entries newest-first', () => {
    const stateRoot = createTempStateRoot();

    const olderPath = writeProfileActivityEntry({
      stateRoot,
      profile: 'datadog',
      entry: createProjectActivityEntry({
        id: 'older',
        createdAt: '2026-03-10T10:00:00.000Z',
        profile: 'datadog',
        kind: 'scheduled-task',
        summary: 'Older activity.',
      }),
    });

    const newerPath = writeProfileActivityEntry({
      stateRoot,
      profile: 'datadog',
      entry: createProjectActivityEntry({
        id: 'newer',
        createdAt: '2026-03-10T12:00:00.000Z',
        profile: 'datadog',
        kind: 'follow-up',
        summary: 'Newer activity.',
      }),
    });

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });

    expect(entries.map((entry) => entry.entry.id)).toEqual(['newer', 'older']);
    expect(entries[0]?.path).toBe(newerPath);
    expect(entries[1]?.path).toBe(olderPath);
    expect(newerPath).toBe(`${resolveProfileActivityDbPath({ stateRoot, profile: 'datadog' })}#activity/newer`);
    expect(olderPath).toBe(`${resolveProfileActivityDbPath({ stateRoot, profile: 'datadog' })}#activity/older`);
  });

  it('migrates legacy inbox markdown entries and read-state into sqlite storage', () => {
    const stateRoot = createTempStateRoot();
    const legacyActivityDir = join(stateRoot, 'pi-agent', 'state', 'inbox', 'datadog', 'activities');
    const legacyEntryPath = join(legacyActivityDir, 'legacy-item.md');
    const legacyReadStatePath = join(stateRoot, 'pi-agent', 'state', 'inbox', 'datadog', 'read-state.json');
    mkdirSync(legacyActivityDir, { recursive: true });
    writeProjectActivityEntry(
      legacyEntryPath,
      createProjectActivityEntry({
        id: 'legacy-item',
        createdAt: '2026-03-10T08:00:00.000Z',
        profile: 'datadog',
        kind: 'note',
        summary: 'Migrated from markdown.',
      }),
    );
    writeFileSync(legacyReadStatePath, JSON.stringify(['legacy-item']));

    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' }).map((entry) => entry.entry.id)).toEqual(['legacy-item']);
    expect(loadProfileActivityReadState({ stateRoot, profile: 'datadog' })).toEqual(new Set(['legacy-item']));
    expect(existsSync(legacyEntryPath)).toBe(false);
    expect(existsSync(legacyReadStatePath)).toBe(false);
    expect(existsSync(resolveProfileActivityDbPath({ stateRoot, profile: 'datadog' }))).toBe(true);
  });

  it('migrates legacy inbox sqlite activity into the new activity storage path', () => {
    const stateRoot = createTempStateRoot();
    const legacyStateDir = join(stateRoot, 'pi-agent', 'state', 'inbox', 'datadog');
    mkdirSync(legacyStateDir, { recursive: true });
    const legacyDbPath = join(legacyStateDir, 'runtime.db');
    const legacyDb = openSqliteDatabase(legacyDbPath);
    legacyDb.exec(`
      CREATE TABLE IF NOT EXISTS activity_entries (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        entry_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS activity_read_state (
        activity_id TEXT PRIMARY KEY
      );
    `);
    const legacyEntry = createProjectActivityEntry({
      id: 'legacy-sqlite-item',
      createdAt: '2026-03-10T09:00:00.000Z',
      profile: 'datadog',
      kind: 'note',
      summary: 'Migrated from legacy sqlite.',
    });
    legacyDb
      .prepare('INSERT INTO activity_entries (id, created_at, entry_json) VALUES (?, ?, ?)')
      .run(legacyEntry.id, legacyEntry.createdAt, JSON.stringify(legacyEntry));
    legacyDb.prepare('INSERT INTO activity_read_state (activity_id) VALUES (?)').run(legacyEntry.id);
    legacyDb.close();

    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' }).map((entry) => entry.entry.id)).toEqual(['legacy-sqlite-item']);
    expect(loadProfileActivityReadState({ stateRoot, profile: 'datadog' })).toEqual(new Set(['legacy-sqlite-item']));
    expect(existsSync(legacyDbPath)).toBe(false);
    expect(existsSync(resolveProfileActivityDbPath({ stateRoot, profile: 'datadog' }))).toBe(true);
  });

  it('ignores malformed legacy activity entries', () => {
    const stateRoot = createTempStateRoot();

    writeProfileActivityEntry({
      stateRoot,
      profile: 'datadog',
      entry: createProjectActivityEntry({
        id: 'valid',
        createdAt: '2026-03-10T12:00:00.000Z',
        profile: 'datadog',
        kind: 'follow-up',
        summary: 'Valid activity.',
      }),
    });

    const legacyActivityDir = join(stateRoot, 'pi-agent', 'state', 'inbox', 'datadog', 'activities');
    mkdirSync(legacyActivityDir, { recursive: true });
    writeFileSync(join(legacyActivityDir, 'broken.md'), '');

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });

    expect(entries.map((entry) => entry.entry.id)).toEqual(['valid']);
  });

  it('returns an empty list when there is no activity dir', () => {
    const stateRoot = createTempStateRoot();
    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' })).toEqual([]);
  });
});
