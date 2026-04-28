import type { MessageBlock } from '../shared/types';
import type { PendingConversationPrompt } from '../pending/pendingConversationPrompt';

export function shouldAutoDispatchPendingInitialPrompt(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  hasPendingInitialPrompt: boolean;
  pendingInitialPromptDispatching: boolean;
  hasStreamSnapshot: boolean;
  hasTranscriptMessages: boolean;
}): boolean {
  return !input.draft
    && Boolean(input.conversationId)
    && input.hasPendingInitialPrompt
    && !input.pendingInitialPromptDispatching
    && input.hasStreamSnapshot
    && !input.hasTranscriptMessages;
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

export function normalizePendingRelatedConversationIds(
  prompt: PendingConversationPrompt,
): string[] {
  return Array.from(new Set(
    (prompt.relatedConversationIds ?? [])
      .map((value) => value.trim())
      .filter(Boolean),
  ));
}

export function hasConversationTranscriptAcceptedPendingInitialPrompt(input: {
  messages: MessageBlock[] | undefined;
  prompt: PendingConversationPrompt | null | undefined;
}): boolean {
  if (!input.prompt || !input.messages || input.messages.length === 0) {
    return false;
  }

  const pendingText = input.prompt.text.trim();
  const pendingImages = input.prompt.images;

  return input.messages.some((message) => {
    if (message.type !== 'user') {
      return false;
    }

    const messageText = message.text.trim();
    if (!pendingPromptImagesMatchMessageImages(pendingImages, message.images ?? [])) {
      return false;
    }

    if (pendingText.length === 0) {
      return pendingImages.length > 0;
    }

    return messageText === pendingText;
  });
}

export function pendingPromptImagesMatchMessageImages(
  pendingImages: PendingConversationPrompt['images'],
  messageImages: NonNullable<Extract<MessageBlock, { type: 'user' }>['images']>,
): boolean {
  return pendingImages.length === messageImages.length
    && pendingImages.every((pendingImage, index) => {
      const messageImage = messageImages[index];
      if (!messageImage) {
        return false;
      }

      const pendingPreviewUrl = pendingImage.previewUrl?.trim() || '';
      if (pendingPreviewUrl || messageImage.src) {
        return messageImage.src === pendingPreviewUrl;
      }

      const pendingName = pendingImage.name?.trim() || '';
      const messageCaption = messageImage.caption?.trim() || '';
      if (pendingName || messageCaption) {
        return messageCaption === pendingName && messageImage.mimeType === pendingImage.mimeType;
      }

      if (messageImage.mimeType || pendingImage.mimeType) {
        return !messageImage.mimeType || messageImage.mimeType === pendingImage.mimeType;
      }

      return true;
    });
}
