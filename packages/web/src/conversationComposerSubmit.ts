export interface ConversationComposerSubmitState {
  label: 'Send' | 'Steer' | 'Follow up';
  behavior?: 'followUp';
}

export function normalizeConversationComposerBehavior(
  behavior: 'steer' | 'followUp' | undefined,
  allowQueuedPrompts: boolean,
): 'steer' | 'followUp' | undefined {
  return allowQueuedPrompts ? behavior : undefined;
}

export function resolveConversationComposerSubmitState(
  isStreaming: boolean,
  altKeyHeld: boolean,
  queuesFollowUpsWhenIdle = false,
): ConversationComposerSubmitState {
  if (!isStreaming) {
    return queuesFollowUpsWhenIdle
      ? { label: 'Follow up', behavior: 'followUp' }
      : { label: 'Send' };
  }

  if (altKeyHeld) {
    return { label: 'Follow up', behavior: 'followUp' };
  }

  return { label: 'Steer' };
}
