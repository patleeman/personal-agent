import { clearStoredState, getSessionStorage, persistStoredState, readStoredState, type StorageLike } from './reloadState';
import type { PromptAttachmentRefInput, PromptImageInput } from './types';

export interface PendingConversationPrompt {
  text: string;
  behavior?: 'steer' | 'followUp';
  images: PromptImageInput[];
  attachmentRefs: PromptAttachmentRefInput[];
}

const inMemoryPendingPrompts = new Map<string, PendingConversationPrompt>();

export function buildPendingConversationPromptStorageKey(sessionId: string): string {
  return `pa:reload:conversation:${sessionId}:pending-prompt`;
}

export function persistPendingConversationPrompt(
  sessionId: string,
  prompt: PendingConversationPrompt,
  storage: StorageLike | null = getSessionStorage(),
): void {
  if (!sessionId) {
    return;
  }

  const shouldPersist = prompt.text.trim().length > 0 || prompt.images.length > 0 || prompt.attachmentRefs.length > 0;
  if (!shouldPersist) {
    inMemoryPendingPrompts.delete(sessionId);
  } else {
    inMemoryPendingPrompts.set(sessionId, prompt);
  }

  persistStoredState({
    key: buildPendingConversationPromptStorageKey(sessionId),
    value: prompt,
    storage,
    shouldPersist: () => shouldPersist,
  });
}

export function readPendingConversationPrompt(
  sessionId: string,
  storage: StorageLike | null = getSessionStorage(),
): PendingConversationPrompt | null {
  if (!sessionId) {
    return null;
  }

  const inMemory = inMemoryPendingPrompts.get(sessionId);
  if (inMemory) {
    return inMemory;
  }

  return readStoredState<PendingConversationPrompt | null>({
    key: buildPendingConversationPromptStorageKey(sessionId),
    fallback: null,
    storage,
    deserialize: (raw) => {
      const parsed = JSON.parse(raw) as Partial<PendingConversationPrompt> | null;
      if (!parsed || typeof parsed !== 'object') {
        return null;
      }

      const images = Array.isArray(parsed.images)
        ? parsed.images
          .filter((image): image is PromptImageInput => (
            !!image
            && typeof image === 'object'
            && typeof image.mimeType === 'string'
            && typeof image.data === 'string'
          ))
          .map((image) => ({
            mimeType: image.mimeType,
            data: image.data,
            ...(typeof image.name === 'string' ? { name: image.name } : {}),
            ...(typeof image.previewUrl === 'string' ? { previewUrl: image.previewUrl } : {}),
          }))
        : [];

      const attachmentRefs = Array.isArray(parsed.attachmentRefs)
        ? parsed.attachmentRefs
          .filter((attachmentRef): attachmentRef is { attachmentId: string; revision?: number } => (
            !!attachmentRef
            && typeof attachmentRef === 'object'
            && typeof attachmentRef.attachmentId === 'string'
            && attachmentRef.attachmentId.trim().length > 0
            && (attachmentRef.revision === undefined
              || (Number.isInteger(attachmentRef.revision) && attachmentRef.revision > 0))
          ))
          .map((attachmentRef) => ({
            attachmentId: attachmentRef.attachmentId.trim(),
            ...(attachmentRef.revision ? { revision: attachmentRef.revision } : {}),
          }))
        : [];

      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        behavior: parsed.behavior === 'steer' || parsed.behavior === 'followUp'
          ? parsed.behavior
          : undefined,
        images,
        attachmentRefs,
      };
    },
  });
}

export function clearPendingConversationPrompt(
  sessionId: string,
  storage: StorageLike | null = getSessionStorage(),
): void {
  if (!sessionId) {
    return;
  }

  inMemoryPendingPrompts.delete(sessionId);
  clearStoredState(storage, buildPendingConversationPromptStorageKey(sessionId));
}
