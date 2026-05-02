import { describe, expect, it } from 'vitest';

import { mergeProfiles, SCHEMA_VERSION, validateProfile } from './index.js';

describe('core exports', () => {
  it('should export mergeProfiles', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    expect(profile.name).toBe('Test');
  });

  it('should export validateProfile', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
  });

  it('should export SCHEMA_VERSION', () => {
    expect(SCHEMA_VERSION).toBe('1.0.0');
  });
});
