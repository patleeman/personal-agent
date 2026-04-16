import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: mocks.spawnSync,
}));

import {
  readTailscaleServeProxyState,
  resolveTailscaleServeBaseUrl,
  resolveWebUiTailscaleUrl,
  syncTailscaleServeProxy,
  syncWebUiTailscaleServe,
} from './tailscale-serve.js';

function createServeStatusPayload(handlers: Record<string, string> = {}): string {
  const normalizedHandlers = Object.fromEntries(
    Object.entries(handlers).map(([path, proxy]) => [path, { Proxy: proxy }]),
  );

  return JSON.stringify({
    Web: {
      'my-host.tailnet.ts.net:443': {
        Handlers: normalizedHandlers,
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.spawnSync.mockReset();
  mocks.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });
});

describe('readTailscaleServeProxyState', () => {
  it('reports published when the expected path points at the expected port', () => {
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: createServeStatusPayload({ '/codex': 'http://localhost:8390' }),
      stderr: '',
    });

    expect(readTailscaleServeProxyState({ enabled: true, port: 8390, path: '/codex' })).toEqual({
      status: 'published',
      path: '/codex',
      expectedProxyTarget: 'http://localhost:8390',
      actualProxyTarget: 'http://localhost:8390',
      message: 'Tailscale Serve exposes /codex -> localhost:8390.',
    });
  });

  it('reports mismatch when the expected path points elsewhere', () => {
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: createServeStatusPayload({ '/codex': 'http://localhost:3741' }),
      stderr: '',
    });

    expect(readTailscaleServeProxyState({ enabled: true, port: 8390, path: '/codex' })).toEqual({
      status: 'mismatch',
      path: '/codex',
      expectedProxyTarget: 'http://localhost:8390',
      actualProxyTarget: 'http://localhost:3741',
      message: 'Tailscale Serve exposes /codex, but it points to http://localhost:3741 instead of localhost:8390.',
    });
  });
});

describe('syncTailscaleServeProxy', () => {
  it('supports mounting a reverse proxy on a custom path', () => {
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: createServeStatusPayload({ '/codex': 'http://localhost:8390' }), stderr: '' });

    syncTailscaleServeProxy({ enabled: true, port: 8390, path: '/codex' });

    expect(mocks.spawnSync).toHaveBeenNthCalledWith(
      1,
      'tailscale',
      ['serve', '--bg', '--set-path=/codex', 'localhost:8390'],
      { encoding: 'utf-8' },
    );
    expect(mocks.spawnSync).toHaveBeenNthCalledWith(
      2,
      'tailscale',
      ['serve', 'status', '--json'],
      { encoding: 'utf-8' },
    );
  });

  it('fails when the expected path is still missing after enabling it', () => {
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: createServeStatusPayload({}), stderr: '' });

    expect(() => syncTailscaleServeProxy({ enabled: true, port: 8390, path: '/codex' })).toThrow(
      'does not currently expose /codex -> localhost:8390',
    );
  });

  it('fails when the path points at the wrong local target after enabling it', () => {
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: createServeStatusPayload({ '/codex': 'http://localhost:3741' }), stderr: '' });

    expect(() => syncTailscaleServeProxy({ enabled: true, port: 8390, path: '/codex' })).toThrow(
      'it points to http://localhost:3741 instead of localhost:8390',
    );
  });

  it('fails when the path is still exposed after disabling it', () => {
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: createServeStatusPayload({ '/codex': 'http://localhost:8390' }), stderr: '' });

    expect(() => syncTailscaleServeProxy({ enabled: false, port: 8390, path: '/codex' })).toThrow(
      'still exposes /codex -> http://localhost:8390 after disabling it',
    );
  });
});

describe('syncWebUiTailscaleServe', () => {
  it('enables tailscale serve for the provided web UI port without clobbering sibling paths', () => {
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({
        status: 0,
        stdout: createServeStatusPayload({
          '/': 'http://localhost:3741',
          '/codex': 'http://localhost:8390',
        }),
        stderr: '',
      });

    syncWebUiTailscaleServe({ enabled: true, port: 3741 });

    expect(mocks.spawnSync).toHaveBeenNthCalledWith(
      1,
      'tailscale',
      ['serve', '--bg', '--set-path=/', 'localhost:3741'],
      { encoding: 'utf-8' },
    );
  });

  it('disables only the root web UI path and leaves sibling paths alone', () => {
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: createServeStatusPayload({ '/codex': 'http://localhost:8390' }), stderr: '' });

    syncWebUiTailscaleServe({ enabled: false, port: 3741 });

    expect(mocks.spawnSync).toHaveBeenNthCalledWith(
      1,
      'tailscale',
      ['serve', '--bg', '--set-path=/', 'localhost:3741', 'off'],
      { encoding: 'utf-8' },
    );
  });

  it('fails fast for invalid ports', () => {
    expect(() => syncWebUiTailscaleServe({ enabled: true, port: 0 })).toThrow('Invalid Tailscale Serve port');
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

  it('reports which mapping failed when tailscale serve returns an error', () => {
    mocks.spawnSync.mockReturnValueOnce({ status: 1, stdout: '', stderr: 'serve path already in use' });

    expect(() => syncWebUiTailscaleServe({ enabled: true, port: 3741 })).toThrow(
      '/ -> localhost:3741',
    );
  });
});

describe('resolveTailscaleServeBaseUrl', () => {
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

    const url = resolveTailscaleServeBaseUrl();

    expect(url).toBe('https://my-host.tailnet.ts.net');
    expect(mocks.spawnSync).toHaveBeenCalledWith('tailscale', ['status', '--json'], { encoding: 'utf-8' });
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
