import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: mocks.spawnSync,
}));

import { resolveWebUiTailscaleUrl, syncWebUiTailscaleServe } from './tailscale-serve.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
});

describe('syncWebUiTailscaleServe', () => {
  it('enables tailscale serve for the provided web UI port', () => {
    syncWebUiTailscaleServe({ enabled: true, port: 3741 });

    expect(mocks.spawnSync).toHaveBeenCalledWith(
      'tailscale',
      ['serve', '--bg', 'localhost:3741'],
      { encoding: 'utf-8' },
    );
  });

  it('disables tailscale serve for the provided web UI port', () => {
    syncWebUiTailscaleServe({ enabled: false, port: 3741 });

    expect(mocks.spawnSync).toHaveBeenCalledWith(
      'tailscale',
      ['serve', '--bg', 'localhost:3741', 'off'],
      { encoding: 'utf-8' },
    );
  });

  it('fails fast for invalid ports', () => {
    expect(() => syncWebUiTailscaleServe({ enabled: true, port: 0 })).toThrow('Invalid web UI port');
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });

  it('returns a clear error when tailscale is not installed', () => {
    const missingCommandError = new Error('spawn tailscale ENOENT') as NodeJS.ErrnoException;
    missingCommandError.code = 'ENOENT';
    mocks.spawnSync.mockReturnValue({ status: null, stdout: '', stderr: '', error: missingCommandError });

    expect(() => syncWebUiTailscaleServe({ enabled: true, port: 3741 })).toThrow('Could not run `tailscale`');
  });

  it('includes tailscale stderr when the command fails', () => {
    mocks.spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'must be logged in to tailscale' });

    expect(() => syncWebUiTailscaleServe({ enabled: true, port: 3741 })).toThrow(
      'must be logged in to tailscale',
    );
  });
});

describe('resolveWebUiTailscaleUrl', () => {
  it('returns the current tailnet https hostname when available', () => {
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        Self: {
          DNSName: 'my-host.tailnet.ts.net.',
        },
      }),
      stderr: '',
    });

    const url = resolveWebUiTailscaleUrl();

    expect(url).toBe('https://my-host.tailnet.ts.net');
    expect(mocks.spawnSync).toHaveBeenCalledWith('tailscale', ['status', '--json'], { encoding: 'utf-8' });
  });

  it('returns undefined when tailscale status fails', () => {
    mocks.spawnSync.mockReturnValue({ status: 1, stdout: '', stderr: 'not connected' });

    expect(resolveWebUiTailscaleUrl()).toBeUndefined();
  });

  it('falls back to hostname + magicdns suffix when DNSName is missing', () => {
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: JSON.stringify({
        MagicDNSSuffix: 'tailnet.ts.net',
        Self: {
          HostName: 'my-host',
        },
      }),
      stderr: '',
    });

    expect(resolveWebUiTailscaleUrl()).toBe('https://my-host.tailnet.ts.net');
  });

  it('returns undefined when DNSName and fallback hostname data are missing', () => {
    mocks.spawnSync.mockReturnValue({ status: 0, stdout: JSON.stringify({ Self: {} }), stderr: '' });

    expect(resolveWebUiTailscaleUrl()).toBeUndefined();
  });

  it('falls back to common absolute binary paths when tailscale is not on PATH', () => {
    const missingCommandError = new Error('spawn tailscale ENOENT') as NodeJS.ErrnoException;
    missingCommandError.code = 'ENOENT';

    mocks.spawnSync.mockImplementation((command: string) => {
      if (command === 'tailscale') {
        return { status: null, stdout: '', stderr: '', error: missingCommandError };
      }

      if (command === '/opt/homebrew/bin/tailscale') {
        return {
          status: 0,
          stdout: JSON.stringify({
            Self: {
              DNSName: 'my-host.tailnet.ts.net.',
            },
          }),
          stderr: '',
        };
      }

      return { status: null, stdout: '', stderr: '', error: missingCommandError };
    });

    expect(resolveWebUiTailscaleUrl()).toBe('https://my-host.tailnet.ts.net');
  });

  it('returns undefined when tailscale status emits invalid JSON', () => {
    mocks.spawnSync.mockReturnValue({ status: 0, stdout: '{not-json', stderr: '' });

    expect(resolveWebUiTailscaleUrl()).toBeUndefined();
  });
});
