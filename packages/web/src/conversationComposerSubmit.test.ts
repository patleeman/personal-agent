import { describe, expect, it } from 'vitest';
import {
  normalizeConversationComposerBehavior,
  resolveConversationComposerSubmitState,
} from './conversationComposerSubmit.js';

describe('normalizeConversationComposerBehavior', () => {
  it('drops queued behaviors when queued prompts are not allowed', () => {
    expect(normalizeConversationComposerBehavior('steer', false)).toBeUndefined();
    expect(normalizeConversationComposerBehavior('followUp', false)).toBeUndefined();
  });

  it('preserves queued behaviors when queued prompts are allowed', () => {
    expect(normalizeConversationComposerBehavior('steer', true)).toBe('steer');
    expect(normalizeConversationComposerBehavior('followUp', true)).toBe('followUp');
  });
});

describe('resolveConversationComposerSubmitState', () => {
  it('shows Send when the session is idle', () => {
    expect(resolveConversationComposerSubmitState(false, false)).toEqual({ label: 'Send' });
    expect(resolveConversationComposerSubmitState(false, true)).toEqual({ label: 'Send' });
  });

  it('shows Follow up when the session is idle but new prompts will queue behind a hidden turn', () => {
    expect(resolveConversationComposerSubmitState(false, false, true)).toEqual({
      label: 'Follow up',
      behavior: 'followUp',
    });
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
