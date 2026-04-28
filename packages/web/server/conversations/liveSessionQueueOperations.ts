import type { AgentSession } from '@mariozechner/pi-coding-agent';
import {
  createVisibleQueueFallbackPreview,
  extractQueuedPromptContent,
  isVisibleQueueFallbackPreviewId,
  readQueuedPromptPreviews,
  removeQueuedUserMessage,
  resolveInternalQueuedMessages,
  type InternalAgentQueues,
  type PromptImageAttachment,
  type QueuedPromptPreview,
} from './liveSessionQueue.js';

export interface LiveSessionQueueHost {
  session: Pick<AgentSession,
    'agent'
    | 'getSteeringMessages'
    | 'getFollowUpMessages'
    | 'clearQueue'
    | 'steer'
    | 'followUp'
  >;
}

function readVisibleQueue(host: LiveSessionQueueHost, behavior: 'steer' | 'followUp'): string[] {
  return (behavior === 'steer'
    ? host.session.getSteeringMessages()
    : host.session.getFollowUpMessages()) as string[];
}

function readInternalAgentQueues(host: LiveSessionQueueHost): InternalAgentQueues {
  return host.session.agent as unknown as InternalAgentQueues;
}

async function replayQueues(
  host: LiveSessionQueueHost,
  remainingSteering: string[],
  remainingFollowUp: string[],
): Promise<void> {
  for (const queuedText of remainingSteering) {
    await host.session.steer(queuedText);
  }
  for (const queuedText of remainingFollowUp) {
    await host.session.followUp(queuedText);
  }
}

export async function restoreLiveSessionQueuedMessage(
  host: LiveSessionQueueHost,
  behavior: 'steer' | 'followUp',
  index: number,
  previewId?: string,
): Promise<{ text: string; images: PromptImageAttachment[] }> {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error('Queued message index must be a non-negative integer');
  }

  const visibleQueue = readVisibleQueue(host, behavior);
  const internalAgent = readInternalAgentQueues(host);
  const internalQueue = resolveInternalQueuedMessages(behavior === 'steer'
    ? internalAgent.steeringQueue
    : internalAgent.followUpQueue);

  if (!Array.isArray(internalQueue) || isVisibleQueueFallbackPreviewId(behavior, previewId)) {
    const normalizedPreviewId = previewId?.trim() || '';
    const previews = visibleQueue.map((text, previewIndex) => createVisibleQueueFallbackPreview(behavior, previewIndex, text));
    const previewIndex = normalizedPreviewId
      ? previews.findIndex((preview) => preview.id === normalizedPreviewId)
      : -1;
    const restoreIndex = previewIndex >= 0 ? previewIndex : index;

    if (restoreIndex >= visibleQueue.length) {
      throw new Error('Queued prompt changed before it could be restored. Try again.');
    }

    if (normalizedPreviewId && previewIndex < 0) {
      throw new Error('Queued prompt changed before it could be restored. Try again.');
    }

    const cleared = host.session.clearQueue();
    const restoreQueue = behavior === 'steer' ? cleared.steering : cleared.followUp;
    const restoredText = restoreQueue[restoreIndex] ?? visibleQueue[restoreIndex] ?? '';
    const remainingSteering = behavior === 'steer'
      ? cleared.steering.filter((_, queueIndex) => queueIndex !== restoreIndex)
      : cleared.steering;
    const remainingFollowUp = behavior === 'followUp'
      ? cleared.followUp.filter((_, queueIndex) => queueIndex !== restoreIndex)
      : cleared.followUp;

    await replayQueues(host, remainingSteering, remainingFollowUp);
    return { text: restoredText, images: [] };
  }

  const previewIndex = previewId
    ? readQueuedPromptPreviews(behavior, [...visibleQueue], behavior === 'steer'
      ? internalAgent.steeringQueue
      : internalAgent.followUpQueue).findIndex((preview) => preview.id === previewId.trim())
    : -1;
  const removed = removeQueuedUserMessage(internalQueue, { index, previewId });
  if (!removed) {
    throw new Error('Queued prompt changed before it could be restored. Try again.');
  }

  const visibleQueueIndex = previewIndex >= 0 ? previewIndex : index;
  const fallbackText = visibleQueue[visibleQueueIndex] ?? visibleQueue[index] ?? '';
  if (visibleQueueIndex < visibleQueue.length) {
    visibleQueue.splice(visibleQueueIndex, 1);
  }

  return extractQueuedPromptContent(removed.message, fallbackText);
}

export async function cancelLiveSessionQueuedPrompt(
  host: LiveSessionQueueHost,
  behavior: 'steer' | 'followUp',
  previewId: string,
): Promise<QueuedPromptPreview> {
  const normalizedPreviewId = previewId.trim();
  if (!normalizedPreviewId) {
    throw new Error('Queued prompt id is required');
  }

  const visibleQueue = readVisibleQueue(host, behavior);
  const internalAgent = readInternalAgentQueues(host);
  const queueContainer = behavior === 'steer'
    ? internalAgent.steeringQueue
    : internalAgent.followUpQueue;
  const internalQueue = resolveInternalQueuedMessages(queueContainer);
  const previews = readQueuedPromptPreviews(behavior, [...visibleQueue], queueContainer);
  const previewIndex = previews.findIndex((preview) => preview.id === normalizedPreviewId);
  if (previewIndex < 0) {
    throw new Error('Queued prompt changed before it could be cancelled. Try again.');
  }

  const cancelledPreview = previews[previewIndex] as QueuedPromptPreview;

  if (!Array.isArray(internalQueue) || isVisibleQueueFallbackPreviewId(behavior, normalizedPreviewId)) {
    if (typeof host.session.clearQueue !== 'function') {
      throw new Error('Queued prompt changed before it could be cancelled. Try again.');
    }

    const cleared = host.session.clearQueue();
    const remainingSteering = behavior === 'steer'
      ? cleared.steering.filter((_, queueIndex) => queueIndex !== previewIndex)
      : cleared.steering;
    const remainingFollowUp = behavior === 'followUp'
      ? cleared.followUp.filter((_, queueIndex) => queueIndex !== previewIndex)
      : cleared.followUp;

    await replayQueues(host, remainingSteering, remainingFollowUp);
    return cancelledPreview;
  }

  const removed = removeQueuedUserMessage(internalQueue, {
    index: previewIndex,
    previewId: normalizedPreviewId,
  });
  if (!removed) {
    throw new Error('Queued prompt changed before it could be cancelled. Try again.');
  }

  if (previewIndex < visibleQueue.length) {
    visibleQueue.splice(previewIndex, 1);
  }

  return cancelledPreview;
}
