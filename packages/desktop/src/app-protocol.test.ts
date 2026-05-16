import { describe, expect, it, vi } from 'vitest';

const clearCacheMock = vi.fn().mockResolvedValue(undefined);
const setProxyMock = vi.fn().mockResolvedValue(undefined);

vi.mock('electron', () => ({
  app: { name: 'Personal Agent' },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  session: { fromPartition: () => ({ protocol: { handle: vi.fn() }, setProxy: setProxyMock, clearCache: clearCacheMock }) },
}));

import { ensureDesktopAppProtocolForHost, getDesktopAppBaseUrl } from './app-protocol.js';

// ── app-protocol — helper functions ──────────────────────────────────────

describe('getDesktopAppBaseUrl', () => {
  it('returns the personal-agent://app/ base URL', () => {
    expect(getDesktopAppBaseUrl()).toBe('personal-agent://app/');
  });
});

describe('ensureDesktopAppProtocolForHost', () => {
  it('clears the local desktop shell cache so stale dynamic extension chunks do not survive updates', () => {
    ensureDesktopAppProtocolForHost({} as never, 'local');

    expect(setProxyMock).toHaveBeenCalledWith({ mode: 'direct' });
    expect(clearCacheMock).toHaveBeenCalled();
  });
});
