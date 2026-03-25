import { describe, expect, it } from 'vitest';
import { buildApiPath, COMPANION_API_PREFIX, DESKTOP_API_PREFIX, resolveApiPrefix } from './apiBase.js';

describe('resolveApiPrefix', () => {
  it('uses the desktop api prefix for desktop routes', () => {
    expect(resolveApiPrefix('/')).toBe(DESKTOP_API_PREFIX);
    expect(resolveApiPrefix('/conversations/conv-123')).toBe(DESKTOP_API_PREFIX);
  });

  it('uses the companion api prefix for companion routes', () => {
    expect(resolveApiPrefix('/app')).toBe(COMPANION_API_PREFIX);
    expect(resolveApiPrefix('/app/conversations/conv-123')).toBe(COMPANION_API_PREFIX);
  });
});

describe('buildApiPath', () => {
  it('builds desktop api urls', () => {
    expect(buildApiPath('/sessions', '/conversations')).toBe('/api/sessions');
  });

  it('builds companion api urls', () => {
    expect(buildApiPath('/companion-auth/session', '/app/conversations')).toBe('/app/api/companion-auth/session');
  });
});
