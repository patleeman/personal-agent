import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { createWorkspaceFolder, deleteWorkspacePath, listWorkspaceDirectory, moveWorkspacePath, readWorkspaceDiffOverlay, readWorkspaceFile, renameWorkspacePath, writeWorkspaceFile, __workspaceExplorerInternals } from './workspaceExplorer.js';

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
  it('lists from the git root and annotates git status badges', () => {
    const repo = createRepo();
    const nested = join(repo, 'src');
    writeFileSync(join(repo, 'tracked.txt'), 'one\nTWO\nthree\n');
    writeFileSync(join(repo, 'src', 'new.ts'), 'export const fresh = true;\n');

    const listing = listWorkspaceDirectory(nested, '');

    expect(listing.root).toBe(realpathSync(repo));
    expect(listing.rootKind).toBe('git');
    expect(listing.activeCwdRelativePath).toBe('src');
    expect(listing.entries.find((entry) => entry.path === 'tracked.txt')?.gitStatus).toBe('modified');
    expect(listing.entries.find((entry) => entry.path === 'src')?.descendantGitStatusCount).toBe(1);
  });

  it('reads small text files and reports large files as metadata until forced', () => {
    const repo = createRepo();
    writeFileSync(join(repo, 'big.txt'), 'x'.repeat(600 * 1024));

    const normal = readWorkspaceFile(repo, 'tracked.txt');
    const big = readWorkspaceFile(repo, 'big.txt');
    const forced = readWorkspaceFile(repo, 'big.txt', true);

    expect(normal.content).toContain('one');
    expect(big.tooLarge).toBe(true);
    expect(big.content).toBeNull();
    expect(forced.content?.length).toBe(600 * 1024);
  });

  it('builds overlay decorations for additions and virtual deleted blocks', () => {
    const parsed = __workspaceExplorerInternals.parseDiffOverlay([
      '@@ -1,3 +1,3 @@',
      ' keep',
      '-old',
      '+new',
      ' tail',
    ].join('\n'));

    expect(parsed.addedLines).toEqual([2]);
    expect(parsed.deletedBlocks).toEqual([{ afterLine: 1, lines: ['old'] }]);
  });

  it('treats untracked files as entirely added', () => {
    const repo = createRepo();
    writeFileSync(join(repo, 'new.txt'), 'a\nb\n');

    const overlay = readWorkspaceDiffOverlay(repo, 'new.txt');

    expect(overlay.gitStatus).toBe('untracked');
    expect(overlay.addedLines).toEqual([1, 2, 3]);
    expect(overlay.deletedBlocks).toEqual([]);
  });

  it('writes, creates, renames, moves, and deletes workspace paths safely', () => {
    const repo = createRepo();

    const written = writeWorkspaceFile(repo, 'notes/todo.txt', 'ship it\r\n');
    expect(written.path).toBe('notes/todo.txt');
    expect(readFileSync(join(repo, 'notes', 'todo.txt'), 'utf-8')).toBe('ship it\n');

    const folder = createWorkspaceFolder(repo, 'docs');
    expect(folder.kind).toBe('directory');

    const renamed = renameWorkspacePath(repo, 'notes/todo.txt', 'done.txt');
    expect(renamed.path).toBe('notes/done.txt');

    const moved = moveWorkspacePath(repo, 'notes/done.txt', 'docs');
    expect(moved.path).toBe('docs/done.txt');

    deleteWorkspacePath(repo, 'docs/done.txt');
    expect(existsSync(join(repo, 'docs', 'done.txt'))).toBe(false);
    expect(() => writeWorkspaceFile(repo, '../escape.txt', 'nope')).toThrow(/escapes workspace root/i);
  });
});
