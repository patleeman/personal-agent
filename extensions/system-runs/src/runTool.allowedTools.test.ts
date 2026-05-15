import { describe, expect, it } from 'vitest';

import { normalizeAllowedTools } from './allowedTools.js';

describe('normalizeAllowedTools', () => {
  it('accepts comma-separated agent tool names', () => {
    expect(normalizeAllowedTools(' bash, read , checkpoint ')).toEqual(['bash', 'read', 'checkpoint']);
  });

  it('accepts agent tool name arrays', () => {
    expect(normalizeAllowedTools(['bash', ' read ', ''])).toEqual(['bash', 'read']);
  });

  it('rejects shell command names with a bash hint', () => {
    expect(() => normalizeAllowedTools(['rg'])).toThrow('allowedTools contains shell command "rg"');
    expect(() => normalizeAllowedTools('grep')).toThrow('run grep inside bash');
  });
});
