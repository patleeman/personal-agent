import { describe, expect, it } from 'vitest';

import {
  normalizeConversationComposerBehavior,
  resolveConversationComposerSubmitState,
  runConversationComposerSubmitOnce,
  shouldShowQuestionSubmitAsPrimaryComposerAction,
} from './conversationComposerSubmit.js';

describe('runConversationComposerSubmitOnce', () => {
  it('drops overlapping composer submissions and unlocks after completion', async () => {
    const lock = { current: false };
    let resolveFirst: (() => void) | null = null;
    let calls = 0;

    const first = runConversationComposerSubmitOnce(lock, async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      return 'first';
    });
    const second = runConversationComposerSubmitOnce(lock, async () => {
      calls += 1;
      return 'second';
    });

    await expect(second).resolves.toBeUndefined();
    expect(calls).toBe(1);

    resolveFirst?.();
    await expect(first).resolves.toBe('first');
    await expect(runConversationComposerSubmitOnce(lock, async () => 'third')).resolves.toBe('third');
    expect(calls).toBe(1);
  });

  it('unlocks after failed submissions', async () => {
    const lock = { current: false };

    await expect(
      runConversationComposerSubmitOnce(lock, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(runConversationComposerSubmitOnce(lock, async () => 'recovered')).resolves.toBe('recovered');
  });
});

describe('shouldShowQuestionSubmitAsPrimaryComposerAction', () => {
  it('uses the primary composer slot for questionnaire submission while the composer is otherwise empty', () => {
    expect(shouldShowQuestionSubmitAsPrimaryComposerAction(true, false, false)).toBe(true);
  });

  it('keeps the normal composer action when there is no pending question, content is present, or the session is streaming', () => {
    expect(shouldShowQuestionSubmitAsPrimaryComposerAction(false, false, false)).toBe(false);
    expect(shouldShowQuestionSubmitAsPrimaryComposerAction(true, true, false)).toBe(false);
    expect(shouldShowQuestionSubmitAsPrimaryComposerAction(true, false, true)).toBe(false);
  });
});

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
    expect(resolveConversationComposerSubmitState(false, false)).toEqual({ label: 'Send', action: 'submit' });
    expect(resolveConversationComposerSubmitState(false, true)).toEqual({ label: 'Send', action: 'submit' });
  });

  it('shows Follow up when the session is idle but new prompts will queue behind a stale turn', () => {
    expect(resolveConversationComposerSubmitState(false, false, true)).toEqual({
      label: 'Follow up',
      action: 'submit',
      behavior: 'followUp',
    });
  });

  it('shows Parallel when a stale turn is pending and the parallel modifier is held', () => {
    expect(resolveConversationComposerSubmitState(false, false, true, true)).toEqual({
      label: 'Parallel',
      action: 'parallel',
    });
  });

  it('shows Steer while streaming by default', () => {
    expect(resolveConversationComposerSubmitState(true, false)).toEqual({ label: 'Steer', action: 'submit' });
  });

  it('switches to Follow up while streaming when Alt is held', () => {
    expect(resolveConversationComposerSubmitState(true, true)).toEqual({
      label: 'Follow up',
      action: 'submit',
      behavior: 'followUp',
    });
  });

  it('switches to Parallel while streaming when the parallel modifier is held', () => {
    expect(resolveConversationComposerSubmitState(true, false, false, true)).toEqual({
      label: 'Parallel',
      action: 'parallel',
    });
  });

  it('Alt takes priority over parallel modifier while streaming', () => {
    // When both Alt and Ctrl are held, Alt (follow-up) wins
    expect(resolveConversationComposerSubmitState(true, true, false, true)).toEqual({
      label: 'Follow up',
      action: 'submit',
      behavior: 'followUp',
    });
  });

  it('stale turn does not affect the default submit while streaming', () => {
    // isStreaming=true always shows Steer by default regardless of queuesFollowUpsWhenIdle
    expect(resolveConversationComposerSubmitState(true, false, true)).toEqual({
      label: 'Steer',
      action: 'submit',
    });
  });

  it('stale turn does not affect alt/parallel modifiers while streaming', () => {
    // Even with stale turn, Alt produces follow-up when streaming
    expect(resolveConversationComposerSubmitState(true, true, true)).toEqual({
      label: 'Follow up',
      action: 'submit',
      behavior: 'followUp',
    });

    // Even with stale turn, Ctrl produces parallel when streaming
    expect(resolveConversationComposerSubmitState(true, false, true, true)).toEqual({
      label: 'Parallel',
      action: 'parallel',
    });
  });
});
