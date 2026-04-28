import { describe, expect, it } from 'vitest';
import { normalizeConversationSummaryBackfillLoopOptions, parseConversationSummaryAttemptTimestamp } from './conversationSummaries.js';

describe('conversation summary attempts', () => {
  it('rejects non-ISO summary attempt timestamps', () => {
    expect(parseConversationSummaryAttemptTimestamp('9999')).toBeNaN();
    expect(parseConversationSummaryAttemptTimestamp('2026-03-10T20:00:00.000Z')).toBe(Date.parse('2026-03-10T20:00:00.000Z'));
  });

  it('rejects malformed backfill loop timer options', () => {
    expect(normalizeConversationSummaryBackfillLoopOptions({ initialDelayMs: 1.5, intervalMs: 2.5, limit: 3.5 })).toEqual({
      initialDelayMs: 5_000,
      intervalMs: 60_000,
      limit: 8,
    });
  });

  it('caps huge backfill loop timer options', () => {
    expect(normalizeConversationSummaryBackfillLoopOptions({
      initialDelayMs: Number.MAX_SAFE_INTEGER,
      intervalMs: Number.MAX_SAFE_INTEGER,
      limit: Number.MAX_SAFE_INTEGER,
    })).toEqual({
      initialDelayMs: 60_000,
      intervalMs: 600_000,
      limit: 50,
    });
  });
});
