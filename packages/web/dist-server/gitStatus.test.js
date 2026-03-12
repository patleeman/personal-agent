import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { countGitStatusEntries, parseGitNumstat, readGitStatusSummary } from './gitStatus.js';
const tempDirs = [];
function createTempDir(prefix) {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
}
function runGit(args, cwd) {
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
        expect(parseGitNumstat([
            '2\t1\ttracked.txt',
            '-\t-\tbinary.dat',
            '5\t0\tnested/file.ts',
        ].join('\n'))).toEqual({
            linesAdded: 7,
            linesDeleted: 1,
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
        expect(readGitStatusSummary(dir)).toBeNull();
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
        });
        expect(summary?.branch).toEqual(expect.any(String));
    });
});
