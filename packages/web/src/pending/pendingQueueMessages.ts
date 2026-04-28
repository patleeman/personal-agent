import type { PendingConversationPrompt } from './pendingConversationPrompt';
import type { MessageBlock, QueuedPromptPreview } from '../shared/types';

export interface ConversationPendingQueueItem {
  id: string;
  text: string;
  imageCount: number;
  restorable: boolean;
  type: 'steer' | 'followUp';
  queueIndex: number;
}

export function buildConversationPendingQueueItems(input: {
  steering: QueuedPromptPreview[];
  followUp: QueuedPromptPreview[];
}): ConversationPendingQueueItem[] {
  return [
    ...input.steering.map((item, index) => ({
      id: item.id,
      text: item.text,
      imageCount: item.imageCount,
      restorable: item.restorable !== false,
      type: 'steer' as const,
      queueIndex: index,
    })),
    ...input.followUp.map((item, index) => ({
      id: item.id,
      text: item.text,
      imageCount: item.imageCount,
      restorable: item.restorable !== false,
      type: 'followUp' as const,
      queueIndex: index,
    })),
  ];
}

export function resolveRestoredQueuedPromptComposerUpdate(input: {
  restoredText: string;
  currentInput: string;
  restoredFileCount: number;
}): {
  hasRestoredText: boolean;
  hasContent: boolean;
  nextInput: string | null;
  noticeText: string;
} {
  const hasRestoredText = input.restoredText.trim().length > 0;
  const restoredFileCount = Math.max(0, input.restoredFileCount);
  const parts = [
    hasRestoredText ? 'text' : null,
    restoredFileCount > 0 ? `${restoredFileCount} image${restoredFileCount === 1 ? '' : 's'}` : null,
  ].filter((value): value is string => Boolean(value));

  return {
    hasRestoredText,
    hasContent: hasRestoredText || restoredFileCount > 0,
    nextInput: hasRestoredText
      ? [input.restoredText, input.currentInput].filter((value) => value.trim().length > 0).join('\n\n')
      : null,
    noticeText: `Restored queued ${parts.join(' + ')} to the composer.`,
  };
}

export function appendPendingInitialPromptBlock(
  messages: MessageBlock[] | undefined,
  pendingPrompt: PendingConversationPrompt | null,
  now = new Date().toISOString(),
): MessageBlock[] | undefined {
  if (!pendingPrompt) {
    return messages;
  }

  const text = pendingPrompt.text.trim();
  const images = pendingPrompt.images.map((image, index) => ({
    alt: image.name?.trim() || `Pending image ${index + 1}`,
    src: safePendingImagePreviewUrl(image.previewUrl) ?? `data:${image.mimeType};base64,${image.data}`,
    mimeType: image.mimeType,
    caption: image.name,
  }));

  if (!text && images.length === 0) {
    return messages;
  }

  const existingMessages = messages ?? [];
  const lastMessage = existingMessages[existingMessages.length - 1];
  const lastImages = lastMessage?.type === 'user' ? lastMessage.images ?? [] : [];
  const imagesMatch = lastImages.length === images.length
    && images.every((image, index) => {
      const lastImage = lastImages[index];
      return lastImage?.src === image.src
        && (lastImage?.mimeType?.trim().toLowerCase() || '') === image.mimeType.trim().toLowerCase()
        && lastImage?.caption === image.caption;
    });
  const alreadyVisible = lastMessage?.type === 'user'
    && lastMessage.text === text
    && imagesMatch;

  if (alreadyVisible) {
    return existingMessages;
  }

  return [
    ...existingMessages,
    {
      type: 'user',
      id: 'pending-initial-prompt',
      ts: now,
      text,
      ...(images.length > 0 ? { images } : {}),
    },
  ];
}

function safePendingImagePreviewUrl(previewUrl: string | undefined): string | undefined {
  const normalized = previewUrl?.trim();
  if (!normalized) {
    return undefined;
  }

  const lowerPreviewUrl = normalized.toLowerCase();
  if (normalized.startsWith('blob:')) {
    return normalized;
  }
  if (!lowerPreviewUrl.startsWith('data:image/') || !lowerPreviewUrl.includes(';base64,')) {
    return undefined;
  }
  const commaIndex = normalized.indexOf(',');
  const base64 = commaIndex >= 0 ? normalized.slice(commaIndex + 1).trim() : '';
  return base64
    && base64.length % 4 !== 1
    && /^[A-Za-z0-9+/]+={0,2}$/.test(base64)
    ? normalized
    : undefined;
}
