import { describe, expect, it } from 'vitest';

import { normalizeModelContextWindow } from './modelContextWindows.js';

describe('normalizeModelContextWindow', () => {
  it('caps absurd model context windows', () => {
    expect(normalizeModelContextWindow('custom/reap', Number.MAX_SAFE_INTEGER, 128_000)).toBe(10_000_000);
  });

  it('falls back when the fallback context window is absurd', () => {
    expect(normalizeModelContextWindow('custom/reap', undefined, Number.MAX_SAFE_INTEGER)).toBe(128_000);
  });

  it('preserves model-specific minimum context windows', () => {
    expect(normalizeModelContextWindow('openai/gpt-5.5', 128_000, 128_000)).toBe(400_000);
  });

  it('caps model-specific maximum context windows', () => {
    expect(normalizeModelContextWindow('deepseek/deepseek-v4-flash', 1_000_000, 128_000)).toBe(400_000);
  });

  it('applies both minimum and maximum when both are set', () => {
    // gpt-5.5 has a minimum of 400K but no maximum — 128K is raised to 400K
    expect(normalizeModelContextWindow('openai/gpt-5.5', 128_000, 128_000)).toBe(400_000);
    // An artificially high value still respects the minimum but not a non-existent max
    expect(normalizeModelContextWindow('openai/gpt-5.5', 1_000_000, 128_000)).toBe(1_000_000);
  });

  it('does not affect models without a max constraint', () => {
    expect(normalizeModelContextWindow('anthropic/claude-sonnet-4-6', 200_000, 128_000)).toBe(200_000);
  });

  it('preserves values below the max cap', () => {
    expect(normalizeModelContextWindow('deepseek/deepseek-v4-flash', 300_000, 128_000)).toBe(300_000);
  });
});
