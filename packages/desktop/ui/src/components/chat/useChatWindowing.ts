import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildChatRenderChunks,
  CHAT_WINDOWING_FALLBACK_SPAN_HEIGHT,
  type ChatRenderChunk,
  type ChatRenderChunkLayout,
  type ChatWindowingProfile,
  getChatRenderItemsSpanCount,
  resolveChunkIndexForOffset,
} from './chatWindowing.js';
import type { ChatRenderItem } from './transcriptItems.js';

const MAX_OVERSCAN_CHUNKS = 10;

function normalizeChunkHeight(height: number): number | null {
  if (!Number.isFinite(height) || height <= 0) {
    return null;
  }

  return Math.ceil(height);
}

export function mergeChunkHeightMeasurements(
  current: Record<string, number>,
  measurements: Record<string, number>,
): Record<string, number> {
  let changed = false;
  const next = { ...current };

  for (const [chunkKey, measuredHeight] of Object.entries(measurements)) {
    const height = normalizeChunkHeight(measuredHeight);
    if (height === null || current[chunkKey] === height) {
      continue;
    }

    next[chunkKey] = height;
    changed = true;
  }

  return changed ? next : current;
}

export function calculateAverageSpanHeight(renderChunks: ChatRenderChunk[], chunkHeights: Record<string, number>): number {
  const measurements = renderChunks
    .map((chunk) => ({ height: chunkHeights[chunk.key], spanCount: chunk.spanCount }))
    .filter(
      (entry): entry is { height: number; spanCount: number } =>
        typeof entry.height === 'number' && entry.height > 0 && entry.spanCount > 0,
    );

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
  anchorToTail,
  overscanChunks,
  viewport,
}: {
  chunkLayouts: ChatRenderChunkLayout[];
  focusMessageIndex: number | null;
  anchorToTail?: boolean;
  overscanChunks: number;
  viewport: { scrollTop: number; clientHeight: number } | null;
}): { chunks: ChatRenderChunkLayout[]; topSpacerHeight: number; bottomSpacerHeight: number } | null {
  if (chunkLayouts.length === 0) {
    return null;
  }

  const normalizedOverscanChunks =
    Number.isSafeInteger(overscanChunks) && overscanChunks >= 0 ? Math.min(MAX_OVERSCAN_CHUNKS, overscanChunks) : 0;

  const totalHeight = chunkLayouts[chunkLayouts.length - 1]?.bottom ?? 0;
  const tops = chunkLayouts.map((chunk) => chunk.top);
  const heights = chunkLayouts.map((chunk) => chunk.height);
  const focusChunkIndex =
    focusMessageIndex === null
      ? -1
      : chunkLayouts.findIndex((chunk) => focusMessageIndex >= chunk.startMessageIndex && focusMessageIndex <= chunk.endMessageIndex);

  let startChunkIndex: number;
  let endChunkIndex: number;

  if (viewport === null || (anchorToTail && focusChunkIndex < 0)) {
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
  const bottomSpacerHeight = endChunkIndex < chunkLayouts.length - 1 ? Math.max(0, totalHeight - chunkLayouts[endChunkIndex].bottom) : 0;

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
  anchorToTail,
}: {
  scrollContainerRef?: RefObject<HTMLDivElement>;
  renderItems: ChatRenderItem[];
  messageIndexOffset: number;
  renderingProfile: ChatWindowingProfile;
  focusMessageIndex: number | null;
  anchorToTail?: boolean;
}) {
  const renderItemSpanCount = useMemo(
    () => getChatRenderItemsSpanCount(renderItems, messageIndexOffset),
    [messageIndexOffset, renderItems],
  );
  const shouldWindowTranscript = Boolean(scrollContainerRef) && renderItemSpanCount >= renderingProfile.windowingThreshold;
  const renderChunks = useMemo(
    () => (shouldWindowTranscript ? buildChatRenderChunks(renderItems, messageIndexOffset, renderingProfile.windowingChunkSize) : []),
    [messageIndexOffset, renderItems, renderingProfile.windowingChunkSize, shouldWindowTranscript],
  );
  const [viewport, setViewport] = useState<{ scrollTop: number; clientHeight: number } | null>(null);
  const [chunkHeights, setChunkHeights] = useState<Record<string, number>>({});
  const pendingChunkHeightsRef = useRef<Record<string, number>>({});
  const chunkHeightFrameRef = useRef(0);

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
      setViewport((current) =>
        current && current.scrollTop === next.scrollTop && current.clientHeight === next.clientHeight ? current : next,
      );
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

  const averageSpanHeight = useMemo(() => calculateAverageSpanHeight(renderChunks, chunkHeights), [chunkHeights, renderChunks]);

  const chunkLayouts = useMemo(
    () => buildChatRenderChunkLayouts(renderChunks, chunkHeights, averageSpanHeight),
    [averageSpanHeight, chunkHeights, renderChunks],
  );

  const flushChunkHeightMeasurements = useCallback(() => {
    chunkHeightFrameRef.current = 0;
    const measurements = pendingChunkHeightsRef.current;
    pendingChunkHeightsRef.current = {};

    if (Object.keys(measurements).length === 0) {
      return;
    }

    setChunkHeights((current) => mergeChunkHeightMeasurements(current, measurements));
  }, []);

  const updateChunkHeight = useCallback(
    (chunkKey: string, height: number) => {
      pendingChunkHeightsRef.current[chunkKey] = height;

      if (chunkHeightFrameRef.current !== 0) {
        return;
      }

      chunkHeightFrameRef.current = window.requestAnimationFrame(flushChunkHeightMeasurements);
    },
    [flushChunkHeightMeasurements],
  );

  useEffect(
    () => () => {
      if (chunkHeightFrameRef.current !== 0) {
        window.cancelAnimationFrame(chunkHeightFrameRef.current);
        chunkHeightFrameRef.current = 0;
      }
      pendingChunkHeightsRef.current = {};
    },
    [],
  );

  const visibleChunkRange = useMemo(
    () =>
      shouldWindowTranscript
        ? resolveVisibleChunkRange({
            chunkLayouts,
            focusMessageIndex,
            anchorToTail,
            overscanChunks: renderingProfile.windowingOverscanChunks,
            viewport,
          })
        : null,
    [anchorToTail, chunkLayouts, focusMessageIndex, renderingProfile.windowingOverscanChunks, shouldWindowTranscript, viewport],
  );

  return {
    shouldWindowTranscript,
    renderChunks,
    visibleChunkRange,
    updateChunkHeight,
    renderItemSpanCount,
  };
}
