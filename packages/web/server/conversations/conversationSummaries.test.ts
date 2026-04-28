import { describe, expect, it } from 'vitest';
import { parseConversationSummaryAttemptTimestamp } from './conversationSummaries.js';

describe('conversation summary attempts', () => {
  it('rejects non-ISO summary attempt timestamps', () => {
    expect(parseConversationSummaryAttemptTimestamp('9999')).toBeNaN();
    expect(parseConversationSummaryAttemptTimestamp('2026-03-10T20:00:00.000Z')).toBe(Date.parse('2026-03-10T20:00:00.000Z'));
  });
});
