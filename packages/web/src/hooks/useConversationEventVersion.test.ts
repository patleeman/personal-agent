import { describe, expect, it } from 'vitest';
import { shouldBumpConversationEventVersion } from './useConversationEventVersion';

describe('shouldBumpConversationEventVersion', () => {
  it('bumps the version only when the matching session file changes', () => {
    expect(shouldBumpConversationEventVersion({ type: 'session_file_changed', sessionId: 'conv-1' }, 'conv-1')).toBe(true);
  });

  it('ignores metadata-only events and other conversations', () => {
    expect(shouldBumpConversationEventVersion({ type: 'session_meta_changed', sessionId: 'conv-1' }, 'conv-1')).toBe(false);
    expect(shouldBumpConversationEventVersion({ type: 'session_file_changed', sessionId: 'conv-2' }, 'conv-1')).toBe(false);
    expect(shouldBumpConversationEventVersion({ type: 'live_title', sessionId: 'conv-1', title: 'Updated' }, 'conv-1')).toBe(false);
    expect(shouldBumpConversationEventVersion({ type: 'connected' }, 'conv-1')).toBe(false);
  });
});
