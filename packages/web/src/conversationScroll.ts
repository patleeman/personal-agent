import type { MessageBlock } from './types';

const DEFAULT_SCROLL_TO_BOTTOM_THRESHOLD_PX = 40;
const DEFAULT_BOTTOM_SETTLE_STABLE_FRAME_COUNT = 2;
const DEFAULT_BOTTOM_SETTLE_MAX_FRAMES = 45;

export interface ConversationScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function getConversationInitialScrollKey(
  conversationId: string | null | undefined,
  options: { isLiveSession: boolean; hasLiveSnapshot: boolean },
): string | null {
  if (!conversationId) {
    return null;
  }

  return `${conversationId}:${options.isLiveSession && !options.hasLiveSnapshot ? 'provisional' : 'settled'}`;
}

export function getConversationBottomScrollTop(
  metrics: Pick<ConversationScrollMetrics, 'scrollHeight' | 'clientHeight'>,
): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

export function getConversationPrependRestoreScrollTop(
  metrics: {
    previousScrollHeight: number;
    previousScrollTop: number;
    nextScrollHeight: number;
    nextClientHeight: number;
    stickToBottom: boolean;
  },
): number {
  if (metrics.stickToBottom) {
    return getConversationBottomScrollTop({
      scrollHeight: metrics.nextScrollHeight,
      clientHeight: metrics.nextClientHeight,
    });
  }

  const delta = metrics.nextScrollHeight - metrics.previousScrollHeight;
  return metrics.previousScrollTop + Math.max(0, delta);
}

export function isConversationScrolledToBottom(
  metrics: ConversationScrollMetrics,
  thresholdPx = DEFAULT_SCROLL_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  return getConversationBottomScrollTop(metrics) - metrics.scrollTop < thresholdPx;
}

export function getConversationTailBlockKey(block: MessageBlock | null | undefined): string | null {
  if (!block) {
    return null;
  }

  switch (block.type) {
    case 'tool_use':
      return `tool_use:${block.id ?? block._toolCallId ?? block.ts}`;
    case 'summary':
      return `summary:${block.id ?? `${block.kind}:${block.ts}`}`;
    case 'context':
      return `context:${block.id ?? `${block.customType ?? 'default'}:${block.ts}`}`;
    default:
      return `${block.type}:${block.id ?? block.ts}`;
  }
}

export function shouldAutoScrollToStreamingTail(
  previousTailKey: string | null,
  nextTailBlock: MessageBlock | null | undefined,
): boolean {
  const nextTailKey = getConversationTailBlockKey(nextTailBlock);
  if (nextTailKey === null) {
    return false;
  }

  if (nextTailKey !== previousTailKey) {
    return true;
  }

  return nextTailBlock?.type === 'text'
    || nextTailBlock?.type === 'thinking'
    || nextTailBlock?.type === 'tool_use';
}

export function shouldShowScrollToBottomControl(messageCount: number, atBottom: boolean): boolean {
  return messageCount > 0 && !atBottom;
}

export function shouldContinueConversationBottomSettle(
  state: {
    frameCount: number;
    stableFrames: number;
    minFrames?: number;
    stableFrameCount?: number;
    maxFrames?: number;
  },
): boolean {
  const minFrames = Math.max(0, state.minFrames ?? 0);
  const stableFrameCount = Math.max(1, state.stableFrameCount ?? DEFAULT_BOTTOM_SETTLE_STABLE_FRAME_COUNT);
  const maxFrames = Math.max(minFrames, state.maxFrames ?? DEFAULT_BOTTOM_SETTLE_MAX_FRAMES);

  if (state.frameCount >= maxFrames) {
    return false;
  }

  if (state.frameCount < minFrames) {
    return true;
  }

  return state.stableFrames < stableFrameCount;
}
