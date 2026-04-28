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
});
