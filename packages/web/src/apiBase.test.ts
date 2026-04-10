import { describe, expect, it } from 'vitest';
import { buildApiPath, DESKTOP_API_PREFIX, resolveApiPrefix } from './apiBase.js';

describe('resolveApiPrefix', () => {
  it('uses the desktop api prefix for desktop routes', () => {
    expect(resolveApiPrefix('/')).toBe(DESKTOP_API_PREFIX);
    expect(resolveApiPrefix('/conversations/conv-123')).toBe(DESKTOP_API_PREFIX);
  });

  it('ignores legacy /app paths and still uses the desktop api prefix', () => {
    expect(resolveApiPrefix('/app')).toBe(DESKTOP_API_PREFIX);
    expect(resolveApiPrefix('/app/conversations/conv-123')).toBe(DESKTOP_API_PREFIX);
  });
});

describe('buildApiPath', () => {
  it('builds desktop api urls', () => {
    expect(buildApiPath('/sessions', '/conversations')).toBe('/api/sessions');
  });

  it('always builds standard api urls', () => {
    expect(buildApiPath('/remote-access', '/app/conversations')).toBe('/api/remote-access');
  });
});
