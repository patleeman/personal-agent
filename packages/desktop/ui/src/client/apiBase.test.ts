import { describe, expect, it } from 'vitest';

import { buildApiPath } from './apiBase.js';

describe('buildApiPath', () => {
  it('builds desktop api urls for conversation routes', () => {
    expect(buildApiPath('/sessions', '/conversations')).toBe('/api/sessions');
    expect(buildApiPath('/sessions', '/')).toBe('/api/sessions');
  });

  it('ignores legacy /app paths and still uses the desktop api prefix', () => {
    expect(buildApiPath('/remote-access', '/app')).toBe('/api/remote-access');
    expect(buildApiPath('/remote-access', '/app/conversations')).toBe('/api/remote-access');
  });
});
