import { describe, expect, it } from 'vitest';
import { formatDate, timeAgo, timeAgoCompact } from './utils.js';

describe('shared time utilities', () => {
  it('does not render Invalid Date labels for malformed timestamps', () => {
    expect(timeAgo('not a date')).toBe('just now');
    expect(timeAgoCompact('not a date')).toBe('now');
    expect(formatDate('not a date')).toBe('');
  });
});
