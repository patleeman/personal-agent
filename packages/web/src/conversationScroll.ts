import type { MessageBlock } from './types';

const DEFAULT_SCROLL_TO_BOTTOM_THRESHOLD_PX = 40;

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

export function isConversationScrolledToBottom(
  metrics: ConversationScrollMetrics,
  thresholdPx = DEFAULT_SCROLL_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < thresholdPx;
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
