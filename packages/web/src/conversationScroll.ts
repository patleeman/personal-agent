const DEFAULT_SCROLL_TO_BOTTOM_THRESHOLD_PX = 40;

export interface ConversationScrollMetrics {
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}

export function isConversationScrolledToBottom(
  metrics: ConversationScrollMetrics,
  thresholdPx = DEFAULT_SCROLL_TO_BOTTOM_THRESHOLD_PX,
): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight < thresholdPx;
}

export function shouldShowScrollToBottomControl(messageCount: number, atBottom: boolean): boolean {
  return messageCount > 0 && !atBottom;
}
