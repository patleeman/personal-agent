import { getSessionStorage, type StorageLike } from './reloadState';
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

export function buildConversationComposerStorageKey(sessionId: string): string {
  return `pa:reload:conversation:${sessionId}:composer`;
}

export function persistForkPromptDraft(
  sessionId: string,
  prompt: string,
  storage: StorageLike | null = getSessionStorage(),
): void {
  if (!sessionId || !storage) {
    return;
  }

  const key = buildConversationComposerStorageKey(sessionId);

  try {
    if (prompt.length === 0) {
      storage.removeItem(key);
      return;
    }

    storage.setItem(key, JSON.stringify(prompt));
  } catch {
    // Ignore storage failures.
  }
}

