import { clearConversationComposerDraft } from '../conversation/forking';
import { clearStoredState, getSessionStorage, persistStoredState, readStoredState, type StorageLike } from '../local/reloadState';
import type { InjectedPromptMessage, PromptAttachmentRefInput, PromptImageInput } from '../shared/types';

export interface PendingConversationPrompt {
  text: string;
  behavior?: 'steer' | 'followUp';
  images: PromptImageInput[];
  attachmentRefs: PromptAttachmentRefInput[];
  contextMessages?: Array<Pick<InjectedPromptMessage, 'customType' | 'content'>>;
  relatedConversationIds?: string[];
}

const inMemoryPendingPrompts = new Map<string, PendingConversationPrompt>();
const inFlightPendingPromptDispatches = new Map<string, number>();
const PENDING_CONVERSATION_PROMPT_DISPATCHING_STALE_MS = 90_000;
const MAX_PENDING_ATTACHMENT_REVISION = 1_000_000;

function normalizePendingPromptContextMessages(value: unknown): Array<Pick<InjectedPromptMessage, 'customType' | 'content'>> {
  if (!Array.isArray(value)) {
    return [];
  }

  const messages: Array<Pick<InjectedPromptMessage, 'customType' | 'content'>> = [];
  const seen = new Set<string>();

  for (const message of value) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    const customType =
      typeof (message as { customType?: unknown }).customType === 'string' ? (message as { customType: string }).customType.trim() : '';
    const content = typeof (message as { content?: unknown }).content === 'string' ? (message as { content: string }).content.trim() : '';
    if (!customType || !content) {
      continue;
    }

    const dedupeKey = `${customType}\n${content}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    messages.push({ customType, content });
  }

  return messages;
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

function normalizePendingPromptAttachmentRefs(value: unknown): PromptAttachmentRefInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const refs: PromptAttachmentRefInput[] = [];
  const seen = new Set<string>();

  for (const attachmentRef of value) {
    if (!attachmentRef || typeof attachmentRef !== 'object') {
      continue;
    }

    const attachmentId =
      typeof (attachmentRef as { attachmentId?: unknown }).attachmentId === 'string'
        ? (attachmentRef as { attachmentId: string }).attachmentId.trim()
        : '';
    const revision = (attachmentRef as { revision?: unknown }).revision;
    if (
      !attachmentId ||
      (revision !== undefined && (!Number.isSafeInteger(revision) || revision <= 0 || revision > MAX_PENDING_ATTACHMENT_REVISION))
    ) {
      continue;
    }

    const dedupeKey = `${attachmentId}:${String(revision ?? 'latest')}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    refs.push({
      attachmentId,
      ...(revision ? { revision } : {}),
    });
  }

  return refs;
}

function normalizePendingPromptImageData(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function normalizePendingPromptImages(value: unknown): PromptImageInput[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((image) => {
    if (!image || typeof image !== 'object') {
      return [];
    }

    const mimeType = typeof (image as { mimeType?: unknown }).mimeType === 'string' ? (image as { mimeType: string }).mimeType.trim() : '';
    const data = normalizePendingPromptImageData((image as { data?: unknown }).data);
    if (!mimeType.toLowerCase().startsWith('image/') || !data) {
      return [];
    }
    const previewUrl = normalizePendingPromptImagePreviewUrl((image as { previewUrl?: unknown }).previewUrl);

    return [
      {
        mimeType,
        data,
        ...(typeof (image as { name?: unknown }).name === 'string' && (image as { name: string }).name.trim().length > 0
          ? { name: (image as { name: string }).name.trim() }
          : {}),
        ...(previewUrl ? { previewUrl } : {}),
      },
    ];
  });
}

function normalizePendingPromptImagePreviewUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const previewUrl = value.trim();
  if (!previewUrl) {
    return undefined;
  }

  const lowerPreviewUrl = previewUrl.toLowerCase();
  if (previewUrl.startsWith('blob:')) {
    return previewUrl;
  }
  if (!lowerPreviewUrl.startsWith('data:image/') || !lowerPreviewUrl.includes(';base64,')) {
    return undefined;
  }
  const commaIndex = previewUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? previewUrl.slice(commaIndex + 1).trim() : '';
  return base64 && base64.length % 4 !== 1 && /^[A-Za-z0-9+/]+={0,2}$/.test(base64) ? previewUrl : undefined;
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

  window.dispatchEvent(
    new CustomEvent<PendingConversationPromptChangedDetail>(PENDING_CONVERSATION_PROMPT_CHANGED_EVENT, {
      detail: {
        sessionId,
        prompt,
        dispatching: isPendingConversationPromptDispatching(sessionId, storage),
      },
    }),
  );
}

function buildPendingConversationPromptStorageKey(sessionId: string): string {
  return `pa:reload:conversation:${sessionId}:pending-prompt`;
}

function buildPendingConversationPromptDispatchingStorageKey(sessionId: string): string {
  return `pa:reload:conversation:${sessionId}:pending-prompt-dispatching`;
}

function readPendingConversationPromptDispatchingAt(sessionId: string, storage: StorageLike | null = getSessionStorage()): number | null {
  if (!sessionId) {
    return null;
  }

  return readStoredState<number | null>({
    key: buildPendingConversationPromptDispatchingStorageKey(sessionId),
    fallback: null,
    storage,
    deserialize: (raw) => {
      const normalized = raw.trim();
      const parsed = /^\d+$/.test(normalized) ? Number.parseInt(normalized, 10) : Number.NaN;
      return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
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
  const attachmentRefs = normalizePendingPromptAttachmentRefs(prompt.attachmentRefs);
  const images = normalizePendingPromptImages(prompt.images);
  const nextPrompt: PendingConversationPrompt = {
    text: prompt.text,
    ...(prompt.behavior ? { behavior: prompt.behavior } : {}),
    images,
    attachmentRefs,
    ...(contextMessages.length > 0 ? { contextMessages } : {}),
    ...(relatedConversationIds.length > 0 ? { relatedConversationIds } : {}),
  };

  const shouldPersist =
    nextPrompt.text.trim().length > 0 ||
    images.length > 0 ||
    attachmentRefs.length > 0 ||
    contextMessages.length > 0 ||
    relatedConversationIds.length > 0;
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

      const images = normalizePendingPromptImages(parsed.images);
      const attachmentRefs = normalizePendingPromptAttachmentRefs(parsed.attachmentRefs);
      const contextMessages = normalizePendingPromptContextMessages(parsed.contextMessages);
      const relatedConversationIds = normalizePendingRelatedConversationIds(parsed.relatedConversationIds);
      const text = typeof parsed.text === 'string' ? parsed.text : '';

      if (
        text.trim().length === 0 &&
        images.length === 0 &&
        attachmentRefs.length === 0 &&
        contextMessages.length === 0 &&
        relatedConversationIds.length === 0
      ) {
        return null;
      }

      return {
        text,
        behavior: parsed.behavior === 'steer' || parsed.behavior === 'followUp' ? parsed.behavior : undefined,
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

export function clearPendingConversationPrompt(sessionId: string, storage: StorageLike | null = getSessionStorage()): void {
  if (!sessionId) {
    return;
  }

  inMemoryPendingPrompts.delete(sessionId);
  clearStoredState(storage, buildPendingConversationPromptStorageKey(sessionId));
  emitPendingConversationPromptChanged(sessionId, null, storage);
}

export function isPendingConversationPromptDispatching(sessionId: string, storage: StorageLike | null = getSessionStorage()): boolean {
  if (!sessionId) {
    return false;
  }

  const inFlightStartedAt = inFlightPendingPromptDispatches.get(sessionId);
  if (inFlightStartedAt !== undefined) {
    const inFlightAgeMs = Date.now() - inFlightStartedAt;
    if (Number.isSafeInteger(inFlightAgeMs) && inFlightAgeMs >= 0 && inFlightAgeMs < PENDING_CONVERSATION_PROMPT_DISPATCHING_STALE_MS) {
      return true;
    }
    inFlightPendingPromptDispatches.delete(sessionId);
  }

  const dispatchingAt = readPendingConversationPromptDispatchingAt(sessionId, storage);
  const ageMs = dispatchingAt === null ? Number.NaN : Date.now() - dispatchingAt;
  return Number.isSafeInteger(ageMs) && ageMs >= 0 && ageMs < PENDING_CONVERSATION_PROMPT_DISPATCHING_STALE_MS;
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
    inFlightPendingPromptDispatches.set(sessionId, Date.now());
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
