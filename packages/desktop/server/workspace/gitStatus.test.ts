import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  countGitStatusEntries,
  parseGitNumstat,
  readGitRepoInfo,
  readGitStatusSummary,
  readGitStatusSummaryWithTelemetry,
} from './gitStatus.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function runGit(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('parseGitNumstat', () => {
  it('sums added and deleted lines and ignores binary markers', () => {
    expect(parseGitNumstat(['2\t1\ttracked.txt', '-\t-\tbinary.dat', '5\t0\tnested/file.ts'].join('\n'))).toEqual({
      linesAdded: 7,
      linesDeleted: 1,
    });
  });

  it('ignores malformed and unsafe numstat counts', () => {
    expect(
      parseGitNumstat(['2abc\t1\tpartial.txt', `${Number.MAX_SAFE_INTEGER + 1}\t3\tunsafe.txt`, '4\t5\tvalid.txt'].join('\n')),
    ).toEqual({
      linesAdded: 4,
      linesDeleted: 9,
    });
  });
});

describe('countGitStatusEntries', () => {
  it('counts non-empty porcelain lines', () => {
    expect(countGitStatusEntries(' M tracked.txt\nMM staged-and-unstaged.ts\n?? new-file.txt\n')).toBe(3);
  });
});

describe('readGitStatusSummary', () => {
  it('returns null outside a git repository', () => {
    const dir = createTempDir('pa-web-git-outside-');
    expect(readGitRepoInfo(dir)).toBeNull();
    expect(readGitStatusSummary(dir)).toBeNull();
  });

  it('reads the containing git repo root and basename', () => {
    const dir = createTempDir('pa-web-git-repo-info-');
    runGit(['init'], dir);

    const nestedRoot = join(dir, 'nested');
    const nested = join(nestedRoot, 'deeper');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(dir, 'tracked.txt'), 'one\n');
    runGit(['add', '.'], dir);
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], dir);
    writeFileSync(join(nestedRoot, '.keep'), '');
    runGit(['add', '.'], dir);
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'nested'], dir);

    expect(readGitRepoInfo(nested)).toEqual(
      expect.objectContaining({
        root: expect.stringContaining(`/pa-web-git-repo-info-`),
        name: expect.stringContaining('pa-web-git-repo-info-'),
      }),
    );
  });

  it('reports cache telemetry for repeated git status reads', () => {
    const dir = createTempDir('pa-web-git-repo-cache-');
    runGit(['init'], dir);

    writeFileSync(join(dir, 'tracked.txt'), 'one\n');
    runGit(['add', '.'], dir);
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], dir);

    writeFileSync(join(dir, 'tracked.txt'), 'one\ntwo\n');

    const firstRead = readGitStatusSummaryWithTelemetry(dir);
    expect(firstRead.summary).toMatchObject({
      changeCount: 1,
      linesAdded: 1,
      linesDeleted: 0,
      changes: [{ relativePath: 'tracked.txt', change: 'modified' }],
    });
    expect(firstRead.telemetry).toMatchObject({
      cache: 'miss',
      hasRepo: true,
    });
    expect(firstRead.telemetry.durationMs).toBeGreaterThanOrEqual(0);

    const secondRead = readGitStatusSummaryWithTelemetry(dir);
    expect(secondRead.summary).toEqual(firstRead.summary);
    expect(secondRead.telemetry).toMatchObject({
      cache: 'hit',
      hasRepo: true,
    });
    expect(secondRead.telemetry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('shares cached git status across different cwd values in the same repo', () => {
    const dir = createTempDir('pa-web-git-repo-shared-cache-');
    runGit(['init'], dir);

    const nested = join(dir, 'packages', 'web');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(dir, 'tracked.txt'), 'one\n');
    runGit(['add', '.'], dir);
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], dir);

    writeFileSync(join(dir, 'tracked.txt'), 'one\ntwo\n');

    const firstRead = readGitStatusSummaryWithTelemetry(dir);
    expect(firstRead.telemetry).toMatchObject({
      cache: 'miss',
      hasRepo: true,
    });

    const secondRead = readGitStatusSummaryWithTelemetry(nested);
    expect(secondRead.summary).toEqual(firstRead.summary);
    expect(secondRead.telemetry).toMatchObject({
      cache: 'hit',
      hasRepo: true,
    });
  });

  it('summarizes staged, unstaged, and untracked changes', () => {
    const dir = createTempDir('pa-web-git-repo-');
    runGit(['init'], dir);

    writeFileSync(join(dir, 'tracked.txt'), 'one\n');
    writeFileSync(join(dir, 'deleted.txt'), 'alpha\nbeta\n');
    runGit(['add', '.'], dir);
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], dir);

    writeFileSync(join(dir, 'tracked.txt'), 'one\ntwo\n');
    runGit(['add', 'tracked.txt'], dir);
    writeFileSync(join(dir, 'tracked.txt'), 'one\ntwo\nthree\n');
    writeFileSync(join(dir, 'deleted.txt'), 'alpha\n');
    writeFileSync(join(dir, 'untracked.txt'), 'draft\nnotes\n');

    const summary = readGitStatusSummary(dir);

    expect(summary).not.toBeNull();
    expect(summary).toMatchObject({
      changeCount: 3,
      linesAdded: 4,
      linesDeleted: 1,
      changes: expect.arrayContaining([
        { relativePath: 'deleted.txt', change: 'modified' },
        { relativePath: 'tracked.txt', change: 'modified' },
        { relativePath: 'untracked.txt', change: 'untracked' },
      ]),
    });
    expect(summary?.branch).toEqual(expect.any(String));
  });
});
