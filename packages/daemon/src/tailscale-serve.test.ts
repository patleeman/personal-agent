import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawnSync: mocks.spawnSync,
}));

import {
  readTailscaleServeProxyState,
  resolveCompanionTailscaleUrl,
  resolveTailscaleServeBaseUrl,
  syncCompanionTailscaleServe,
  syncTailscaleServeProxy,
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
  it('rejects fractional ports instead of flooring them', () => {
    expect(() => syncTailscaleServeProxy({ enabled: true, port: 8390.5, path: '/codex' })).toThrow(
      'Invalid Tailscale Serve port: 8390.5',
    );
    expect(mocks.spawnSync).not.toHaveBeenCalled();
  });

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

describe('syncCompanionTailscaleServe', () => {
  it('enables tailscale serve for the companion path without clobbering sibling paths', () => {
    mocks.spawnSync
      .mockReturnValueOnce({ status: 0, stdout: '', stderr: '' })
      .mockReturnValueOnce({
        status: 0,
        stdout: createServeStatusPayload({
          '/': 'http://localhost:3741',
          '/companion': 'http://localhost:3843',
        }),
        stderr: '',
      });

    syncCompanionTailscaleServe({ enabled: true, port: 3843 });

    expect(mocks.spawnSync).toHaveBeenNthCalledWith(
      1,
      'tailscale',
      ['serve', '--bg', '--set-path=/companion', 'localhost:3843'],
      { encoding: 'utf-8' },
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

describe('resolveCompanionTailscaleUrl', () => {
  it('returns the tailnet https hostname when the companion path is published to the requested port', () => {
    mocks.spawnSync
      .mockReturnValueOnce({
        status: 0,
        stdout: createServeStatusPayload({ '/companion': 'http://localhost:3843' }),
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          Self: {
            DNSName: 'my-host.tailnet.ts.net.',
          },
        }),
        stderr: '',
      });

    expect(resolveCompanionTailscaleUrl(3843)).toBe('https://my-host.tailnet.ts.net');
  });

  it('returns undefined when the companion path is not published for the requested port', () => {
    mocks.spawnSync.mockReturnValue({
      status: 0,
      stdout: createServeStatusPayload({ '/companion': 'http://localhost:3999' }),
      stderr: '',
    });

    expect(resolveCompanionTailscaleUrl(3843)).toBeUndefined();
  });
});

