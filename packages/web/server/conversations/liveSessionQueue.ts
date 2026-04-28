import type { AgentSession } from '@mariozechner/pi-coding-agent';

export interface QueuedPromptPreview {
  id: string;
  text: string;
  imageCount: number;
  restorable?: boolean;
}

export interface PromptImageAttachment {
  type: 'image';
  data: string;
  mimeType: string;
  name?: string;
}

export interface InternalQueuedAgentMessage {
  role?: string;
  content?: unknown;
  __personalAgentQueuedPromptId?: string;
}

interface InternalQueuedAgentQueueContainer {
  messages?: InternalQueuedAgentMessage[];
}

export type InternalQueuedAgentQueue = InternalQueuedAgentMessage[] | InternalQueuedAgentQueueContainer;

export interface InternalAgentQueues {
  steeringQueue?: InternalQueuedAgentQueue;
  followUpQueue?: InternalQueuedAgentQueue;
}

const INTERNAL_QUEUED_PROMPT_ID_FIELD = '__personalAgentQueuedPromptId';
let queuedPromptPreviewIdCounter = 0;

export function normalizeQueuedPromptBehavior(
  behavior: 'steer' | 'followUp' | undefined,
  options: { isStreaming: boolean; hasHiddenTurnQueued: boolean },
): 'steer' | 'followUp' | undefined {
  if (options.isStreaming) {
    return behavior ?? 'followUp';
  }

  if (options.hasHiddenTurnQueued) {
    return behavior ?? 'followUp';
  }

  return undefined;
}

function createQueuedPromptPreviewId(queueType: 'steer' | 'followUp'): string {
  queuedPromptPreviewIdCounter += 1;
  return `${queueType}-queued-${queuedPromptPreviewIdCounter}`;
}

function formatQueuedPromptPreviewText(text: string, imageCount: number): string {
  const normalizedText = text.trim();
  if (normalizedText) {
    return normalizedText;
  }

  if (imageCount > 0) {
    return '';
  }

  return '(empty queued prompt)';
}

function buildQueuedPromptPreview(
  id: string,
  text: string,
  imageCount: number,
  options: { restorable?: boolean } = {},
): QueuedPromptPreview {
  return {
    id,
    text: formatQueuedPromptPreviewText(text, imageCount),
    imageCount,
    ...(typeof options.restorable === 'boolean' ? { restorable: options.restorable } : {}),
  };
}

export function resolveInternalQueuedMessages(
  queue: InternalQueuedAgentQueue | undefined,
): InternalQueuedAgentMessage[] | undefined {
  if (Array.isArray(queue)) {
    return queue;
  }

  if (queue && typeof queue === 'object' && Array.isArray(queue.messages)) {
    return queue.messages;
  }

  return undefined;
}

function ensureQueuedPromptPreviewId(
  queueType: 'steer' | 'followUp',
  message: InternalQueuedAgentMessage,
): string {
  const existingId = message.__personalAgentQueuedPromptId?.trim();
  if (existingId) {
    return existingId;
  }

  const id = createQueuedPromptPreviewId(queueType);
  try {
    Object.defineProperty(message, INTERNAL_QUEUED_PROMPT_ID_FIELD, {
      value: id,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  } catch {
    message.__personalAgentQueuedPromptId = id;
  }
  return id;
}

export function createVisibleQueueFallbackPreview(
  queueType: 'steer' | 'followUp',
  index: number,
  text: string,
): QueuedPromptPreview {
  return buildQueuedPromptPreview(`${queueType}-visible-${index}`, text, 0, { restorable: true });
}

export function isVisibleQueueFallbackPreviewId(
  queueType: 'steer' | 'followUp',
  previewId?: string,
): boolean {
  const normalizedPreviewId = previewId?.trim() ?? '';
  return normalizedPreviewId.startsWith(`${queueType}-visible-`);
}

export function readQueuedPromptPreviews(
  queueType: 'steer' | 'followUp',
  visibleQueue: string[],
  internalQueue: InternalQueuedAgentQueue | undefined,
): QueuedPromptPreview[] {
  if (visibleQueue.length === 0) {
    return [];
  }

  const internalQueueMessages = resolveInternalQueuedMessages(internalQueue);
  if (!Array.isArray(internalQueueMessages)) {
    return visibleQueue.map((text, index) => createVisibleQueueFallbackPreview(queueType, index, text));
  }

  const internalUserQueue = internalQueueMessages.filter((queuedMessage): queuedMessage is InternalQueuedAgentMessage => queuedMessage?.role === 'user');
  if (internalUserQueue.length === 0) {
    return visibleQueue.map((text, index) => createVisibleQueueFallbackPreview(queueType, index, text));
  }

  const alignedInternalQueue = internalUserQueue.length > visibleQueue.length
    ? internalUserQueue.slice(internalUserQueue.length - visibleQueue.length)
    : internalUserQueue;

  const previews: QueuedPromptPreview[] = [];
  let searchStartIndex = 0;

  for (let index = 0; index < visibleQueue.length; index += 1) {
    const visibleText = visibleQueue[index] ?? '';
    let matchedPreview: QueuedPromptPreview | null = null;

    for (let searchIndex = searchStartIndex; searchIndex < alignedInternalQueue.length; searchIndex += 1) {
      const queuedMessage = alignedInternalQueue[searchIndex];
      const extracted = extractQueuedPromptContent(queuedMessage, visibleText);
      if (extracted.text !== visibleText) {
        continue;
      }

      matchedPreview = buildQueuedPromptPreview(
        ensureQueuedPromptPreviewId(queueType, queuedMessage),
        extracted.text,
        extracted.images.length,
      );
      searchStartIndex = searchIndex + 1;
      break;
    }

    previews.push(matchedPreview ?? createVisibleQueueFallbackPreview(queueType, index, visibleText));
  }

  return previews;
}

export function readQueueState(session: AgentSession): { steering: QueuedPromptPreview[]; followUp: QueuedPromptPreview[] } {
  const steer = typeof session.getSteeringMessages === 'function'
    ? session.getSteeringMessages()
    : [];
  const followUp = typeof session.getFollowUpMessages === 'function'
    ? session.getFollowUpMessages()
    : [];
  const internalAgent = session.agent as unknown as InternalAgentQueues | undefined;

  return {
    steering: readQueuedPromptPreviews('steer', [...steer], internalAgent?.steeringQueue),
    followUp: readQueuedPromptPreviews('followUp', [...followUp], internalAgent?.followUpQueue),
  };
}

export function removeQueuedUserMessage(
  queue: InternalQueuedAgentMessage[],
  input: { index: number; previewId?: string },
): { message: InternalQueuedAgentMessage; userQueueIndex: number } | undefined {
  const previewId = input.previewId?.trim() || '';
  let userQueueIndex = 0;

  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const queuedMessage = queue[queueIndex];
    if (queuedMessage?.role !== 'user') {
      continue;
    }

    const matchesPreviewId = previewId.length > 0
      && queuedMessage.__personalAgentQueuedPromptId === previewId;
    const matchesIndex = previewId.length === 0 && userQueueIndex === input.index;
    if (matchesPreviewId || matchesIndex) {
      return {
        message: queue.splice(queueIndex, 1)[0],
        userQueueIndex,
      };
    }

    userQueueIndex += 1;
  }

  return undefined;
}

export function extractQueuedPromptContent(
  message: InternalQueuedAgentMessage | undefined,
  fallbackText: string,
): { text: string; images: PromptImageAttachment[] } {
  const textParts: string[] = [];
  const images: PromptImageAttachment[] = [];
  const content = Array.isArray(message?.content) ? message.content : [];

  for (const part of content) {
    if (!part || typeof part !== 'object') {
      continue;
    }

    if ((part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string') {
      textParts.push((part as { text: string }).text);
      continue;
    }

    if ((part as { type?: unknown }).type === 'image'
      && typeof (part as { data?: unknown }).data === 'string'
      && typeof (part as { mimeType?: unknown }).mimeType === 'string') {
      const data = (part as { data: string }).data;
      const mimeType = (part as { mimeType: string }).mimeType.trim();
      if (!data || !mimeType) {
        continue;
      }

      const name = typeof (part as { name?: unknown }).name === 'string'
        ? (part as { name: string }).name.trim()
        : undefined;

      images.push({
        type: 'image',
        data,
        mimeType,
        ...(name ? { name } : {}),
      });
    }
  }

  const text = textParts.join('');

  return {
    text: text.trim().length > 0 ? text : fallbackText,
    images,
  };
}
