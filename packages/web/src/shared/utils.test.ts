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
});
