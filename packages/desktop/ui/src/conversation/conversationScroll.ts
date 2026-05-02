import type { MessageBlock } from '../shared/types';

const DEFAULT_SCROLL_TO_BOTTOM_THRESHOLD_PX = 40;
const CONVERSATION_TAIL_SELECTOR = '[data-chat-tail="1"]';
const DEFAULT_BOTTOM_SETTLE_STABLE_FRAME_COUNT = 2;
const DEFAULT_BOTTOM_SETTLE_MAX_FRAMES = 45;

interface ConversationScrollMetrics {
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

export function getConversationBottomScrollTop(metrics: Pick<ConversationScrollMetrics, 'scrollHeight' | 'clientHeight'>): number {
  return Math.max(0, metrics.scrollHeight - metrics.clientHeight);
}

export function getConversationPrependRestoreScrollTop(metrics: {
  previousScrollHeight: number;
  previousScrollTop: number;
  nextScrollHeight: number;
  nextClientHeight: number;
  stickToBottom: boolean;
}): number {
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

type TailQueryRoot = Pick<ParentNode, 'querySelector'>;

type TailRectReadable = {
  getBoundingClientRect?: () => { top: number; bottom: number };
};

export function scrollConversationTailIntoView(
  root: TailQueryRoot | null | undefined,
  options?: Pick<ScrollIntoViewOptions, 'behavior'>,
): boolean {
  const tail = root?.querySelector(CONVERSATION_TAIL_SELECTOR) as
    | { scrollIntoView?: (options?: ScrollIntoViewOptions) => void }
    | null
    | undefined;
  if (!tail || typeof tail.scrollIntoView !== 'function') {
    return false;
  }

  tail.scrollIntoView({
    block: 'end',
    inline: 'nearest',
    ...(options?.behavior ? { behavior: options.behavior } : {}),
  });
  return true;
}

export function isConversationTailVisibleAtBottom(
  container: (TailQueryRoot & TailRectReadable) | null | undefined,
  thresholdPx = DEFAULT_SCROLL_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  const tail = container?.querySelector(CONVERSATION_TAIL_SELECTOR) as TailRectReadable | null | undefined;
  if (!container || typeof container.getBoundingClientRect !== 'function' || !tail || typeof tail.getBoundingClientRect !== 'function') {
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const tailRect = tail.getBoundingClientRect();
  return tailRect.bottom <= containerRect.bottom + thresholdPx && tailRect.bottom >= containerRect.bottom - thresholdPx;
}

export function shouldAutoScrollToStreamingTail(previousTailKey: string | null, nextTailBlock: MessageBlock | null | undefined): boolean {
  const nextTailKey = getConversationTailBlockKey(nextTailBlock);
  if (nextTailKey === null) {
    return false;
  }

  if (nextTailKey !== previousTailKey) {
    return true;
  }

  return nextTailBlock?.type === 'text' || nextTailBlock?.type === 'thinking' || nextTailBlock?.type === 'tool_use';
}

export function shouldShowScrollToBottomControl(messageCount: number, atBottom: boolean): boolean {
  return messageCount > 0 && !atBottom;
}

export function shouldRunConversationInitialScroll(input: {
  initialScrollKey: string | null;
  hasMessages: boolean;
  sessionLoading: boolean;
}): boolean {
  return Boolean(input.initialScrollKey) && input.hasMessages;
}

export function shouldPreservePinnedBottomDuringAutoScroll(input: {
  wasPinnedToBottom: boolean;
  isAutoScrollActive: boolean;
  nextAtBottom: boolean;
}): boolean {
  return input.wasPinnedToBottom && input.isAutoScrollActive && !input.nextAtBottom;
}

export function shouldContinueConversationBottomSettle(state: {
  frameCount: number;
  stableFrames: number;
  minFrames?: number;
  stableFrameCount?: number;
  maxFrames?: number;
}): boolean {
  const minFrames =
    typeof state.minFrames === 'number' && Number.isSafeInteger(state.minFrames) && state.minFrames >= 0
      ? Math.min(DEFAULT_BOTTOM_SETTLE_MAX_FRAMES, state.minFrames)
      : 0;
  const stableFrameCount =
    typeof state.stableFrameCount === 'number' && Number.isSafeInteger(state.stableFrameCount) && state.stableFrameCount > 0
      ? Math.min(DEFAULT_BOTTOM_SETTLE_MAX_FRAMES, state.stableFrameCount)
      : DEFAULT_BOTTOM_SETTLE_STABLE_FRAME_COUNT;
  const maxFramesCandidate =
    typeof state.maxFrames === 'number' && Number.isSafeInteger(state.maxFrames) && state.maxFrames >= 0
      ? Math.min(DEFAULT_BOTTOM_SETTLE_MAX_FRAMES, state.maxFrames)
      : DEFAULT_BOTTOM_SETTLE_MAX_FRAMES;
  const maxFrames = Math.max(minFrames, maxFramesCandidate);

  if (state.frameCount >= maxFrames) {
    return false;
  }

  if (state.frameCount < minFrames) {
    return true;
  }

  return state.stableFrames < stableFrameCount;
}
