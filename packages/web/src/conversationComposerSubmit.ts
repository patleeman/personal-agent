export interface ConversationComposerSubmitState {
  label: 'Send' | 'Steer' | 'Follow up';
  behavior?: 'followUp';
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
