import type { PendingConversationPrompt } from './pendingConversationPrompt';
import type { MessageBlock } from './types';

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
    src: image.previewUrl,
    mimeType: image.mimeType,
    caption: image.name,
  }));

  if (!text && images.length === 0) {
    return messages;
  }

  const existingMessages = messages ?? [];
  const lastMessage = existingMessages[existingMessages.length - 1];
  const lastImageCount = lastMessage?.type === 'user' ? lastMessage.images?.length ?? 0 : -1;
  const nextImageCount = images.length;
  const alreadyVisible = lastMessage?.type === 'user'
    && lastMessage.text === text
    && lastImageCount === nextImageCount;

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
