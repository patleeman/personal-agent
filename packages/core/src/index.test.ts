import { describe, expect, it } from 'vitest';

import { getDefaultStateRoot, getDefaultVaultRoot } from './index.js';

describe('core exports', () => {
  it('exports runtime path helpers', () => {
    expect(getDefaultStateRoot()).toContain('personal-agent');
    expect(getDefaultVaultRoot()).toContain('personal-agent');
  });
});
