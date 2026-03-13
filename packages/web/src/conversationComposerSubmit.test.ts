import { describe, expect, it } from 'vitest';
import { resolveConversationComposerSubmitState } from './conversationComposerSubmit.js';

describe('resolveConversationComposerSubmitState', () => {
  it('shows Send when the session is idle', () => {
    expect(resolveConversationComposerSubmitState(false, false)).toEqual({ label: 'Send' });
    expect(resolveConversationComposerSubmitState(false, true)).toEqual({ label: 'Send' });
  });

  it('shows Steer while streaming by default', () => {
    expect(resolveConversationComposerSubmitState(true, false)).toEqual({ label: 'Steer' });
  });

  it('switches to Follow up while streaming when Alt is held', () => {
    expect(resolveConversationComposerSubmitState(true, true)).toEqual({
      label: 'Follow up',
      behavior: 'followUp',
    });
  });
});
