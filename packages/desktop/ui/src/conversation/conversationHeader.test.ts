import { describe, expect, it } from 'vitest';

import {
  formatContextUsageLabel,
  formatContextWindowLabel,
  formatThinkingLevelLabel,
  getContextUsagePercent,
} from './conversationHeader.js';

describe('conversation header helpers', () => {
  it('formats thinking level labels with a sensible fallback', () => {
    expect(formatThinkingLevelLabel('xhigh')).toBe('xhigh');
    expect(formatThinkingLevelLabel('  low  ')).toBe('low');
    expect(formatThinkingLevelLabel('')).toBe('default');
    expect(formatThinkingLevelLabel(undefined)).toBe('default');
  });

  it('formats context window labels compactly', () => {
    expect(formatContextWindowLabel(272_000)).toBe('272k');
    expect(formatContextWindowLabel(1_000_000)).toBe('1M');
    expect(formatContextWindowLabel(1_500_000)).toBe('1.5M');
  });

  it('omits unsafe context window labels', () => {
    expect(formatContextWindowLabel(Number.MAX_SAFE_INTEGER + 1)).toBe('unknown');
    expect(formatContextWindowLabel(272_000.5)).toBe('unknown');
  });

  it('formats current context usage labels, including unknown post-compaction state', () => {
    expect(formatContextUsageLabel(27_200, 272_000)).toBe('10.0% of 272k ctx');
    expect(formatContextUsageLabel(null, 272_000)).toBe('? of 272k ctx');
  });

  it('omits context usage percentages for unsafe inputs', () => {
    expect(getContextUsagePercent(Number.MAX_SAFE_INTEGER + 1, 272_000)).toBeNull();
    expect(getContextUsagePercent(27_200, Number.MAX_SAFE_INTEGER + 1)).toBeNull();
    expect(formatContextUsageLabel(27_200, Number.MAX_SAFE_INTEGER + 1)).toBe('? of unknown ctx');
  });
});
