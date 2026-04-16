import { describe, expect, it } from 'vitest';
import { formatContextUsageLabel, formatContextWindowLabel, formatServiceTierLabel, formatThinkingLevelLabel, getContextUsagePercent } from './conversationHeader.js';

describe('conversation header helpers', () => {
  it('formats thinking level labels with a sensible fallback', () => {
    expect(formatThinkingLevelLabel('xhigh')).toBe('xhigh');
    expect(formatThinkingLevelLabel('  low  ')).toBe('low');
    expect(formatThinkingLevelLabel('')).toBe('default');
    expect(formatThinkingLevelLabel(undefined)).toBe('default');
  });

  it('formats service tier labels with a sensible fallback', () => {
    expect(formatServiceTierLabel('priority')).toBe('priority');
    expect(formatServiceTierLabel('  flex  ')).toBe('flex');
    expect(formatServiceTierLabel('')).toBe('auto');
    expect(formatServiceTierLabel(undefined)).toBe('auto');
  });

  it('formats context window labels compactly', () => {
    expect(formatContextWindowLabel(272_000)).toBe('272k');
    expect(formatContextWindowLabel(1_000_000)).toBe('1M');
    expect(formatContextWindowLabel(1_500_000)).toBe('1.5M');
  });


  it('formats current context usage labels, including unknown post-compaction state', () => {
    expect(getContextUsagePercent(27_200, 272_000)).toBe(10);
    expect(getContextUsagePercent(null, 272_000)).toBeNull();
    expect(formatContextUsageLabel(27_200, 272_000)).toBe('10.0% of 272k ctx');
    expect(formatContextUsageLabel(null, 272_000)).toBe('? of 272k ctx');
  });
});
