import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listProfileActivityEntries,
  loadProfileActivityReadState,
  resolveActivityEntryPath,
  resolveActivityReadStatePath,
  resolveProfileActivityDir,
  resolveProfileActivityStateDir,
  saveProfileActivityReadState,
  validateActivityId,
  writeProfileActivityEntry,
} from './activity.js';
import { createProjectActivityEntry } from './project-artifacts.js';

const tempDirs: string[] = [];

afterEach(async () => {
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

  it('saves and reloads normalized read ids', () => {
    const stateRoot = createTempStateRoot();
    const path = saveProfileActivityReadState({
      stateRoot,
      profile: 'datadog',
      ids: [' newer ', '', 'older', 'newer'],
    });

    expect(path).toBe(join(stateRoot, 'pi-agent', 'state', 'inbox', 'datadog', 'read-state.json'));
    expect(readFileSync(path, 'utf-8')).toBe('["newer","older"]');
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
  });

  it('ignores malformed activity entries', () => {
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

    writeFileSync(resolveActivityEntryPath({ stateRoot, profile: 'datadog', activityId: 'broken' }), '');

    const entries = listProfileActivityEntries({ stateRoot, profile: 'datadog' });

    expect(entries.map((entry) => entry.entry.id)).toEqual(['valid']);
  });

  it('returns an empty list when there is no activity dir', () => {
    const stateRoot = createTempStateRoot();
    expect(listProfileActivityEntries({ stateRoot, profile: 'datadog' })).toEqual([]);
  });
});
