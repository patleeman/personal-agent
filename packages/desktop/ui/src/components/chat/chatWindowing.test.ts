import { describe, expect, it } from 'vitest';

import {
  buildChatRenderChunks,
  formatWindowingCount,
  getChatRenderItemAbsoluteRange,
  resolveChunkIndexForOffset,
} from './chatWindowing.js';
import type { ChatRenderItem } from './transcriptItems.js';

function messageItem(index: number): ChatRenderItem {
  return {
    type: 'message',
    index,
    block: { type: 'text', ts: '2026-04-26T00:00:00.000Z', text: `message ${index}` },
  } as ChatRenderItem;
}

function traceCluster(startIndex: number, endIndex: number): ChatRenderItem {
  return {
    type: 'trace_cluster',
    startIndex,
    endIndex,
    blocks: [],
    summary: { stepCount: endIndex - startIndex + 1, categories: [], hasRunning: false, hasError: false, durationMs: 0 },
  } as ChatRenderItem;
}

describe('chatWindowing', () => {
  it('resolves absolute ranges for messages and trace clusters', () => {
    expect(getChatRenderItemAbsoluteRange(messageItem(2), 10)).toEqual({ start: 12, end: 12 });
    expect(getChatRenderItemAbsoluteRange(traceCluster(3, 6), 10)).toEqual({ start: 13, end: 16 });
  });

  it('builds render chunks with span counts across clustered items', () => {
    const chunks = buildChatRenderChunks([messageItem(0), traceCluster(1, 3), messageItem(4), messageItem(5)], 20, 2);

    expect(chunks).toEqual([
      {
        key: '20-23-2',
        items: [messageItem(0), traceCluster(1, 3)],
        startItemIndex: 0,
        endItemIndex: 1,
        startMessageIndex: 20,
        endMessageIndex: 23,
        spanCount: 4,
      },
      {
        key: '24-25-2',
        items: [messageItem(4), messageItem(5)],
        startItemIndex: 2,
        endItemIndex: 3,
        startMessageIndex: 24,
        endMessageIndex: 25,
        spanCount: 2,
      },
    ]);
  });

  it('resolves chunk index from vertical offsets', () => {
    expect(resolveChunkIndexForOffset(0, [0, 100, 250], [100, 150, 100])).toBe(0);
    expect(resolveChunkIndexForOffset(100, [0, 100, 250], [100, 150, 100])).toBe(1);
    expect(resolveChunkIndexForOffset(999, [0, 100, 250], [100, 150, 100])).toBe(2);
    expect(resolveChunkIndexForOffset(0, [], [])).toBe(0);
  });

  it('formats large windowing counts compactly', () => {
    expect(formatWindowingCount(999)).toBe('999');
    expect(formatWindowingCount(1_200)).toBe('1.2k');
    expect(formatWindowingCount(12_000)).toBe('12k');
    expect(formatWindowingCount(1_200_000)).toBe('1.2m');
    expect(formatWindowingCount(12_000_000)).toBe('12m');
  });
});
