import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  __workspaceExplorerInternals,
  createWorkspaceFolder,
  deleteWorkspacePath,
  listWorkspaceDirectory,
  moveWorkspacePath,
  readUncommittedDiffAsync,
  readWorkspaceDiffOverlay,
  readWorkspaceFile,
  renameWorkspacePath,
  writeWorkspaceFile,
} from './workspaceExplorer.js';

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function createRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-workspace-explorer-'));
  git(['init'], dir);
  git(['config', 'user.email', 'agent@example.com'], dir);
  git(['config', 'user.name', 'Agent'], dir);
  writeFileSync(join(dir, 'tracked.txt'), 'one\ntwo\nthree\n');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'app.ts'), 'const value = 1;\n');
  git(['add', '.'], dir);
  git(['commit', '-m', 'initial'], dir);
  return dir;
}

describe('workspace explorer', () => {
  it('lists from the git root and annotates git status badges', async () => {
    const repo = createRepo();
    const nested = join(repo, 'src');
    writeFileSync(join(repo, 'tracked.txt'), 'one\nTWO\nthree\n');
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const fresh = true;\n');

    const listing = await listWorkspaceDirectory(nested, '');

    expect(listing.root).toBe(realpathSync(repo));
    expect(listing.rootKind).toBe('git');
    expect(listing.activeCwdRelativePath).toBe('src');
    expect(listing.entries.find((entry) => entry.path === 'tracked.txt')?.gitStatus).toBe('modified');
    expect(listing.entries.find((entry) => entry.path === 'src')?.descendantGitStatusCount).toBe(1);
  });

  it('reads small text files and reports large files as metadata until forced', async () => {
    const repo = createRepo();
    writeFileSync(join(repo, 'big.txt'), 'x'.repeat(600 * 1024));

    const normal = await readWorkspaceFile(repo, 'tracked.txt');
    const big = await readWorkspaceFile(repo, 'big.txt');
    const forced = await readWorkspaceFile(repo, 'big.txt', true);

    expect(normal.content).toContain('one');
    expect(big.tooLarge).toBe(true);
    expect(big.content).toBeNull();
    expect(forced.content?.length).toBe(600 * 1024);
  });

  it('builds overlay decorations for additions and virtual deleted blocks', () => {
    const parsed = __workspaceExplorerInternals.parseDiffOverlay(['@@ -1,3 +1,3 @@', ' keep', '-old', '+new', ' tail'].join('\n'));

    expect(parsed.addedLines).toEqual([2]);
    expect(parsed.deletedBlocks).toEqual([{ afterLine: 1, lines: ['old'] }]);
  });

  it('ignores malformed diff hunk line numbers', () => {
    const parsed = __workspaceExplorerInternals.parseDiffOverlay(
      [`@@ -1,1 +${Number.MAX_SAFE_INTEGER + 1},1 @@`, '+unsafe', '@@ -1,1 +2abc,1 @@', '+partial', '@@ -1,1 +2,1 @@', '+valid'].join('\n'),
    );

    expect(parsed.addedLines).toEqual([2]);
  });

  it('treats untracked files as entirely added', async () => {
    const repo = createRepo();
    writeFileSync(join(repo, 'new.txt'), 'a\nb\n');

    const overlay = await readWorkspaceDiffOverlay(repo, 'new.txt');

    expect(overlay.gitStatus).toBe('untracked');
    expect(overlay.addedLines).toEqual([1, 2, 3]);
    expect(overlay.deletedBlocks).toEqual([]);
  });

  it('bounds uncommitted diff payloads for renderer safety', async () => {
    const repo = createRepo();
    for (let index = 0; index < 30; index += 1) {
      writeFileSync(join(repo, `new-${index}.txt`), `file ${index}\n`);
    }
    writeFileSync(join(repo, 'large.txt'), 'x'.repeat(300 * 1024));

    const result = await readUncommittedDiffAsync(repo);

    expect(result?.changeCount).toBe(31);
    expect(result?.files).toHaveLength(25);
    expect(result?.files.some((file) => file.patch.includes('x'.repeat(1024)))).toBe(false);
  });

  it('reads tracked uncommitted diffs with a single pathspec separator', async () => {
    const repo = createRepo();
    writeFileSync(join(repo, 'tracked.txt'), 'one\nTWO\nthree\n');
    writeFileSync(join(repo, 'src', 'app.ts'), 'const value = 2;\n');

    const result = await readUncommittedDiffAsync(repo);

    expect(result?.files.map((file) => file.path).sort()).toEqual(['src/app.ts', 'tracked.txt']);
  });

  it('writes, creates, renames, moves, and deletes workspace paths safely', async () => {
    const repo = createRepo();

    const written = await writeWorkspaceFile(repo, 'notes/todo.txt', 'ship it\r\n');
    expect(written.path).toBe('notes/todo.txt');
    expect(readFileSync(join(repo, 'notes', 'todo.txt'), 'utf-8')).toBe('ship it\n');

    const folder = await createWorkspaceFolder(repo, 'docs');
    expect(folder.kind).toBe('directory');

    const renamed = await renameWorkspacePath(repo, 'notes/todo.txt', 'done.txt');
    expect(renamed.path).toBe('notes/done.txt');

    const moved = await moveWorkspacePath(repo, 'notes/done.txt', 'docs');
    expect(moved.path).toBe('docs/done.txt');

    await deleteWorkspacePath(repo, 'docs/done.txt');
    expect(existsSync(join(repo, 'docs', 'done.txt'))).toBe(false);
    await expect(writeWorkspaceFile(repo, '../escape.txt', 'nope')).rejects.toThrow(/escapes filesystem root/i);
  });
});
