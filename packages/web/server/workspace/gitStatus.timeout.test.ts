import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import { readGitRepoInfo, readGitStatusSummaryWithTelemetry } from './gitStatus.js';

function createGitTimeoutError(stdout = ''): Error & { stdout?: string; status?: number | null; code?: string } {
  const error = new Error('spawnSync git ETIMEDOUT') as Error & { stdout?: string; status?: number | null; code?: string };
  error.stdout = stdout;
  error.status = null;
  error.code = 'ETIMEDOUT';
  return error;
}

describe('readGitStatusSummaryWithTelemetry timeout handling', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a degraded summary instead of throwing when tracked diff times out', () => {
    const cwd = '/mock/repo-timeout';

    execFileSyncMock.mockImplementation((_command: string, args: readonly string[]) => {
      const gitArgs = [...args];
      const joined = gitArgs.join(' ');
      if (joined === 'rev-parse --is-inside-work-tree') {
        return 'true\n';
      }
      if (joined === 'rev-parse --show-toplevel') {
        return `${cwd}\n`;
      }
      if (gitArgs[0] === 'status') {
        return '## master...origin/master\n M tracked.txt\n?? big.tmp\n';
      }
      if (joined === 'rev-parse --verify HEAD') {
        return 'abcd123\n';
      }
      if (joined === 'diff --numstat HEAD') {
        throw createGitTimeoutError();
      }

      throw new Error(`unexpected git args: ${joined}`);
    });

    const firstRead = readGitStatusSummaryWithTelemetry(cwd);
    expect(firstRead.summary).toEqual({
      branch: 'master',
      changeCount: 2,
      linesAdded: 0,
      linesDeleted: 0,
      changes: [
        { relativePath: 'big.tmp', change: 'untracked' },
        { relativePath: 'tracked.txt', change: 'modified' },
      ],
    });
    expect(firstRead.telemetry).toMatchObject({
      cache: 'miss',
      hasRepo: true,
      degraded: true,
    });

    execFileSyncMock.mockClear();

    const secondRead = readGitStatusSummaryWithTelemetry(cwd);
    expect(secondRead.summary).toEqual(firstRead.summary);
    expect(secondRead.telemetry).toMatchObject({
      cache: 'hit',
      hasRepo: true,
      degraded: true,
    });
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('returns null git details instead of throwing when git status times out', () => {
    const cwd = '/mock/repo-status-timeout';

    execFileSyncMock.mockImplementation((_command: string, args: readonly string[]) => {
      const gitArgs = [...args];
      const joined = gitArgs.join(' ');
      if (joined === 'rev-parse --is-inside-work-tree') {
        return 'true\n';
      }
      if (joined === 'rev-parse --show-toplevel') {
        return `${cwd}\n`;
      }
      if (gitArgs[0] === 'status') {
        throw createGitTimeoutError();
      }

      throw new Error(`unexpected git args: ${joined}`);
    });

    const read = readGitStatusSummaryWithTelemetry(cwd);
    expect(read.summary).toBeNull();
    expect(read.telemetry).toMatchObject({
      cache: 'miss',
      hasRepo: true,
      degraded: true,
    });
  });

  it('keeps reading other untracked files when one no-index diff fails without timing out', () => {
    const cwd = '/mock/repo-untracked-failure';

    execFileSyncMock.mockImplementation((_command: string, args: readonly string[]) => {
      const gitArgs = [...args];
      const joined = gitArgs.join(' ');
      if (joined === 'rev-parse --is-inside-work-tree') {
        return 'true\n';
      }
      if (joined === 'rev-parse --show-toplevel') {
        return `${cwd}\n`;
      }
      if (gitArgs[0] === 'status') {
        return '## main\n?? notes.txt\n?? broken.tmp\n';
      }
      if (joined === 'diff --no-index --numstat -- /dev/null broken.tmp') {
        const error = new Error('git diff failed') as Error & { stdout?: string; status?: number | null; code?: string };
        error.status = 2;
        error.stdout = '';
        throw error;
      }
      if (joined === 'diff --no-index --numstat -- /dev/null notes.txt') {
        const error = new Error('git diff mismatch') as Error & { stdout?: string; status?: number | null; code?: string };
        error.status = 1;
        error.stdout = '2\t0\tnotes.txt\n';
        throw error;
      }

      throw new Error(`unexpected git args: ${joined}`);
    });

    const read = readGitStatusSummaryWithTelemetry(cwd);
    expect(read.summary).toEqual({
      branch: 'main',
      changeCount: 2,
      linesAdded: 2,
      linesDeleted: 0,
      changes: [
        { relativePath: 'broken.tmp', change: 'untracked' },
        { relativePath: 'notes.txt', change: 'untracked' },
      ],
    });
    expect(read.telemetry).toMatchObject({
      cache: 'miss',
      hasRepo: true,
      degraded: true,
    });
  });

  it('summarizes staged and unstaged tracked changes before the first commit exists', () => {
    const cwd = '/mock/repo-no-head';

    execFileSyncMock.mockImplementation((_command: string, args: readonly string[]) => {
      const gitArgs = [...args];
      const joined = gitArgs.join(' ');
      if (joined === 'rev-parse --is-inside-work-tree') {
        return 'true\n';
      }
      if (joined === 'rev-parse --show-toplevel') {
        return `${cwd}\n`;
      }
      if (gitArgs[0] === 'status') {
        return '## No commits yet on main\nA  staged.txt\nAM staged-and-unstaged.txt\n';
      }
      if (joined === 'rev-parse --verify HEAD') {
        const error = new Error('missing HEAD') as Error & { stdout?: string; status?: number | null; code?: string };
        error.status = 1;
        error.stdout = '';
        throw error;
      }
      if (joined === 'diff --cached --numstat') {
        return '3\t1\tstaged.txt\n';
      }
      if (joined === 'diff --numstat') {
        return '2\t0\tstaged-and-unstaged.txt\n';
      }

      throw new Error(`unexpected git args: ${joined}`);
    });

    const read = readGitStatusSummaryWithTelemetry(cwd);
    expect(read.summary).toEqual({
      branch: 'main',
      changeCount: 2,
      linesAdded: 5,
      linesDeleted: 1,
      changes: [
        { relativePath: 'staged-and-unstaged.txt', change: 'added' },
        { relativePath: 'staged.txt', change: 'added' },
      ],
    });
    expect(read.telemetry).toMatchObject({
      cache: 'miss',
      hasRepo: true,
      degraded: false,
    });
  });

  it('caches null repo info when git reports the cwd is outside a work tree', () => {
    const cwd = '/mock/not-a-repo';

    execFileSyncMock.mockImplementation((_command: string, args: readonly string[]) => {
      expect([...args].join(' ')).toBe('rev-parse --is-inside-work-tree');
      return 'false\n';
    });

    expect(readGitRepoInfo(cwd)).toBeNull();

    execFileSyncMock.mockClear();
    expect(readGitRepoInfo(cwd)).toBeNull();
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('returns null repo info when git resolves to a root path without a basename', () => {
    const cwd = '/mock/repo-root-slash';

    execFileSyncMock.mockImplementation((_command: string, args: readonly string[]) => {
      const joined = [...args].join(' ');
      if (joined === 'rev-parse --is-inside-work-tree') {
        return 'true\n';
      }
      if (joined === 'rev-parse --show-toplevel') {
        return '/\n';
      }

      throw new Error(`unexpected git args: ${joined}`);
    });

    expect(readGitRepoInfo(cwd)).toBeNull();
  });

  it('returns a degraded null summary when the status budget is already exhausted', () => {
    const cwd = '/mock/repo-budget-exhausted';
    const nowValues = [1_000, 1_001, 6_000];
    vi.spyOn(Date, 'now').mockImplementation(() => nowValues.shift() ?? 6_000);

    execFileSyncMock.mockImplementation((_command: string, args: readonly string[]) => {
      const joined = [...args].join(' ');
      if (joined === 'rev-parse --is-inside-work-tree') {
        return 'true\n';
      }
      if (joined === 'rev-parse --show-toplevel') {
        return `${cwd}\n`;
      }

      throw new Error(`unexpected git args: ${joined}`);
    });

    const read = readGitStatusSummaryWithTelemetry(cwd);
    expect(read.summary).toBeNull();
    expect(read.telemetry).toMatchObject({
      cache: 'miss',
      hasRepo: true,
      degraded: true,
    });
    expect(execFileSyncMock.mock.calls.map(([, args]) => (args as string[]).join(' '))).toEqual([
      'rev-parse --is-inside-work-tree',
      'rev-parse --show-toplevel',
    ]);
  });

  it('returns a partial untracked summary when a no-index diff times out mid-scan', () => {
    const cwd = '/mock/repo-untracked-timeout';

    execFileSyncMock.mockImplementation((_command: string, args: readonly string[]) => {
      const gitArgs = [...args];
      const joined = gitArgs.join(' ');
      if (joined === 'rev-parse --is-inside-work-tree') {
        return 'true\n';
      }
      if (joined === 'rev-parse --show-toplevel') {
        return `${cwd}\n`;
      }
      if (gitArgs[0] === 'status') {
        return '## main\n?? alpha.tmp\n?? beta.tmp\n';
      }
      if (joined === 'diff --no-index --numstat -- /dev/null alpha.tmp') {
        const error = new Error('git diff mismatch') as Error & { stdout?: string; status?: number | null; code?: string };
        error.status = 1;
        error.stdout = '4\t0\talpha.tmp\n';
        throw error;
      }
      if (joined === 'diff --no-index --numstat -- /dev/null beta.tmp') {
        const error = new Error('spawnSync git ETIMEDOUT') as Error & { stdout?: string; status?: number | null; code?: string };
        error.stdout = '';
        error.status = 2;
        error.code = 'ETIMEDOUT';
        throw error;
      }

      throw new Error(`unexpected git args: ${joined}`);
    });

    const read = readGitStatusSummaryWithTelemetry(cwd);
    expect(read.summary).toEqual({
      branch: 'main',
      changeCount: 2,
      linesAdded: 4,
      linesDeleted: 0,
      changes: [
        { relativePath: 'alpha.tmp', change: 'untracked' },
        { relativePath: 'beta.tmp', change: 'untracked' },
      ],
    });
    expect(read.telemetry).toMatchObject({
      cache: 'miss',
      hasRepo: true,
      degraded: true,
    });
  });
});
