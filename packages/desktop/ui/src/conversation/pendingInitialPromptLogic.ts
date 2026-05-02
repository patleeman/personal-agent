import type { PendingConversationPrompt } from '../pending/pendingConversationPrompt';
import type { MessageBlock } from '../shared/types';

export function shouldAutoDispatchPendingInitialPrompt(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  hasPendingInitialPrompt: boolean;
  pendingInitialPromptDispatching: boolean;
  hasStreamSnapshot: boolean;
  hasTranscriptMessages: boolean;
}): boolean {
  return (
    !input.draft &&
    Boolean(input.conversationId) &&
    input.hasPendingInitialPrompt &&
    !input.pendingInitialPromptDispatching &&
    input.hasStreamSnapshot &&
    !input.hasTranscriptMessages
  );
}

export function shouldClaimPendingInitialPromptForSession(input: {
  conversationId: string | null | undefined;
  prompt: PendingConversationPrompt | null | undefined;
  inFlightSessionId: string | null | undefined;
  failedSessionId: string | null | undefined;
}): boolean {
  return (
    Boolean(input.conversationId) &&
    Boolean(input.prompt) &&
    input.inFlightSessionId !== input.conversationId &&
    input.failedSessionId !== input.conversationId
  );
}

export function shouldKeepStoredPendingInitialPromptDuringDispatch(prompt: PendingConversationPrompt): boolean {
  return (prompt.relatedConversationIds?.length ?? 0) > 0;
}

export function normalizePendingRelatedConversationIds(prompt: PendingConversationPrompt): string[] {
  return Array.from(new Set((prompt.relatedConversationIds ?? []).map((value) => value.trim()).filter(Boolean)));
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
  return (
    pendingImages.length === messageImages.length &&
    pendingImages.every((pendingImage, index) => {
      const messageImage = messageImages[index];
      if (!messageImage) {
        return false;
      }

      const pendingPreviewUrl = pendingImage.previewUrl?.trim() || '';
      const pendingDataUrl = pendingImage.data ? `data:${pendingImage.mimeType};base64,${pendingImage.data}` : '';
      if (pendingPreviewUrl || messageImage.src) {
        return (
          (isSafePendingPromptImageUrl(pendingPreviewUrl) && messageImage.src === pendingPreviewUrl) ||
          (isSafePendingPromptImageUrl(pendingDataUrl) && messageImage.src === pendingDataUrl)
        );
      }

      const pendingName = pendingImage.name?.trim() || '';
      const messageCaption = messageImage.caption?.trim() || '';
      const pendingMimeType = pendingImage.mimeType.trim().toLowerCase();
      const messageMimeType = messageImage.mimeType?.trim().toLowerCase() || '';
      if (pendingName || messageCaption) {
        return messageCaption === pendingName && messageMimeType === pendingMimeType;
      }

      if (messageMimeType || pendingMimeType) {
        return !messageMimeType || messageMimeType === pendingMimeType;
      }

      return true;
    })
  );
}

function isSafePendingPromptImageUrl(value: string): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  if (value.startsWith('blob:')) {
    return true;
  }
  if (!normalized.startsWith('data:image/') || !normalized.includes(';base64,')) {
    return false;
  }
  const commaIndex = value.indexOf(',');
  const base64 = commaIndex >= 0 ? value.slice(commaIndex + 1).trim() : '';
  return Boolean(base64) && base64.length % 4 !== 1 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64);
}
