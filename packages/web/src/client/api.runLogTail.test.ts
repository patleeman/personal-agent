import { describe, expect, it } from 'vitest';
import { normalizeConversationContentSearchLimit, normalizeDurableRunLogTailParam } from './api';

describe('normalizeDurableRunLogTailParam', () => {
  it('rejects malformed run log tails and caps expensive tails', () => {
    expect(normalizeDurableRunLogTailParam(25)).toBe(25);
    expect(normalizeDurableRunLogTailParam(25.5)).toBeUndefined();
    expect(normalizeDurableRunLogTailParam(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
    expect(normalizeDurableRunLogTailParam(5000)).toBe(1000);
  });
});

describe('normalizeConversationContentSearchLimit', () => {
  it('rejects malformed search limits and caps expensive searches', () => {
    expect(normalizeConversationContentSearchLimit(25)).toBe(25);
    expect(normalizeConversationContentSearchLimit(25.5)).toBe(80);
    expect(normalizeConversationContentSearchLimit(5000)).toBe(100);
  });
});
