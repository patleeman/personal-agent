import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { ChatRenderItem } from './transcriptItems.js';

export type ChatViewPerformanceMode = 'default' | 'aggressive';
export interface ChatWindowingProfile {
  contentVisibilityThreshold: number;
  windowingThreshold: number;
  windowingChunkSize: number;
  windowingOverscanChunks: number;
}

export const CHAT_VIEW_RENDERING_PROFILE: Record<ChatViewPerformanceMode, ChatWindowingProfile> = {
  default: {
    contentVisibilityThreshold: 120,
    windowingThreshold: 240,
    windowingChunkSize: 80,
    windowingOverscanChunks: 2,
  },
  aggressive: {
    contentVisibilityThreshold: 48,
    windowingThreshold: 96,
    windowingChunkSize: 40,
    windowingOverscanChunks: 1,
  },
};

export const CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT = 96;
export const CHAT_WINDOWING_BADGE_DEFAULT_TOP_OFFSET_PX = 12;

export interface ChatRenderChunk {
  key: string;
  items: ChatRenderItem[];
  startItemIndex: number;
  endItemIndex: number;
  startMessageIndex: number;
  endMessageIndex: number;
  spanCount: number;
}

export interface ChatRenderChunkLayout extends ChatRenderChunk {
  top: number;
  height: number;
  bottom: number;
}

export function getChatRenderItemAbsoluteRange(item: ChatRenderItem, messageIndexOffset: number): { start: number; end: number } {
  if (item.type === 'trace_cluster') {
    return {
      start: messageIndexOffset + item.startIndex,
      end: messageIndexOffset + item.endIndex,
    };
  }

  return {
    start: messageIndexOffset + item.index,
    end: messageIndexOffset + item.index,
  };
}

export function buildChatRenderChunks(
  renderItems: ChatRenderItem[],
  messageIndexOffset: number,
  chunkSize: number,
): ChatRenderChunk[] {
  const chunks: ChatRenderChunk[] = [];

  for (let startItemIndex = 0; startItemIndex < renderItems.length; startItemIndex += chunkSize) {
    const items = renderItems.slice(startItemIndex, startItemIndex + chunkSize);
    const startRange = getChatRenderItemAbsoluteRange(items[0], messageIndexOffset);
    const endRange = getChatRenderItemAbsoluteRange(items[items.length - 1], messageIndexOffset);
    const spanCount = items.reduce((count, item) => {
      const range = getChatRenderItemAbsoluteRange(item, messageIndexOffset);
      return count + (range.end - range.start + 1);
    }, 0);
    chunks.push({
      key: `${startRange.start}-${endRange.end}-${items.length}`,
      items,
      startItemIndex,
      endItemIndex: startItemIndex + items.length - 1,
      startMessageIndex: startRange.start,
      endMessageIndex: endRange.end,
      spanCount,
    });
  }

  return chunks;
}

export function resolveChunkIndexForOffset(offset: number, chunkTops: number[], chunkHeights: number[]): number {
  for (let index = 0; index < chunkTops.length; index += 1) {
    if (offset < chunkTops[index] + chunkHeights[index]) {
      return index;
    }
  }

  return Math.max(0, chunkTops.length - 1);
}

export function formatWindowingCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}m`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  }

  return String(value);
}

export function WindowedChatChunk({
  chunk,
  renderItem,
  onHeightChange,
  includeTrailingGap,
}: {
  chunk: ChatRenderChunk;
  renderItem: (item: ChatRenderItem, itemIndex: number) => ReactNode;
  onHeightChange: (chunkKey: string, height: number) => void;
  includeTrailingGap: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const measure = () => {
      onHeightChange(chunk.key, element.getBoundingClientRect().height);
    };

    measure();
    const observer = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => measure())
      : null;
    observer?.observe(element);

    return () => {
      observer?.disconnect();
    };
  }, [chunk.key, includeTrailingGap, onHeightChange]);

  return (
    <div ref={ref} className={includeTrailingGap ? 'space-y-4 pb-4' : 'space-y-4'}>
      {chunk.items.map((item, itemIndex) => renderItem(item, chunk.startItemIndex + itemIndex))}
    </div>
  );
}

