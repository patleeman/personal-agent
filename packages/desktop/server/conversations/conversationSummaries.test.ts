import { describe, expect, it } from 'vitest';

import { normalizeConversationSummaryBackfillLoopOptions, parseConversationSummaryAttemptTimestamp } from './conversationSummaries.js';

describe('normalizeConversationSummaryBackfillLoopOptions', () => {
  it('uses defaults when no input provided', () => {
    const result = normalizeConversationSummaryBackfillLoopOptions({});
    expect(result.initialDelayMs).toBe(5_000);
    expect(result.intervalMs).toBe(60_000);
    expect(result.limit).toBe(8);
  });

  it('clamps initialDelayMs to max', () => {
    const result = normalizeConversationSummaryBackfillLoopOptions({ initialDelayMs: 120_000 });
    expect(result.initialDelayMs).toBe(60_000);
  });

  it('uses default for negative initialDelayMs', () => {
    const result = normalizeConversationSummaryBackfillLoopOptions({ initialDelayMs: -1 });
    expect(result.initialDelayMs).toBe(5_000);
  });

  it('uses 0 initialDelayMs as-is', () => {
    const result = normalizeConversationSummaryBackfillLoopOptions({ initialDelayMs: 0 });
    expect(result.initialDelayMs).toBe(0);
  });

  it('clamps intervalMs to max', () => {
    const result = normalizeConversationSummaryBackfillLoopOptions({ intervalMs: 1_000_000 });
    expect(result.intervalMs).toBe(600_000);
  });

  it('uses default when intervalMs is below minimum', () => {
    const result = normalizeConversationSummaryBackfillLoopOptions({ intervalMs: 1_000 });
    expect(result.intervalMs).toBe(60_000);
  });

  it('clamps limit to max', () => {
    const result = normalizeConversationSummaryBackfillLoopOptions({ limit: 100 });
    expect(result.limit).toBe(50);
  });

  it('uses default for non-positive limit', () => {
    const result = normalizeConversationSummaryBackfillLoopOptions({ limit: 0 });
    expect(result.limit).toBe(8);
  });

  it('preserves valid custom values', () => {
    const result = normalizeConversationSummaryBackfillLoopOptions({
      initialDelayMs: 10_000,
      intervalMs: 120_000,
      limit: 16,
    });
    expect(result.initialDelayMs).toBe(10_000);
    expect(result.intervalMs).toBe(120_000);
    expect(result.limit).toBe(16);
  });
});

describe('parseConversationSummaryAttemptTimestamp', () => {
  it('parses a valid ISO timestamp', () => {
    const ms = parseConversationSummaryAttemptTimestamp('2026-05-02T10:00:00.000Z');
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThan(0);
  });

  it('rejects ISO timestamp without milliseconds due to roundtrip check', () => {
    const result = parseConversationSummaryAttemptTimestamp('2026-05-02T10:00:00Z');
    expect(Number.isFinite(result)).toBe(false);
  });

  it('returns NaN for empty string', () => {
    expect(parseConversationSummaryAttemptTimestamp('')).toBeNaN();
  });

  it('returns NaN for non-ISO string', () => {
    expect(parseConversationSummaryAttemptTimestamp('not a date')).toBeNaN();
  });

  it('returns NaN for whitespace-only', () => {
    expect(parseConversationSummaryAttemptTimestamp('   ')).toBeNaN();
  });

  it('rejects timestamps that roundtrip differently (invalid ISO)', () => {
    // 2026-13-01 is invalid month but Date.parse might accept it
    const result = parseConversationSummaryAttemptTimestamp('2026-13-01T00:00:00.000Z');
    expect(Number.isFinite(result)).toBe(false);
  });
});
