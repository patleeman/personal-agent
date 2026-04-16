import { clearConversationComposerDraft } from '../conversation/forking';
import { clearStoredState, getSessionStorage, persistStoredState, readStoredState, type StorageLike } from '../local/reloadState';
import type { InjectedPromptMessage, PromptAttachmentRefInput, PromptImageInput } from '../types';

export interface PendingConversationPrompt {
  text: string;
  behavior?: 'steer' | 'followUp';
  images: PromptImageInput[];
  attachmentRefs: PromptAttachmentRefInput[];
  contextMessages?: Array<Pick<InjectedPromptMessage, 'customType' | 'content'>>;
  relatedConversationIds?: string[];
}

const inMemoryPendingPrompts = new Map<string, PendingConversationPrompt>();
const inFlightPendingPromptDispatches = new Set<string>();
const PENDING_CONVERSATION_PROMPT_DISPATCHING_STALE_MS = 90_000;

function normalizePendingPromptContextMessages(value: unknown): Array<Pick<InjectedPromptMessage, 'customType' | 'content'>> {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((message): message is { customType: string; content: string } => (
      !!message
      && typeof message === 'object'
      && typeof message.customType === 'string'
      && message.customType.trim().length > 0
      && typeof message.content === 'string'
    ))
    .map((message) => ({
      customType: message.customType.trim(),
      content: message.content,
    }));
}

function normalizePendingRelatedConversationIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== 'string') {
      continue;
    }

    const normalized = candidate.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ids.push(normalized);
  }

  return ids;
}

export const PENDING_CONVERSATION_PROMPT_CHANGED_EVENT = 'pa:pending-conversation-prompt-changed';

export interface PendingConversationPromptChangedDetail {
  sessionId: string;
  prompt: PendingConversationPrompt | null;
  dispatching: boolean;
}

function emitPendingConversationPromptChanged(
  sessionId: string,
  prompt: PendingConversationPrompt | null,
  storage: StorageLike | null = getSessionStorage(),
): void {
  if (typeof window === 'undefined' || !sessionId) {
    return;
  }

  window.dispatchEvent(new CustomEvent<PendingConversationPromptChangedDetail>(
    PENDING_CONVERSATION_PROMPT_CHANGED_EVENT,
    {
      detail: {
        sessionId,
        prompt,
        dispatching: isPendingConversationPromptDispatching(sessionId, storage),
      },
    },
  ));
}

export function buildPendingConversationPromptStorageKey(sessionId: string): string {
  return `pa:reload:conversation:${sessionId}:pending-prompt`;
}

export function buildPendingConversationPromptDispatchingStorageKey(sessionId: string): string {
  return `pa:reload:conversation:${sessionId}:pending-prompt-dispatching`;
}

function readPendingConversationPromptDispatchingAt(
  sessionId: string,
  storage: StorageLike | null = getSessionStorage(),
): number | null {
  if (!sessionId) {
    return null;
  }

  return readStoredState<number | null>({
    key: buildPendingConversationPromptDispatchingStorageKey(sessionId),
    fallback: null,
    storage,
    deserialize: (raw) => {
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    },
  });
}

export function persistPendingConversationPrompt(
  sessionId: string,
  prompt: PendingConversationPrompt,
  storage: StorageLike | null = getSessionStorage(),
): void {
  if (!sessionId) {
    return;
  }

  const contextMessages = normalizePendingPromptContextMessages(prompt.contextMessages);
  const relatedConversationIds = normalizePendingRelatedConversationIds(prompt.relatedConversationIds);
  const nextPrompt: PendingConversationPrompt = {
    text: prompt.text,
    ...(prompt.behavior ? { behavior: prompt.behavior } : {}),
    images: prompt.images,
    attachmentRefs: prompt.attachmentRefs,
    ...(contextMessages.length > 0 ? { contextMessages } : {}),
    ...(relatedConversationIds.length > 0 ? { relatedConversationIds } : {}),
  };

  const shouldPersist = nextPrompt.text.trim().length > 0
    || nextPrompt.images.length > 0
    || nextPrompt.attachmentRefs.length > 0
    || contextMessages.length > 0
    || relatedConversationIds.length > 0;
  if (!shouldPersist) {
    inMemoryPendingPrompts.delete(sessionId);
  } else {
    inMemoryPendingPrompts.set(sessionId, nextPrompt);
  }

  persistStoredState({
    key: buildPendingConversationPromptStorageKey(sessionId),
    value: nextPrompt,
    storage,
    shouldPersist: () => shouldPersist,
  });
  emitPendingConversationPromptChanged(sessionId, shouldPersist ? nextPrompt : null, storage);
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
      const contextMessages = normalizePendingPromptContextMessages(parsed.contextMessages);
      const relatedConversationIds = normalizePendingRelatedConversationIds(parsed.relatedConversationIds);

      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        behavior: parsed.behavior === 'steer' || parsed.behavior === 'followUp'
          ? parsed.behavior
          : undefined,
        images,
        attachmentRefs,
        ...(contextMessages.length > 0 ? { contextMessages } : {}),
        ...(relatedConversationIds.length > 0 ? { relatedConversationIds } : {}),
      };
    },
  });
}

export function consumePendingConversationPrompt(
  sessionId: string,
  storage: StorageLike | null = getSessionStorage(),
): PendingConversationPrompt | null {
  const prompt = readPendingConversationPrompt(sessionId, storage);
  if (!prompt) {
    return null;
  }

  clearPendingConversationPrompt(sessionId, storage);
  clearConversationComposerDraft(sessionId, storage);
  return prompt;
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
  emitPendingConversationPromptChanged(sessionId, null, storage);
}

export function isPendingConversationPromptDispatching(
  sessionId: string,
  storage: StorageLike | null = getSessionStorage(),
): boolean {
  if (!sessionId) {
    return false;
  }

  if (inFlightPendingPromptDispatches.has(sessionId)) {
    return true;
  }

  const dispatchingAt = readPendingConversationPromptDispatchingAt(sessionId, storage);
  return dispatchingAt !== null && (Date.now() - dispatchingAt) < PENDING_CONVERSATION_PROMPT_DISPATCHING_STALE_MS;
}

export function setPendingConversationPromptDispatching(
  sessionId: string,
  dispatching: boolean,
  storage: StorageLike | null = getSessionStorage(),
): void {
  if (!sessionId) {
    return;
  }

  if (dispatching) {
    inFlightPendingPromptDispatches.add(sessionId);
  } else {
    inFlightPendingPromptDispatches.delete(sessionId);
  }

  persistStoredState({
    key: buildPendingConversationPromptDispatchingStorageKey(sessionId),
    value: Date.now(),
    storage,
    serialize: (value) => String(value),
    shouldPersist: () => dispatching,
  });

  emitPendingConversationPromptChanged(sessionId, readPendingConversationPrompt(sessionId, storage), storage);
}
