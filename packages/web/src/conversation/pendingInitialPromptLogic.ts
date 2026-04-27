import type { MessageBlock } from '../shared/types';
import type { PendingConversationPrompt } from '../pending/pendingConversationPrompt';

export function shouldAutoDispatchPendingInitialPrompt(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  hasPendingInitialPrompt: boolean;
  pendingInitialPromptDispatching: boolean;
  hasStreamSnapshot: boolean;
}): boolean {
  return !input.draft
    && Boolean(input.conversationId)
    && input.hasPendingInitialPrompt
    && !input.pendingInitialPromptDispatching
    && input.hasStreamSnapshot;
}

export function shouldClaimPendingInitialPromptForSession(input: {
  conversationId: string | null | undefined;
  prompt: PendingConversationPrompt | null | undefined;
  inFlightSessionId: string | null | undefined;
  failedSessionId: string | null | undefined;
}): boolean {
  return Boolean(input.conversationId)
    && Boolean(input.prompt)
    && input.inFlightSessionId !== input.conversationId
    && input.failedSessionId !== input.conversationId;
}

export function shouldKeepStoredPendingInitialPromptDuringDispatch(
  prompt: PendingConversationPrompt,
): boolean {
  return (prompt.relatedConversationIds?.length ?? 0) > 0;
}

export function hasConversationTranscriptAcceptedPendingInitialPrompt(input: {
  messages: MessageBlock[] | undefined;
  prompt: PendingConversationPrompt | null | undefined;
}): boolean {
  if (!input.prompt || !input.messages || input.messages.length === 0) {
    return false;
  }

  const pendingText = input.prompt.text.trim();
  const pendingImageCount = input.prompt.images.length;

  return input.messages.some((message) => {
    if (message.type !== 'user') {
      return false;
    }

    const messageText = message.text.trim();
    const messageImageCount = message.images?.length ?? 0;
    if (messageImageCount !== pendingImageCount) {
      return false;
    }

    if (pendingText.length === 0) {
      return pendingImageCount > 0;
    }

    return messageText === pendingText;
  });
}
