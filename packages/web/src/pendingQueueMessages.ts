import type { MessageBlock } from './types';

export type PendingQueuePreviewItem = {
  id: string;
  text: string;
  type: 'steer' | 'followUp';
  queueIndex: number;
};

function buildPendingQueueBlocks(pendingQueue: PendingQueuePreviewItem[], now: string): MessageBlock[] {
  return pendingQueue.map((item) => ({
    type: 'user' as const,
    id: `queued-${item.type}-${item.queueIndex}`,
    ts: now,
    text: item.text,
  }));
}

function countTrailingVisibleQueuedMessages(messages: MessageBlock[], pendingQueue: PendingQueuePreviewItem[]): number {
  const maxComparable = Math.min(messages.length, pendingQueue.length);

  for (let count = maxComparable; count > 0; count -= 1) {
    const trailing = messages.slice(-count);
    const expected = pendingQueue.slice(0, count);
    const matches = trailing.every((block, index) => block.type === 'user' && block.text === expected[index]?.text);
    if (matches) {
      return count;
    }
  }

  return 0;
}

export function appendPendingQueueBlocks(
  messages: MessageBlock[] | undefined,
  pendingQueue: PendingQueuePreviewItem[],
  now = new Date().toISOString(),
): MessageBlock[] | undefined {
  if (pendingQueue.length === 0) {
    return messages;
  }

  const existingMessages = messages ?? [];
  const alreadyVisibleCount = countTrailingVisibleQueuedMessages(existingMessages, pendingQueue);
  const missingQueueItems = pendingQueue.slice(alreadyVisibleCount);

  if (missingQueueItems.length === 0) {
    return existingMessages;
  }

  return [...existingMessages, ...buildPendingQueueBlocks(missingQueueItems, now)];
}
