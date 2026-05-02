import { describe, expect, it } from 'vitest';

import { formatDate, timeAgo, timeAgoCompact } from './utils.js';

describe('shared time utilities', () => {
  it('does not render Invalid Date labels for malformed timestamps', () => {
    expect(timeAgo('not a date')).toBe('just now');
    expect(timeAgoCompact('not a date')).toBe('now');
    expect(formatDate('not a date')).toBe('');
  });

  it('does not render parsed date labels for non-ISO timestamps', () => {
    expect(timeAgo('1')).toBe('just now');
    expect(timeAgoCompact('1')).toBe('now');
    expect(formatDate('9999')).toBe('');
  });

  it('does not render normalized date labels for overflowed timestamps', () => {
    expect(timeAgo('2026-02-31T09:00:00.000Z')).toBe('just now');
    expect(timeAgoCompact('2026-02-31T09:00:00.000Z')).toBe('now');
    expect(formatDate('2026-02-31T09:00:00.000Z')).toBe('');
  });
});
