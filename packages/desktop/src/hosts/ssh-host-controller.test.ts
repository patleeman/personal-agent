import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runSshCommand: vi.fn(),
}));

vi.mock('../app-protocol.js', () => ({
  getDesktopAppBaseUrl: () => 'app://desktop/',
}));

vi.mock('../system-ssh.js', () => ({
  runSshCommand: mocks.runSshCommand,
}));

import { testSshConnection } from './ssh-host-controller.js';

describe('testSshConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects blank SSH targets', async () => {
    await expect(testSshConnection({ sshTarget: '   ' })).rejects.toThrow('SSH target is required.');
    expect(mocks.runSshCommand).not.toHaveBeenCalled();
  });

  it('parses the probed platform and runtime cache details', async () => {
    mocks.runSshCommand.mockResolvedValue(
      ['Darwin', 'arm64', '/Users/patrick', '/var/folders/example/T/', '/Users/patrick/.cache/personal-agent/ssh-runtime'].join('\n'),
    );

    await expect(testSshConnection({ sshTarget: ' user@bender ' })).resolves.toEqual({
      ok: true,
      sshTarget: 'user@bender',
      os: 'darwin',
      arch: 'arm64',
      platformKey: 'darwin-arm64',
      homeDirectory: '/Users/patrick',
      tempDirectory: '/var/folders/example/T/',
      cacheDirectory: '/Users/patrick/.cache/personal-agent/ssh-runtime',
      message: 'user@bender is reachable · macOS arm64',
    });

    expect(mocks.runSshCommand).toHaveBeenCalledWith(
      'user@bender',
      expect.stringContaining('cache="$home/.cache/personal-agent/ssh-runtime"'),
    );
    expect(mocks.runSshCommand).toHaveBeenCalledWith(
      'user@bender',
      expect.stringContaining('mktemp -d "${tmp%/}/personal-agent-ssh-test.XXXXXX"'),
    );
  });
});
