import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const childProcessMocks = vi.hoisted(() => ({
  execFileSync: vi.fn(),
}));

const gitStatusMocks = vi.hoisted(() => ({
  readGitRepoInfo: vi.fn(),
  readGitStatusSummary: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFileSync: childProcessMocks.execFileSync,
}));

vi.mock('./gitStatus.js', () => ({
  readGitRepoInfo: gitStatusMocks.readGitRepoInfo,
  readGitStatusSummary: gitStatusMocks.readGitStatusSummary,
}));

import { readWorkspaceSnapshot } from './workspaceBrowser.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.clearAllMocks();
});

beforeEach(() => {
  childProcessMocks.execFileSync.mockReset();
  gitStatusMocks.readGitRepoInfo.mockReset();
  gitStatusMocks.readGitStatusSummary.mockReset();
});

describe('workspace git command buffering', () => {
  it('uses a larger maxBuffer when listing repo files for workspace snapshots', () => {
    const dir = createTempDir('pa-web-workspace-buffer-');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'export const value = 1;\n');

    gitStatusMocks.readGitRepoInfo.mockReturnValue({ root: dir, name: 'repo' });
    gitStatusMocks.readGitStatusSummary.mockReturnValue({
      branch: 'main',
      changeCount: 0,
      linesAdded: 0,
      linesDeleted: 0,
      changes: [],
    });

    childProcessMocks.execFileSync.mockImplementation((_command, args: string[], _options: { cwd?: string }) => {
      if (args[0] === 'status') {
        return '';
      }

      if (args[0] === 'ls-files') {
        return 'src/a.ts\0';
      }

      throw new Error(`Unexpected git args: ${args.join(' ')}`);
    });

    const snapshot = readWorkspaceSnapshot(dir);

    expect(snapshot.fileCount).toBe(1);
    expect(snapshot.tree).toEqual([
      expect.objectContaining({ relativePath: 'src', kind: 'directory' }),
    ]);

    const lsFilesCall = childProcessMocks.execFileSync.mock.calls.find(([, args]) => args[0] === 'ls-files');
    expect(lsFilesCall).toBeDefined();
    expect(lsFilesCall?.[2]).toEqual(expect.objectContaining({
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf-8',
      timeout: 5000,
    }));
  });
});
