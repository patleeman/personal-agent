import { describe, expect, it } from 'vitest';
import { buildConversationBootstrapVersionKey } from './useConversationBootstrap.js';

describe('buildConversationBootstrapVersionKey', () => {
  it('tracks only conversation session invalidations by default', () => {
    expect(buildConversationBootstrapVersionKey({ sessionsVersion: 0 })).toBe('0');
    expect(buildConversationBootstrapVersionKey({ sessionsVersion: 7 })).toBe('7');
  });
});
