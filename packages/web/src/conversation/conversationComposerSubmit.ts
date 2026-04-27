interface ConversationComposerSubmitState {
  label: 'Send' | 'Steer' | 'Follow up' | 'Parallel';
  action: 'submit' | 'parallel';
  behavior?: 'followUp';
}

interface ConversationComposerSubmitLock {
  current: boolean;
}

export async function runConversationComposerSubmitOnce<T>(
  lock: ConversationComposerSubmitLock,
  submit: () => Promise<T>,
): Promise<T | undefined> {
  if (lock.current) {
    return undefined;
  }

  lock.current = true;
  try {
    return await submit();
  } finally {
    lock.current = false;
  }
}

export function shouldShowQuestionSubmitAsPrimaryComposerAction(
  hasPendingQuestion: boolean,
  composerHasContent: boolean,
  isStreaming: boolean,
): boolean {
  return hasPendingQuestion && !composerHasContent && !isStreaming;
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
  parallelKeyHeld = false,
): ConversationComposerSubmitState {
  if (!isStreaming) {
    if (queuesFollowUpsWhenIdle) {
      if (!altKeyHeld && parallelKeyHeld) {
        return { label: 'Parallel', action: 'parallel' };
      }

      return { label: 'Follow up', action: 'submit', behavior: 'followUp' };
    }

    return { label: 'Send', action: 'submit' };
  }

  if (altKeyHeld) {
    return { label: 'Follow up', action: 'submit', behavior: 'followUp' };
  }

  if (parallelKeyHeld) {
    return { label: 'Parallel', action: 'parallel' };
  }

  return { label: 'Steer', action: 'submit' };
}
