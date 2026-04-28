import { useCallback, useEffect, useMemo, useState, type RefObject } from 'react';
import type { ChatRenderItem } from './transcriptItems.js';
import {
  buildChatRenderChunks,
  CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT,
  resolveChunkIndexForOffset,
  type ChatRenderChunk,
  type ChatRenderChunkLayout,
  type ChatWindowingProfile,
} from './chatWindowing.js';

export function calculateAverageSpanHeight(
  renderChunks: ChatRenderChunk[],
  chunkHeights: Record<string, number>,
): number {
  const measurements = renderChunks
    .map((chunk) => ({ height: chunkHeights[chunk.key], spanCount: chunk.spanCount }))
    .filter((entry): entry is { height: number; spanCount: number } => typeof entry.height === 'number' && entry.height > 0 && entry.spanCount > 0);

  if (measurements.length === 0) {
    return CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT;
  }

  const totalHeight = measurements.reduce((sum, entry) => sum + entry.height, 0);
  const totalSpans = measurements.reduce((sum, entry) => sum + entry.spanCount, 0);
  return totalSpans > 0 ? totalHeight / totalSpans : CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT;
}

export function buildChatRenderChunkLayouts(
  renderChunks: ChatRenderChunk[],
  chunkHeights: Record<string, number>,
  averageSpanHeight: number,
): ChatRenderChunkLayout[] {
  let top = 0;
  return renderChunks.map((chunk) => {
    const estimatedHeight = Math.max(1, chunk.spanCount * averageSpanHeight);
    const height = chunkHeights[chunk.key] ?? estimatedHeight;
    const layout = {
      ...chunk,
      top,
      height,
      bottom: top + height,
    };
    top += height;
    return layout;
  });
}

export function resolveVisibleChunkRange({
  chunkLayouts,
  focusMessageIndex,
  overscanChunks,
  viewport,
}: {
  chunkLayouts: ChatRenderChunkLayout[];
  focusMessageIndex: number | null;
  overscanChunks: number;
  viewport: { scrollTop: number; clientHeight: number } | null;
}): { chunks: ChatRenderChunkLayout[]; topSpacerHeight: number; bottomSpacerHeight: number } | null {
  if (chunkLayouts.length === 0) {
    return null;
  }

  const normalizedOverscanChunks = Number.isSafeInteger(overscanChunks) && overscanChunks >= 0
    ? overscanChunks
    : 0;

  const totalHeight = chunkLayouts[chunkLayouts.length - 1]?.bottom ?? 0;
  const tops = chunkLayouts.map((chunk) => chunk.top);
  const heights = chunkLayouts.map((chunk) => chunk.height);
  const focusChunkIndex = focusMessageIndex === null
    ? -1
    : chunkLayouts.findIndex((chunk) => focusMessageIndex >= chunk.startMessageIndex && focusMessageIndex <= chunk.endMessageIndex);

  let startChunkIndex: number;
  let endChunkIndex: number;

  if (viewport === null) {
    const anchorChunkIndex = focusChunkIndex >= 0 ? focusChunkIndex : chunkLayouts.length - 1;
    startChunkIndex = Math.max(0, anchorChunkIndex - normalizedOverscanChunks);
    endChunkIndex = Math.min(chunkLayouts.length - 1, anchorChunkIndex + normalizedOverscanChunks);
  } else {
    const viewportTop = Math.max(0, viewport.scrollTop);
    const viewportBottom = viewportTop + Math.max(1, viewport.clientHeight);
    const firstVisibleChunkIndex = resolveChunkIndexForOffset(viewportTop, tops, heights);
    const lastVisibleChunkIndex = resolveChunkIndexForOffset(viewportBottom, tops, heights);
    startChunkIndex = Math.max(0, firstVisibleChunkIndex - normalizedOverscanChunks);
    endChunkIndex = Math.min(chunkLayouts.length - 1, lastVisibleChunkIndex + normalizedOverscanChunks);

    if (focusChunkIndex >= 0 && (focusChunkIndex < startChunkIndex || focusChunkIndex > endChunkIndex)) {
      startChunkIndex = Math.max(0, focusChunkIndex - normalizedOverscanChunks);
      endChunkIndex = Math.min(chunkLayouts.length - 1, focusChunkIndex + normalizedOverscanChunks);
    }
  }

  const topSpacerHeight = startChunkIndex > 0 ? chunkLayouts[startChunkIndex].top : 0;
  const bottomSpacerHeight = endChunkIndex < chunkLayouts.length - 1
    ? Math.max(0, totalHeight - chunkLayouts[endChunkIndex].bottom)
    : 0;

  return {
    chunks: chunkLayouts.slice(startChunkIndex, endChunkIndex + 1),
    topSpacerHeight,
    bottomSpacerHeight,
  };
}

export function useChatWindowing({
  scrollContainerRef,
  renderItems,
  messageIndexOffset,
  renderingProfile,
  focusMessageIndex,
}: {
  scrollContainerRef?: RefObject<HTMLDivElement>;
  renderItems: ChatRenderItem[];
  messageIndexOffset: number;
  renderingProfile: ChatWindowingProfile;
  focusMessageIndex: number | null;
}) {
  const shouldWindowTranscript = Boolean(scrollContainerRef) && renderItems.length >= renderingProfile.windowingThreshold;
  const renderChunks = useMemo(
    () => (shouldWindowTranscript ? buildChatRenderChunks(renderItems, messageIndexOffset, renderingProfile.windowingChunkSize) : []),
    [messageIndexOffset, renderItems, renderingProfile.windowingChunkSize, shouldWindowTranscript],
  );
  const [viewport, setViewport] = useState<{ scrollTop: number; clientHeight: number } | null>(null);
  const [chunkHeights, setChunkHeights] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!shouldWindowTranscript) {
      setViewport(null);
      return;
    }

    const scrollEl = scrollContainerRef?.current;
    if (!scrollEl) {
      return;
    }

    let frame = 0;
    const sync = () => {
      frame = 0;
      const next = {
        scrollTop: scrollEl.scrollTop,
        clientHeight: scrollEl.clientHeight,
      };
      setViewport((current) => (
        current && current.scrollTop === next.scrollTop && current.clientHeight === next.clientHeight
          ? current
          : next
      ));
    };
    const scheduleSync = () => {
      if (frame !== 0) {
        return;
      }

      frame = window.requestAnimationFrame(sync);
    };

    scheduleSync();
    scrollEl.addEventListener('scroll', scheduleSync, { passive: true });
    window.addEventListener('resize', scheduleSync);

    return () => {
      scrollEl.removeEventListener('scroll', scheduleSync);
      window.removeEventListener('resize', scheduleSync);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [shouldWindowTranscript, scrollContainerRef]);

  const averageSpanHeight = useMemo(
    () => calculateAverageSpanHeight(renderChunks, chunkHeights),
    [chunkHeights, renderChunks],
  );

  const chunkLayouts = useMemo(
    () => buildChatRenderChunkLayouts(renderChunks, chunkHeights, averageSpanHeight),
    [averageSpanHeight, chunkHeights, renderChunks],
  );

  const updateChunkHeight = useCallback((chunkKey: string, height: number) => {
    setChunkHeights((current) => (current[chunkKey] === height ? current : { ...current, [chunkKey]: height }));
  }, []);

  const visibleChunkRange = useMemo(
    () => (shouldWindowTranscript
      ? resolveVisibleChunkRange({
          chunkLayouts,
          focusMessageIndex,
          overscanChunks: renderingProfile.windowingOverscanChunks,
          viewport,
        })
      : null),
    [chunkLayouts, focusMessageIndex, renderingProfile.windowingOverscanChunks, shouldWindowTranscript, viewport],
  );

  return {
    shouldWindowTranscript,
    renderChunks,
    visibleChunkRange,
    updateChunkHeight,
  };
}
