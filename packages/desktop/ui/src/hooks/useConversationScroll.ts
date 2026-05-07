import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from 'react';

import {
  getConversationBottomScrollTop,
  getConversationPrependRestoreScrollTop,
  getConversationTailBlockKey,
  isConversationScrolledToBottom,
  isConversationTailVisibleAtBottom,
  scrollConversationTailIntoView,
  shouldAutoScrollToStreamingTail,
  shouldContinueConversationBottomSettle,
  shouldPreservePinnedBottomDuringAutoScroll,
  shouldRunConversationInitialScroll,
} from '../conversation/conversationScroll';
import type { MessageBlock } from '../shared/types';

const INITIAL_SCROLL_STABLE_FRAME_COUNT = 2;
const INITIAL_SCROLL_MIN_FRAMES = 24;
const INITIAL_SCROLL_MAX_FRAMES = 45;
const SMOOTH_SCROLL_SETTLE_DELAY_MS = 360;

interface UseConversationScrollOptions {
  conversationId: string | null;
  messages: MessageBlock[] | undefined;
  scrollRef: RefObject<HTMLDivElement>;
  sessionLoading: boolean;
  isStreaming: boolean;
  initialScrollKey: string | null;
  prependRestoreKey?: string | number | null;
}

interface UseConversationScrollResult {
  atBottom: boolean;
  syncScrollStateFromDom: () => void;
  scrollToBottom: (options?: { behavior?: ScrollBehavior; force?: boolean }) => void;
  capturePrependRestore: () => void;
}

export function useConversationScroll({
  conversationId,
  messages,
  scrollRef,
  sessionLoading,
  isStreaming,
  initialScrollKey,
  prependRestoreKey,
}: UseConversationScrollOptions): UseConversationScrollResult {
  const [atBottom, setAtBottom] = useState(true);
  const scrollPinnedToBottomRef = useRef(true);
  const completedInitialScrollKeyRef = useRef<string | null>(null);
  const streamingTailAutoScrollKeyRef = useRef<string | null>(null);
  const pendingPrependRestoreRef = useRef<{
    conversationId: string;
    scrollHeight: number;
    scrollTop: number;
    stickToBottom: boolean;
  } | null>(null);
  const bottomScrollAnimationFrameRef = useRef(0);
  const smoothBottomScrollTimeoutRef = useRef<number | null>(null);
  const smoothBottomScrollCleanupRef = useRef<(() => void) | null>(null);
  const pinnedBottomWatchUntilRef = useRef(0);
  const pinnedBottomWatchFrameRef = useRef(0);
  // Only true during the initial conversation-load settle (windowed chunks
  // being replaced with measured blocks). During streaming the transcript
  // is already measured so transient layout scroll events don't occur and
  // "preserve pinned during auto-scroll" should not apply — that guard
  // would prevent scrollbar/keyboard detach.
  const isTransientSettleRef = useRef(false);
  const isStreamingRef = useRef(isStreaming);
  const hasMessages = (messages?.length ?? 0) > 0;

  const clearSmoothBottomScrollSettle = useCallback(() => {
    if (smoothBottomScrollTimeoutRef.current !== null) {
      window.clearTimeout(smoothBottomScrollTimeoutRef.current);
      smoothBottomScrollTimeoutRef.current = null;
    }

    if (smoothBottomScrollCleanupRef.current) {
      smoothBottomScrollCleanupRef.current();
      smoothBottomScrollCleanupRef.current = null;
    }
  }, []);

  const cancelBottomScrollSettle = useCallback(() => {
    if (bottomScrollAnimationFrameRef.current !== 0) {
      window.cancelAnimationFrame(bottomScrollAnimationFrameRef.current);
      bottomScrollAnimationFrameRef.current = 0;
    }

    clearSmoothBottomScrollSettle();
  }, [clearSmoothBottomScrollSettle]);

  const cancelPinnedBottomWatch = useCallback(() => {
    pinnedBottomWatchUntilRef.current = 0;
    if (pinnedBottomWatchFrameRef.current !== 0) {
      window.cancelAnimationFrame(pinnedBottomWatchFrameRef.current);
      pinnedBottomWatchFrameRef.current = 0;
    }
  }, []);

  const detachFromBottom = useCallback(() => {
    scrollPinnedToBottomRef.current = false;
    setAtBottom(false);
    cancelBottomScrollSettle();
    cancelPinnedBottomWatch();
  }, [cancelBottomScrollSettle, cancelPinnedBottomWatch]);

  useLayoutEffect(() => {
    isStreamingRef.current = isStreaming;
  }, [isStreaming]);

  const syncPinnedBottomFromDom = useCallback((el: HTMLDivElement, scrollHeight = el.scrollHeight) => {
    scrollPinnedToBottomRef.current = true;
    scrollConversationTailIntoView(el);
    el.scrollTop = getConversationBottomScrollTop({
      scrollHeight,
      clientHeight: el.clientHeight,
    });
    setAtBottom(true);
  }, []);

  const startPinnedBottomWatch = useCallback(
    (durationMs = 8000) => {
      const nextDeadline = window.performance.now() + durationMs;
      pinnedBottomWatchUntilRef.current = Math.max(pinnedBottomWatchUntilRef.current, nextDeadline);

      if (pinnedBottomWatchFrameRef.current !== 0) {
        return;
      }

      let lastScrollHeight = scrollRef.current?.scrollHeight ?? 0;
      const tick = () => {
        pinnedBottomWatchFrameRef.current = 0;
        const el = scrollRef.current;
        if (!el) {
          return;
        }

        const nextScrollHeight = el.scrollHeight;
        const tailNeedsRealignment =
          !isConversationTailVisibleAtBottom(el) &&
          !isConversationScrolledToBottom({
            scrollHeight: nextScrollHeight,
            scrollTop: el.scrollTop,
            clientHeight: el.clientHeight,
          });
        if (scrollPinnedToBottomRef.current && (nextScrollHeight !== lastScrollHeight || tailNeedsRealignment)) {
          syncPinnedBottomFromDom(el, nextScrollHeight);
        }
        lastScrollHeight = nextScrollHeight;

        if (window.performance.now() >= pinnedBottomWatchUntilRef.current) {
          return;
        }

        pinnedBottomWatchFrameRef.current = window.requestAnimationFrame(tick);
      };

      pinnedBottomWatchFrameRef.current = window.requestAnimationFrame(tick);
    },
    [scrollRef, syncPinnedBottomFromDom],
  );

  const settleBottomScroll = useCallback(
    (options?: { onSettled?: () => void; minFrames?: number }) => {
      const el = scrollRef.current;
      if (!el) {
        options?.onSettled?.();
        return;
      }

      if (bottomScrollAnimationFrameRef.current !== 0) {
        window.cancelAnimationFrame(bottomScrollAnimationFrameRef.current);
        bottomScrollAnimationFrameRef.current = 0;
      }

      startPinnedBottomWatch();

      let lastScrollHeight = -1;
      let stableFrames = 0;
      let frameCount = 0;

      const tick = () => {
        bottomScrollAnimationFrameRef.current = 0;

        // If the user detached while a settle tick was already queued (e.g. the
        // wheel handler raced with requestAnimationFrame), stop without scrolling.
        if (!scrollPinnedToBottomRef.current) {
          return;
        }

        const nextScrollHeight = el.scrollHeight;
        syncPinnedBottomFromDom(el, nextScrollHeight);
        frameCount += 1;

        if (nextScrollHeight === lastScrollHeight) {
          stableFrames += 1;
        } else {
          lastScrollHeight = nextScrollHeight;
          stableFrames = 0;
        }

        if (
          !shouldContinueConversationBottomSettle({
            frameCount,
            stableFrames,
            minFrames: options?.minFrames,
            stableFrameCount: INITIAL_SCROLL_STABLE_FRAME_COUNT,
            maxFrames: INITIAL_SCROLL_MAX_FRAMES,
          })
        ) {
          options?.onSettled?.();
          return;
        }

        bottomScrollAnimationFrameRef.current = window.requestAnimationFrame(tick);
      };

      tick();
    },
    [scrollRef, startPinnedBottomWatch, syncPinnedBottomFromDom],
  );

  useLayoutEffect(() => {
    cancelBottomScrollSettle();
    pendingPrependRestoreRef.current = null;
    completedInitialScrollKeyRef.current = null;
    streamingTailAutoScrollKeyRef.current = null;
    scrollPinnedToBottomRef.current = true;
    isTransientSettleRef.current = false;

    // Defer the initial scroll by one animation frame so that a remounting
    // ChatView (triggered by a key change on conversationId) has time to
    // compute its layout before we read scrollHeight.
    const frame = window.requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        syncPinnedBottomFromDom(el);
        startPinnedBottomWatch();
      }
      setAtBottom(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [cancelBottomScrollSettle, conversationId, scrollRef, startPinnedBottomWatch, syncPinnedBottomFromDom]);

  useLayoutEffect(
    () => () => {
      cancelBottomScrollSettle();
      cancelPinnedBottomWatch();
    },
    [cancelBottomScrollSettle, cancelPinnedBottomWatch],
  );

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0 && scrollPinnedToBottomRef.current) {
        detachFromBottom();
      }
    };

    // Any pointer interaction in the transcript (clicking a tool call,
    // selecting text, tapping a link) should pause auto-scroll so the user
    // can read or interact without being pushed to the bottom.
    const handlePointerDown = () => {
      if (scrollPinnedToBottomRef.current) {
        detachFromBottom();
      }
    };

    el.addEventListener('wheel', handleWheel, { passive: true });
    el.addEventListener('pointerdown', handlePointerDown, { passive: true });
    return () => {
      el.removeEventListener('wheel', handleWheel);
      el.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [detachFromBottom, scrollRef]);

  const syncScrollStateFromDom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      scrollPinnedToBottomRef.current = true;
      setAtBottom(true);
      return;
    }

    const nextAtBottom =
      isConversationTailVisibleAtBottom(el) ||
      isConversationScrolledToBottom({
        scrollHeight: el.scrollHeight,
        scrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
      });

    // Opening large/windowed transcripts can fire scroll events while the DOM is
    // still replacing estimated spacer heights with measured ones. Those are
    // not user intent; if we treat them as detachments, the settle loop gets
    // cancelled and the viewport can strand itself in the middle of the page.
    //
    // Only apply this guard during the initial settle — during streaming the
    // transcript is fully measured so transient scroll events don't occur, and
    // the guard would prevent scrollbar/keyboard users from detaching.
    if (
      isTransientSettleRef.current &&
      shouldPreservePinnedBottomDuringAutoScroll({
        wasPinnedToBottom: scrollPinnedToBottomRef.current,
        isAutoScrollActive: bottomScrollAnimationFrameRef.current !== 0 || pinnedBottomWatchFrameRef.current !== 0,
        nextAtBottom,
      })
    ) {
      setAtBottom(true);
      return;
    }

    if (!nextAtBottom) {
      cancelBottomScrollSettle();
      cancelPinnedBottomWatch();
    }
    scrollPinnedToBottomRef.current = nextAtBottom;
    setAtBottom(nextAtBottom);
  }, [cancelBottomScrollSettle, cancelPinnedBottomWatch, scrollRef]);

  const scrollToBottom = useCallback(
    (options?: { behavior?: ScrollBehavior; force?: boolean }) => {
      const el = scrollRef.current;
      if (!el) {
        return;
      }

      if (!options?.force && isStreamingRef.current && !scrollPinnedToBottomRef.current) {
        return;
      }

      scrollPinnedToBottomRef.current = true;
      cancelBottomScrollSettle();

      if (options?.behavior === 'smooth') {
        let settled = false;
        const settleAfterSmoothScroll = () => {
          if (settled) {
            return;
          }

          settled = true;
          clearSmoothBottomScrollSettle();
          settleBottomScroll();
        };
        const handleScrollEnd = () => {
          settleAfterSmoothScroll();
        };

        smoothBottomScrollCleanupRef.current = () => {
          el.removeEventListener('scrollend', handleScrollEnd);
        };
        smoothBottomScrollTimeoutRef.current = window.setTimeout(() => {
          settleAfterSmoothScroll();
        }, SMOOTH_SCROLL_SETTLE_DELAY_MS);

        el.addEventListener('scrollend', handleScrollEnd, { once: true });
        startPinnedBottomWatch();
        if (!scrollConversationTailIntoView(el, { behavior: 'smooth' })) {
          el.scrollTo({
            top: getConversationBottomScrollTop({
              scrollHeight: el.scrollHeight,
              clientHeight: el.clientHeight,
            }),
            behavior: 'smooth',
          });
        }
        setAtBottom(true);
        return;
      }

      settleBottomScroll();
    },
    [cancelBottomScrollSettle, clearSmoothBottomScrollSettle, scrollRef, settleBottomScroll, startPinnedBottomWatch],
  );

  const capturePrependRestore = useCallback(() => {
    if (!conversationId) {
      return;
    }

    const el = scrollRef.current;
    if (!el) {
      return;
    }

    pendingPrependRestoreRef.current = {
      conversationId,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      stickToBottom: scrollPinnedToBottomRef.current,
    };
  }, [conversationId, scrollRef]);

  useLayoutEffect(() => {
    if (!messages?.length) {
      scrollPinnedToBottomRef.current = true;
      setAtBottom(true);
      return;
    }

    const el = scrollRef.current;
    if (!el) {
      scrollPinnedToBottomRef.current = true;
      setAtBottom(true);
      return;
    }

    setAtBottom(
      isConversationTailVisibleAtBottom(el) ||
        isConversationScrolledToBottom({
          scrollHeight: el.scrollHeight,
          scrollTop: el.scrollTop,
          clientHeight: el.clientHeight,
        }),
    );
  }, [conversationId, messages, scrollRef]);

  useLayoutEffect(() => {
    const pendingRestore = pendingPrependRestoreRef.current;
    if (!pendingRestore || !conversationId || pendingRestore.conversationId !== conversationId) {
      return;
    }

    const el = scrollRef.current;
    if (!el) {
      return;
    }

    el.scrollTop = getConversationPrependRestoreScrollTop({
      previousScrollHeight: pendingRestore.scrollHeight,
      previousScrollTop: pendingRestore.scrollTop,
      nextScrollHeight: el.scrollHeight,
      nextClientHeight: el.clientHeight,
      stickToBottom: pendingRestore.stickToBottom,
    });
    scrollPinnedToBottomRef.current = pendingRestore.stickToBottom;
    pendingPrependRestoreRef.current = null;

    if (pendingRestore.stickToBottom) {
      settleBottomScroll();
      return;
    }

    setAtBottom(
      isConversationTailVisibleAtBottom(el) ||
        isConversationScrolledToBottom({
          scrollHeight: el.scrollHeight,
          scrollTop: el.scrollTop,
          clientHeight: el.clientHeight,
        }),
    );
  }, [conversationId, messages, prependRestoreKey, scrollRef, settleBottomScroll]);

  useLayoutEffect(() => {
    // Only restart the open-scroll loop when the conversation/scroll phase changes
    // or the transcript flips from empty to non-empty. Streaming updates should
    // extend the existing loop, not restart it every time the tail grows.
    if (
      !shouldRunConversationInitialScroll({
        initialScrollKey,
        hasMessages,
        sessionLoading,
      }) ||
      !scrollRef.current
    ) {
      return;
    }

    if (completedInitialScrollKeyRef.current === initialScrollKey) {
      return;
    }

    scrollPinnedToBottomRef.current = true;
    isTransientSettleRef.current = true;
    settleBottomScroll({
      minFrames: INITIAL_SCROLL_MIN_FRAMES,
      onSettled: () => {
        isTransientSettleRef.current = false;
        completedInitialScrollKeyRef.current = initialScrollKey;
      },
    });

    return () => {
      cancelBottomScrollSettle();
    };
  }, [cancelBottomScrollSettle, hasMessages, initialScrollKey, messages, scrollRef, sessionLoading, settleBottomScroll]);

  useLayoutEffect(() => {
    const tailBlock = messages?.[messages.length - 1];
    const tailKey = getConversationTailBlockKey(tailBlock);

    if (!isStreaming) {
      streamingTailAutoScrollKeyRef.current = tailKey;
      // When streaming just ended, the last block's content finalizes and
      // the streaming-status indicator is removed — both change the scroll
      // container's layout. Do a final settle to re-anchor the viewport to
      // the tail before the pinned-bottom watch expires.
      if (tailKey !== null && scrollPinnedToBottomRef.current && scrollRef.current) {
        scrollToBottom();
      }
      return;
    }

    if (!scrollRef.current) {
      streamingTailAutoScrollKeyRef.current = tailKey;
      return;
    }

    if (!scrollPinnedToBottomRef.current) {
      streamingTailAutoScrollKeyRef.current = tailKey;
      return;
    }

    if (!shouldAutoScrollToStreamingTail(streamingTailAutoScrollKeyRef.current, tailBlock)) {
      return;
    }

    streamingTailAutoScrollKeyRef.current = tailKey;
    scrollToBottom();
  }, [isStreaming, messages, scrollRef, scrollToBottom]);

  return {
    atBottom,
    syncScrollStateFromDom,
    scrollToBottom,
    capturePrependRestore,
  };
}
