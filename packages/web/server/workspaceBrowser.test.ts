import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  commitWorkspaceGitChanges,
  readWorkspaceFile,
  readWorkspaceGitDiff,
  readWorkspaceGitStatus,
  readWorkspaceSnapshot,
  stageWorkspaceGitPath,
  unstageWorkspaceGitPath,
  writeWorkspaceFile,
} from './workspaceBrowser.js';

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

type TestTreeNode = {
  kind: 'directory' | 'file';
  children?: TestTreeNode[];
};

function countTreeFiles(nodes: TestTreeNode[]): number {
  return nodes.reduce((count, node) => count + (node.kind === 'file'
    ? 1
    : countTreeFiles(node.children ?? [])), 0);
}

describe('readWorkspaceSnapshot', () => {
  it('roots repo workspaces at the git root and includes changed files', () => {
    const dir = createTempDir('pa-web-workspace-');
    runGit(['init'], dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'keep.ts'), 'export const answer = 41;\n');
    writeFileSync(join(dir, 'notes.md'), '# Notes\n');
    runGit(['add', '.'], dir);
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], dir);

    writeFileSync(join(dir, 'src', 'keep.ts'), 'export const answer = 42;\n');
    unlinkSync(join(dir, 'notes.md'));
    writeFileSync(join(dir, 'draft.md'), 'draft\n');

    const snapshot = readWorkspaceSnapshot(join(dir, 'src'));

    expect(snapshot.root).toBe(realpathSync(dir));
    expect(snapshot.repoRoot).toBe(realpathSync(dir));
    expect(snapshot.focusPath).toBe('src');
    expect(snapshot.changedCount).toBe(3);
    expect(snapshot.fileCount).toBe(3);
    expect(snapshot.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'src/keep.ts', change: 'modified', exists: true }),
      expect.objectContaining({ relativePath: 'notes.md', change: 'deleted', exists: false }),
      expect.objectContaining({ relativePath: 'draft.md', change: 'untracked', exists: true }),
    ]));
    expect(snapshot.tree).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'draft.md', kind: 'file' }),
      expect.objectContaining({ relativePath: 'notes.md', kind: 'file', exists: false, change: 'deleted' }),
      expect.objectContaining({
        relativePath: 'src',
        kind: 'directory',
        children: expect.arrayContaining([
          expect.objectContaining({ relativePath: 'src/keep.ts', change: 'modified' }),
        ]),
      }),
    ]));
  });

  it('truncates large git-backed trees to keep workspace snapshots loadable', () => {
    const dir = createTempDir('pa-web-workspace-large-');
    runGit(['init'], dir);

    mkdirSync(join(dir, 'src'), { recursive: true });
    for (let index = 0; index < 3_005; index += 1) {
      writeFileSync(join(dir, 'src', `file-${String(index).padStart(4, '0')}.ts`), `export const value${index} = ${index};\n`);
    }
    runGit(['add', '.'], dir);
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], dir);

    const snapshot = readWorkspaceSnapshot(dir);

    expect(snapshot.fileCount).toBe(3_005);
    expect(snapshot.truncated).toBe(true);
    expect(countTreeFiles(snapshot.tree)).toBe(3_000);
  });
});

describe('readWorkspaceFile', () => {
  it('returns file content and a git diff for tracked changes', () => {
    const dir = createTempDir('pa-web-workspace-file-');
    runGit(['init'], dir);

    writeFileSync(join(dir, 'tracked.ts'), 'export const value = 1;\n');
    runGit(['add', '.'], dir);
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], dir);

    writeFileSync(join(dir, 'tracked.ts'), 'export const value = 2;\n');

    const detail = readWorkspaceFile({ cwd: dir, path: 'tracked.ts' });

    expect(detail.exists).toBe(true);
    expect(detail.change).toBe('modified');
    expect(detail.originalContent).toContain('value = 1');
    expect(detail.content).toContain('value = 2');
    expect(detail.diff).toContain('-export const value = 1;');
    expect(detail.diff).toContain('+export const value = 2;');
  });

  it('uses an empty original snapshot for untracked files', () => {
    const dir = createTempDir('pa-web-workspace-untracked-');
    runGit(['init'], dir);
    writeFileSync(join(dir, 'draft.md'), 'draft\n');

    const detail = readWorkspaceFile({ cwd: dir, path: 'draft.md' });

    expect(detail.change).toBe('untracked');
    expect(detail.originalContent).toBe('');
    expect(detail.diff).toContain('+draft');
  });

  it('rejects file paths outside the workspace root', () => {
    const dir = createTempDir('pa-web-workspace-escape-');
    writeFileSync(join(dir, 'local.txt'), 'ok\n');

    expect(() => readWorkspaceFile({ cwd: dir, path: '../outside.txt' })).toThrow('outside the workspace root');
  });
});

describe('readWorkspaceGitStatus', () => {
  it('separates staged, unstaged, and untracked changes for the same repo', () => {
    const dir = createTempDir('pa-web-workspace-git-status-');
    runGit(['init'], dir);

    writeFileSync(join(dir, 'tracked.ts'), 'export const value = 1;\n');
    writeFileSync(join(dir, 'notes.md'), '# Notes\n');
    runGit(['add', '.'], dir);
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], dir);

    writeFileSync(join(dir, 'tracked.ts'), 'export const value = 2;\n');
    runGit(['add', 'tracked.ts'], dir);
    writeFileSync(join(dir, 'tracked.ts'), 'export const value = 3;\n');
    writeFileSync(join(dir, 'draft.ts'), 'export const draft = true;\n');

    const summary = readWorkspaceGitStatus(dir);

    expect(summary).toMatchObject({
      stagedCount: 1,
      unstagedCount: 1,
      untrackedCount: 1,
      conflictedCount: 0,
    });
    expect(summary.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'tracked.ts', stagedChange: 'modified', unstagedChange: 'modified' }),
      expect.objectContaining({ relativePath: 'draft.ts', stagedChange: null, unstagedChange: 'untracked' }),
    ]));
  });
});

describe('workspace git mutations', () => {
  it('stages, unstages, diffs, and commits changes', () => {
    const dir = createTempDir('pa-web-workspace-git-mutations-');
    runGit(['init'], dir);

    writeFileSync(join(dir, 'tracked.ts'), 'export const value = 1;\n');
    runGit(['add', '.'], dir);
    runGit(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', 'commit', '-m', 'init'], dir);

    writeFileSync(join(dir, 'tracked.ts'), 'export const value = 2;\n');

    let summary = stageWorkspaceGitPath({ cwd: dir, path: 'tracked.ts' });
    expect(summary.stagedCount).toBe(1);
    expect(summary.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'tracked.ts', stagedChange: 'modified', unstagedChange: null }),
    ]));

    const stagedDiff = readWorkspaceGitDiff({ cwd: dir, path: 'tracked.ts', scope: 'staged' });
    expect(stagedDiff.diff).toContain('+export const value = 2;');

    summary = unstageWorkspaceGitPath({ cwd: dir, path: 'tracked.ts' });
    expect(summary.unstagedCount).toBe(1);
    expect(summary.stagedCount).toBe(0);

    stageWorkspaceGitPath({ cwd: dir, path: 'tracked.ts' });
    const commit = commitWorkspaceGitChanges({ cwd: dir, message: 'Update tracked value' });
    expect(commit.subject).toBe('Update tracked value');
    expect(runGit(['log', '--format=%s', '-1'], dir).trim()).toBe('Update tracked value');
    expect(readWorkspaceGitStatus(dir).stagedCount).toBe(0);
  });
});

describe('writeWorkspaceFile', () => {
  it('writes content back to disk and returns the updated detail', () => {
    const dir = createTempDir('pa-web-workspace-save-');
    writeFileSync(join(dir, 'note.md'), '# Before\n');

    const detail = writeWorkspaceFile({ cwd: dir, path: 'note.md', content: '# After\n' });

    expect(detail.content).toBe('# After\n');
    expect(readFileSync(join(dir, 'note.md'), 'utf-8')).toBe('# After\n');
  });
});
