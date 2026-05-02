import { describe, expect, it } from 'vitest';
import { INLINE_RUN_LOG_TAIL_LINES, INLINE_RUN_POLL_INTERVAL_MS, normalizeInlineRunPollingOptions } from './linkedRunPolling';

describe('normalizeInlineRunPollingOptions', () => {
  it('defaults malformed inline run polling options and caps expensive log tails', () => {
    expect(normalizeInlineRunPollingOptions({ tail: 5000, pollIntervalMs: 1.5 })).toEqual({
      tail: 1000,
      pollIntervalMs: INLINE_RUN_POLL_INTERVAL_MS,
    });

    expect(normalizeInlineRunPollingOptions({ tail: 12.5, pollIntervalMs: 500 })).toEqual({
      tail: INLINE_RUN_LOG_TAIL_LINES,
      pollIntervalMs: 500,
    });
    expect(normalizeInlineRunPollingOptions({ tail: 240, pollIntervalMs: Number.MAX_SAFE_INTEGER })).toEqual({
      tail: 240,
      pollIntervalMs: 10_000,
    });
  });
});
