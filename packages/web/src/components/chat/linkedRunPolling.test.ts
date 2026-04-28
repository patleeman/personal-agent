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
  });
});
