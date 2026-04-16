import { describe, expect, it } from 'vitest';

describe('web-tools extension module', () => {
  it('loads from the repo root dependency graph', async () => {
    const module = await import('./index');
    expect(typeof module.default).toBe('function');
  });
});
