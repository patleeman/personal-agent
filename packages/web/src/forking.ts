import type { MessageBlock } from './types';

export interface ForkableMessageEntry {
  entryId: string;
  text: string;
}

export function resolveForkEntryForMessage(
  messages: MessageBlock[],
  messageIndex: number,
  entries: ForkableMessageEntry[],
): ForkableMessageEntry | null {
  if (messageIndex < 0 || entries.length === 0) {
    return null;
  }

  const userMessageCount = messages
    .slice(0, messageIndex + 1)
    .reduce((count, message) => count + (message.type === 'user' ? 1 : 0), 0);

  if (userMessageCount === 0) {
    return null;
  }

  return entries[userMessageCount - 1] ?? entries[entries.length - 1] ?? null;
}

export function buildConversationHref(sessionId: string, currentHref: string): string {
  return new URL(`/conversations/${sessionId}`, currentHref).toString();
}
