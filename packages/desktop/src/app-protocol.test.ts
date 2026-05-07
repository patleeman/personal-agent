import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { name: 'Personal Agent' },
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
  session: { fromPartition: () => ({ protocol: { handle: vi.fn() }, setProxy: vi.fn() }) },
}));

import { getDesktopAppBaseUrl } from './app-protocol.js';

// ── app-protocol — helper functions ──────────────────────────────────────

describe('getDesktopAppBaseUrl', () => {
  it('returns the personal-agent://app/ base URL', () => {
    expect(getDesktopAppBaseUrl()).toBe('personal-agent://app/');
  });
});
