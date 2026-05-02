import { describe, expect, it } from 'vitest';

import { sessionNeedsAttention } from './sessionIndicators';

describe('sessionIndicators', () => {
  it('suppresses attention while a conversation is still running', () => {
    expect(sessionNeedsAttention({ needsAttention: true, isRunning: true })).toBe(false);
    expect(sessionNeedsAttention({ needsAttention: true, isRunning: false })).toBe(true);
    expect(sessionNeedsAttention({ needsAttention: false, isRunning: false })).toBe(false);
  });
});
