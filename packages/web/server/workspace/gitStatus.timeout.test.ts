import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({
  execFileSync: execFileSyncMock,
}));

import { readGitStatusSummaryWithTelemetry } from './gitStatus.js';

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
});
