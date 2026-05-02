import { describe, expect, it } from 'vitest';

import { normalizeDesktopConversationStateTailBlocks } from './useDesktopConversationState.js';

describe('normalizeDesktopConversationStateTailBlocks', () => {
  it('drops unsafe desktop conversation tail block limits', () => {
    expect(normalizeDesktopConversationStateTailBlocks(20)).toBe(20);
    expect(normalizeDesktopConversationStateTailBlocks(Number.MAX_SAFE_INTEGER + 1)).toBeUndefined();
  });

  it('caps expensive desktop conversation tail block limits', () => {
    expect(normalizeDesktopConversationStateTailBlocks(5000)).toBe(1000);
  });
});
