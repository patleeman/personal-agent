import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execSyncMock } = vi.hoisted(() => ({
  execSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execSync: execSyncMock,
}));

import { runShellCommandCapability } from './shellRunCapability.js';

describe('shellRunCapability', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
  });

  it('runs shell commands in the resolved cwd', () => {
    const resolveRequestedCwd = vi.fn(() => '/workspace/resolved');
    execSyncMock.mockReturnValueOnce('hello\n');

    expect(runShellCommandCapability({ command: 'pwd', cwd: '~/repo' }, {
      getDefaultWebCwd: () => '/workspace/default',
      resolveRequestedCwd,
    })).toEqual({
      output: 'hello\n',
      exitCode: 0,
      cwd: '/workspace/resolved',
    });

    expect(resolveRequestedCwd).toHaveBeenCalledWith('~/repo', '/workspace/default');
    expect(execSyncMock).toHaveBeenCalledWith('pwd', {
      cwd: '/workspace/resolved',
      timeout: 30_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  it('falls back to the default cwd and captures command failures', () => {
    execSyncMock.mockImplementationOnce(() => {
      throw { stdout: 'partial\n', stderr: 'boom\n', status: 17 };
    });

    expect(runShellCommandCapability({ command: 'git status' }, {
      getDefaultWebCwd: () => '/workspace/default',
      resolveRequestedCwd: () => undefined,
    })).toEqual({
      output: 'partial\nboom\n',
      exitCode: 17,
      cwd: '/workspace/default',
    });
  });

  it('rejects empty shell commands', () => {
    expect(() => runShellCommandCapability({ command: '   ' }, {
      getDefaultWebCwd: () => '/workspace/default',
      resolveRequestedCwd: () => undefined,
    })).toThrow('command required');
    expect(execSyncMock).not.toHaveBeenCalled();
  });
});
