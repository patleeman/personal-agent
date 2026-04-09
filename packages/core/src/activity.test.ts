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
    expect(resolveProfileActivityStateDir({ stateRoot, profile: 'datadog' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'inbox', 'datadog'));
  });

  it('resolves the profile-scoped activity directory', () => {
    const stateRoot = createTempStateRoot();
    expect(resolveProfileActivityDir({ stateRoot, profile: 'datadog' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'inbox', 'datadog', 'activities'));
  });

  it('resolves a profile activity entry path', () => {
    const stateRoot = createTempStateRoot();
    expect(resolveActivityEntryPath({ stateRoot, profile: 'datadog', activityId: 'daily-report' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'inbox', 'datadog', 'activities', 'daily-report.md'));
  });

  it('rejects invalid activity ids', () => {
    expect(() => validateActivityId('bad/id')).toThrow('Invalid activity id');
  });
});

describe('activity read state', () => {
  it('resolves the activity read-state path', () => {
    const stateRoot = createTempStateRoot();
    expect(resolveActivityReadStatePath({ stateRoot, profile: 'datadog' }))
      .toBe(join(stateRoot, 'pi-agent', 'state', 'inbox', 'datadog', 'read-state.json'));
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

  it('migrates legacy markdown entries and read-state into sqlite storage', () => {
    const stateRoot = createTempStateRoot();
    const legacyEntryPath = resolveActivityEntryPath({ stateRoot, profile: 'datadog', activityId: 'legacy-item' });
    mkdirSync(resolveProfileActivityDir({ stateRoot, profile: 'datadog' }), { recursive: true });
    writeProjectActivityEntry(legacyEntryPath, createProjectActivityEntry({
      id: 'legacy-item',
      createdAt: '2026-03-10T08:00:00.000Z',
      profile: 'datadog',
      kind: 'note',
      summary: 'Migrated from markdown.',
    }));
    writeFileSync(resolveActivityReadStatePath({ stateRoot, profile: 'datadog' }), JSON.stringify(['legacy-item']));

    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' }).map((entry) => entry.entry.id)).toEqual(['legacy-item']);
    expect(loadProfileActivityReadState({ stateRoot, profile: 'datadog' })).toEqual(new Set(['legacy-item']));
    expect(existsSync(legacyEntryPath)).toBe(false);
    expect(existsSync(resolveActivityReadStatePath({ stateRoot, profile: 'datadog' }))).toBe(false);
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

    mkdirSync(resolveProfileActivityDir({ stateRoot, profile: 'datadog' }), { recursive: true });
    writeFileSync(resolveActivityEntryPath({ stateRoot, profile: 'datadog', activityId: 'broken' }), '');

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });

    expect(entries.map((entry) => entry.entry.id)).toEqual(['valid']);
  });

  it('returns an empty list when there is no activity dir', () => {
    const stateRoot = createTempStateRoot();
    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' })).toEqual([]);
  });
});
