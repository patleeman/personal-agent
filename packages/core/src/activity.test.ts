import { mkdtempSync } from 'fs';
import { rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listProfileActivityEntries,
  resolveActivityEntryPath,
  resolveProfileActivityDir,
  validateActivityId,
  writeProfileActivityEntry,
} from './activity.js';
import { createWorkstreamActivityEntry } from './workstream-artifacts.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'personal-agent-activity-'));
  tempDirs.push(dir);
  return dir;
}

describe('activity paths', () => {
  it('resolves the profile-scoped activity directory', () => {
    const repo = createTempRepo();
    expect(resolveProfileActivityDir({ repoRoot: repo, profile: 'datadog' }))
      .toBe(join(repo, 'profiles', 'datadog', 'agent', 'activity'));
  });

  it('resolves a profile activity entry path', () => {
    const repo = createTempRepo();
    expect(resolveActivityEntryPath({ repoRoot: repo, profile: 'datadog', activityId: 'daily-report' }))
      .toBe(join(repo, 'profiles', 'datadog', 'agent', 'activity', 'daily-report.md'));
  });

  it('rejects invalid activity ids', () => {
    expect(() => validateActivityId('bad/id')).toThrow('Invalid activity id');
  });
});

describe('activity storage', () => {
  it('writes and lists activity entries newest-first', () => {
    const repo = createTempRepo();

    const olderPath = writeProfileActivityEntry({
      repoRoot: repo,
      profile: 'datadog',
      entry: createWorkstreamActivityEntry({
        id: 'older',
        createdAt: '2026-03-10T10:00:00.000Z',
        profile: 'datadog',
        kind: 'scheduled-task',
        summary: 'Older activity.',
      }),
    });

    const newerPath = writeProfileActivityEntry({
      repoRoot: repo,
      profile: 'datadog',
      entry: createWorkstreamActivityEntry({
        id: 'newer',
        createdAt: '2026-03-10T12:00:00.000Z',
        profile: 'datadog',
        kind: 'follow-up',
        summary: 'Newer activity.',
      }),
    });

    const entries = listProfileActivityEntries({ repoRoot: repo, profile: 'datadog' });

    expect(entries.map((entry) => entry.entry.id)).toEqual(['newer', 'older']);
    expect(entries[0]?.path).toBe(newerPath);
    expect(entries[1]?.path).toBe(olderPath);
  });

  it('returns an empty list when there is no activity dir', () => {
    const repo = createTempRepo();
    expect(listProfileActivityEntries({ repoRoot: repo, profile: 'datadog' })).toEqual([]);
  });
});
