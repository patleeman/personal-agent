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

export function resolveSessionEntryIdFromBlockId(blockId: string | undefined): string | null {
  const initial = blockId?.trim();
  if (!initial) {
    return null;
  }

  let candidate = initial;
  const seen = new Set<string>();

  while (!seen.has(candidate)) {
    seen.add(candidate);
    const trimmed = candidate.match(/^(.*)-[txcei]\d+$/)?.[1]?.trim();
    if (!trimmed) {
      break;
    }
    candidate = trimmed;
  }

  return candidate;
}

export function buildConversationComposerStorageKey(sessionId: string): string {
  return `pa:reload:conversation:${sessionId}:composer`;
}

export function clearConversationComposerDraft(
  sessionId: string,
  storage: StorageLike | null = getSessionStorage(),
): void {
  if (!sessionId || !storage) {
    return;
  }

  try {
    storage.removeItem(buildConversationComposerStorageKey(sessionId));
  } catch {
    // Ignore storage failures.
  }
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
      clearConversationComposerDraft(sessionId, storage);
      return;
    }

    storage.setItem(key, JSON.stringify(prompt));
  } catch {
    // Ignore storage failures.
  }
}

