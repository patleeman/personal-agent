export interface ConversationComposerSubmitState {
  label: 'Send' | 'Steer' | 'Follow up';
  behavior?: 'followUp';
}

export function normalizeConversationComposerBehavior(
  behavior: 'steer' | 'followUp' | undefined,
  isStreaming: boolean,
): 'steer' | 'followUp' | undefined {
  return isStreaming ? behavior : undefined;
}

export function resolveConversationComposerSubmitState(
  isStreaming: boolean,
  altKeyHeld: boolean,
): ConversationComposerSubmitState {
  if (!isStreaming) {
    return { label: 'Send' };
  }

  if (altKeyHeld) {
    return { label: 'Follow up', behavior: 'followUp' };
  }

  return { label: 'Steer' };
}
