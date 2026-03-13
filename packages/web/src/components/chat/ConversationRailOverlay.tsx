import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import type { MessageBlock } from '../../types';
import { cx } from '../ui';
import {
  applyConversationRailFisheye,
  getConversationRailScrollTopFromThumb,
  getConversationRailTurns,
  getConversationRailViewportTop,
  isConversationRailThumbHit,
  pickNearestConversationRailMarker,
} from './conversationRail.js';

interface ConversationRailProps {
  messages: MessageBlock[];
  scrollContainerRef: RefObject<HTMLDivElement>;
  onJumpToMessage: (index: number) => void;
}

interface MeasuredConversationRailMarker {
  index: number;
  kind: 'user' | 'assistant';
  label: 'User' | 'Assistant';
  snippet: string;
  contentCenterY: number;
}

interface ProjectedConversationRailMarker extends MeasuredConversationRailMarker {
  baseY: number;
  displayY: number;
}

const TRACK_INSET = 16;
// Keep the rail hit-area narrow so it behaves like a scrollbar/rail, not a click-blocking overlay.
const RAIL_SLOT_WIDTH = 40;
const RAIL_REST_WIDTH = 20;
const RAIL_HOVER_WIDTH = 34;
const TRACK_RIGHT_INSET = 6;
const FISHEYE_RADIUS = 72;
const FISHEYE_OFFSET = 11;
const PREVIEW_HALF_HEIGHT = 42;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function ConversationRail({ messages, scrollContainerRef, onJumpToMessage }: ConversationRailProps) {
  const turns = useMemo(() => getConversationRailTurns(messages), [messages]);
  const turnsByIndex = useMemo(() => new Map(turns.map((turn) => [turn.index, turn])), [turns]);

  const [markers, setMarkers] = useState<MeasuredConversationRailMarker[]>([]);
  const [viewport, setViewport] = useState({ scrollTop: 0, scrollHeight: 1, clientHeight: 1 });
  const [hovered, setHovered] = useState(false);
  const [pointerY, setPointerY] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const railRef = useRef<HTMLDivElement | null>(null);
  const dragOffsetRef = useRef(0);

  const syncViewport = useCallback(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) {
      return;
    }

    setViewport({
      scrollTop: scrollEl.scrollTop,
      scrollHeight: Math.max(scrollEl.scrollHeight, 1),
      clientHeight: Math.max(scrollEl.clientHeight, 1),
    });
  }, [scrollContainerRef]);

  const measureMarkers = useCallback(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) {
      setMarkers([]);
      return;
    }

    const scrollRect = scrollEl.getBoundingClientRect();
    const elements = Array.from(
      scrollEl.querySelectorAll<HTMLElement>('[data-conversation-rail-kind="user"][data-message-index]'),
    );

    const nextMarkers: MeasuredConversationRailMarker[] = [];
    for (const element of elements) {
      const index = Number(element.dataset.messageIndex);
      const turn = turnsByIndex.get(index);
      if (!Number.isFinite(index) || !turn) {
        continue;
      }

      const rect = element.getBoundingClientRect();
      const contentTop = rect.top - scrollRect.top + scrollEl.scrollTop;
      nextMarkers.push({
        ...turn,
        contentCenterY: contentTop + (rect.height / 2),
      });
    }

    nextMarkers.sort((left, right) => left.contentCenterY - right.contentCenterY);
    setMarkers(nextMarkers);
    syncViewport();
  }, [scrollContainerRef, syncViewport, turnsByIndex]);

  useLayoutEffect(() => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) {
      return;
    }

    let frame = 0;
    const observedImages: HTMLImageElement[] = [];

    const scheduleMeasure = () => {
      if (frame !== 0) {
        return;
      }

      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measureMarkers();
      });
    };

    scheduleMeasure();

    const handleScroll = () => syncViewport();
    scrollEl.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', scheduleMeasure);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(() => scheduleMeasure())
      : null;
    resizeObserver?.observe(scrollEl);

    for (const image of Array.from(scrollEl.querySelectorAll<HTMLImageElement>('[data-conversation-rail-kind] img'))) {
      image.addEventListener('load', scheduleMeasure);
      observedImages.push(image);
    }

    return () => {
      scrollEl.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', scheduleMeasure);
      resizeObserver?.disconnect();
      for (const image of observedImages) {
        image.removeEventListener('load', scheduleMeasure);
      }
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [measureMarkers, scrollContainerRef, syncViewport]);

  useEffect(() => {
    measureMarkers();
  }, [measureMarkers, messages]);

  const contentHeight = Math.max(viewport.scrollHeight, viewport.clientHeight, 1);
  const trackHeight = Math.max(1, viewport.clientHeight - (TRACK_INSET * 2));

  const projectedMarkers = useMemo<ProjectedConversationRailMarker[]>(() => {
    const localPointerY = hovered && pointerY !== null
      ? clamp(pointerY, 0, trackHeight)
      : null;

    return markers.map((marker) => {
      const baseY = (marker.contentCenterY / contentHeight) * trackHeight;
      const displayY = localPointerY === null
        ? baseY
        : applyConversationRailFisheye(baseY, localPointerY, FISHEYE_RADIUS, FISHEYE_OFFSET);

      return {
        ...marker,
        baseY,
        displayY,
      };
    });
  }, [contentHeight, hovered, markers, pointerY, trackHeight]);

  const nearestMarker = useMemo(() => {
    if (!hovered || pointerY === null) {
      return null;
    }

    return pickNearestConversationRailMarker(projectedMarkers, pointerY);
  }, [hovered, pointerY, projectedMarkers]);

  const activeMarker = nearestMarker
    ? projectedMarkers.find((marker) => marker.index === nearestMarker.index) ?? null
    : null;

  const viewportHeightPx = Math.max(18, (viewport.clientHeight / contentHeight) * trackHeight);
  const viewportTopPx = clamp(
    getConversationRailViewportTop({
      clientHeight: viewport.clientHeight,
      contentHeight,
      trackHeight,
      viewportHeightPx,
    }, viewport.scrollTop),
    0,
    Math.max(0, trackHeight - viewportHeightPx),
  );

  const previewCenterY = activeMarker
    ? clamp(TRACK_INSET + activeMarker.displayY, TRACK_INSET + PREVIEW_HALF_HEIGHT, viewport.clientHeight - TRACK_INSET - PREVIEW_HALF_HEIGHT)
    : 0;

  const getLocalPointerY = useCallback((clientY: number): number | null => {
    const railEl = railRef.current;
    if (!railEl) {
      return null;
    }

    const rect = railEl.getBoundingClientRect();
    return clamp(clientY - rect.top - TRACK_INSET, 0, trackHeight);
  }, [trackHeight]);

  const scrollToPointer = useCallback((localY: number, dragOffsetPx: number) => {
    const scrollEl = scrollContainerRef.current;
    if (!scrollEl) {
      return;
    }

    scrollEl.scrollTop = getConversationRailScrollTopFromThumb({
      metrics: {
        clientHeight: viewport.clientHeight,
        contentHeight,
        trackHeight,
        viewportHeightPx,
      },
      pointerY: localY,
      dragOffsetPx,
    });
  }, [contentHeight, scrollContainerRef, trackHeight, viewport.clientHeight, viewportHeightPx]);

  function handlePointerMove(event: ReactMouseEvent<HTMLDivElement>) {
    const localY = getLocalPointerY(event.clientY);
    if (localY === null) {
      return;
    }

    setPointerY(localY);
    if (dragging) {
      scrollToPointer(localY, dragOffsetRef.current);
    }
  }

  function handlePointerLeave() {
    if (dragging) {
      return;
    }

    setHovered(false);
    setPointerY(null);
  }

  function jumpToPointer(localY: number) {
    const marker = pickNearestConversationRailMarker(projectedMarkers, localY);
    if (!marker) {
      return;
    }

    onJumpToMessage(marker.index);
  }

  useEffect(() => {
    if (!dragging) {
      return;
    }

    function handleWindowMouseMove(event: MouseEvent) {
      const localY = getLocalPointerY(event.clientY);
      if (localY === null) {
        return;
      }

      setPointerY(localY);
      scrollToPointer(localY, dragOffsetRef.current);
    }

    function handleWindowMouseUp() {
      setDragging(false);
    }

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [dragging, getLocalPointerY, scrollToPointer]);

  if (projectedMarkers.length === 0) {
    return null;
  }

  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 z-20"
      style={{ width: RAIL_SLOT_WIDTH }}
    >
      {activeMarker && hovered && (
        <div
          data-conversation-rail-preview="true"
          className="pointer-events-none absolute w-56 rounded-xl border border-border-subtle bg-panel/90 px-3 py-2.5 shadow-lg backdrop-blur-sm"
          style={{ right: RAIL_HOVER_WIDTH + 10, top: previewCenterY, transform: 'translateY(-50%)' }}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider text-dim">{activeMarker.label}</p>
          <p
            className="mt-1 text-[12px] leading-snug text-secondary"
            style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {activeMarker.snippet}
          </p>
        </div>
      )}

      <div
        ref={railRef}
        className={cx(
          'pointer-events-auto relative ml-auto h-full transition-opacity duration-150 ease-out',
          hovered ? 'opacity-100' : 'opacity-82',
          dragging ? 'cursor-grabbing' : 'cursor-default',
        )}
        style={{ width: RAIL_SLOT_WIDTH }}
        onMouseEnter={() => setHovered(true)}
        onMouseMove={handlePointerMove}
        onMouseLeave={handlePointerLeave}
        onMouseDown={(event) => {
          event.preventDefault();
          const localY = getLocalPointerY(event.clientY);
          if (localY === null) {
            return;
          }

          setHovered(true);
          setPointerY(localY);

          if (isConversationRailThumbHit(localY, viewportTopPx, viewportHeightPx)) {
            dragOffsetRef.current = localY - viewportTopPx;
            setDragging(true);
            return;
          }

          jumpToPointer(localY);
        }}
        aria-label="Conversation rail"
      >
        <div
          className="absolute inset-y-0 right-0 transition-[width] duration-150 ease-out"
          style={{ width: hovered ? RAIL_HOVER_WIDTH : RAIL_REST_WIDTH }}
        >
          <div
            className="absolute top-4 bottom-4 rounded-full bg-border-subtle/40"
            style={{ left: `calc(100% - ${TRACK_RIGHT_INSET}px)`, transform: 'translateX(-50%)', width: 1 }}
          />

          <div
            className={cx(
              'absolute rounded-full border border-border-subtle/60 bg-elevated/40 shadow-sm transition-all duration-150',
              dragging ? 'cursor-grabbing' : 'cursor-grab',
            )}
            style={{
              left: `calc(100% - ${TRACK_RIGHT_INSET}px)`,
              transform: 'translateX(-50%)',
              top: TRACK_INSET + viewportTopPx,
              width: hovered ? 20 : 14,
              height: viewportHeightPx,
            }}
          />

          {projectedMarkers.map((marker) => {
            const distance = hovered && pointerY !== null
              ? Math.abs(marker.displayY - pointerY)
              : Number.POSITIVE_INFINITY;
            const focus = hovered
              ? Math.max(0, 1 - (distance / 56))
              : 0;
            const lineWidth = 8 + (focus * 5);
            const lineHeight = 1.4 + (focus * 0.7);
            const nearest = activeMarker?.index === marker.index;
            const color = nearest
              ? 'rgb(var(--color-accent) / 0.82)'
              : `rgb(var(--color-accent) / ${0.6 + (focus * 0.18)})`;

            return (
              <div
                key={marker.index}
                data-conversation-rail-marker="user"
                className="absolute transition-transform duration-75 ease-out"
                style={{
                  left: `calc(100% - ${TRACK_RIGHT_INSET}px)`,
                  top: TRACK_INSET + marker.displayY,
                  width: lineWidth,
                  height: lineHeight,
                  borderRadius: 999,
                  backgroundColor: color,
                  boxShadow: nearest ? '0 0 0 1px rgb(var(--color-base) / 0.82)' : 'none',
                  transform: 'translate(-100%, -50%)',
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
