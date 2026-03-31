import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  getConversationBottomScrollTop,
  getConversationPrependRestoreScrollTop,
  getConversationTailBlockKey,
  isConversationScrolledToBottom,
  shouldAutoScrollToStreamingTail,
} from '../conversationScroll';
import type { MessageBlock } from '../types';

const INITIAL_SCROLL_STABLE_FRAME_COUNT = 2;
const INITIAL_SCROLL_MAX_FRAMES = 45;
const SMOOTH_SCROLL_SETTLE_DELAY_MS = 360;

export interface UseConversationScrollOptions {
  conversationId: string | null;
  messages: MessageBlock[] | undefined;
  scrollRef: RefObject<HTMLDivElement>;
  sessionLoading: boolean;
  isStreaming: boolean;
  initialScrollKey: string | null;
  prependRestoreKey?: string | number | null;
}

export interface UseConversationScrollResult {
  atBottom: boolean;
  syncScrollStateFromDom: () => void;
  scrollToBottom: (options?: { behavior?: ScrollBehavior }) => void;
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

  const settleBottomScroll = useCallback((onSettled?: () => void) => {
    const el = scrollRef.current;
    if (!el) {
      onSettled?.();
      return;
    }

    if (bottomScrollAnimationFrameRef.current !== 0) {
      window.cancelAnimationFrame(bottomScrollAnimationFrameRef.current);
      bottomScrollAnimationFrameRef.current = 0;
    }

    let lastScrollHeight = -1;
    let stableFrames = 0;
    let frameCount = 0;

    const tick = () => {
      bottomScrollAnimationFrameRef.current = 0;
      const nextScrollHeight = el.scrollHeight;
      scrollPinnedToBottomRef.current = true;
      el.scrollTop = getConversationBottomScrollTop({
        scrollHeight: nextScrollHeight,
        clientHeight: el.clientHeight,
      });
      setAtBottom(true);
      frameCount += 1;

      if (nextScrollHeight === lastScrollHeight) {
        stableFrames += 1;
      } else {
        lastScrollHeight = nextScrollHeight;
        stableFrames = 0;
      }

      if (stableFrames >= INITIAL_SCROLL_STABLE_FRAME_COUNT || frameCount >= INITIAL_SCROLL_MAX_FRAMES) {
        onSettled?.();
        return;
      }

      bottomScrollAnimationFrameRef.current = window.requestAnimationFrame(tick);
    };

    tick();
  }, [scrollRef]);

  useLayoutEffect(() => {
    cancelBottomScrollSettle();
    pendingPrependRestoreRef.current = null;
    completedInitialScrollKeyRef.current = null;
    streamingTailAutoScrollKeyRef.current = null;
    scrollPinnedToBottomRef.current = true;

    // Defer the initial scroll by one animation frame so that a remounting
    // ChatView (triggered by a key change on conversationId) has time to
    // compute its layout before we read scrollHeight.
    const frame = window.requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = getConversationBottomScrollTop({
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        });
      }
      setAtBottom(true);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [cancelBottomScrollSettle, conversationId, scrollRef]);

  useLayoutEffect(() => () => {
    cancelBottomScrollSettle();
  }, [cancelBottomScrollSettle]);

  const syncScrollStateFromDom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      scrollPinnedToBottomRef.current = true;
      setAtBottom(true);
      return;
    }

    const nextAtBottom = isConversationScrolledToBottom({
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
    });
    scrollPinnedToBottomRef.current = nextAtBottom;
    setAtBottom(nextAtBottom);
  }, [scrollRef]);

  const scrollToBottom = useCallback((options?: { behavior?: ScrollBehavior }) => {
    const el = scrollRef.current;
    if (!el) {
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
      el.scrollTo({
        top: getConversationBottomScrollTop({
          scrollHeight: el.scrollHeight,
          clientHeight: el.clientHeight,
        }),
        behavior: 'smooth',
      });
      setAtBottom(true);
      return;
    }

    settleBottomScroll();
  }, [cancelBottomScrollSettle, clearSmoothBottomScrollSettle, scrollRef, settleBottomScroll]);

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

    setAtBottom(isConversationScrolledToBottom({
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
    }));
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

    setAtBottom(isConversationScrolledToBottom({
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
    }));
  }, [conversationId, messages, prependRestoreKey, scrollRef, settleBottomScroll]);

  useLayoutEffect(() => {
    // Only restart the open-scroll loop when the conversation/scroll phase changes
    // or the transcript flips from empty to non-empty. Streaming updates should
    // extend the existing loop, not restart it every time the tail grows.
    if (!initialScrollKey || !hasMessages || !scrollRef.current || sessionLoading) {
      return;
    }

    if (completedInitialScrollKeyRef.current === initialScrollKey) {
      return;
    }

    scrollPinnedToBottomRef.current = true;
    settleBottomScroll(() => {
      completedInitialScrollKeyRef.current = initialScrollKey;
    });

    return () => {
      cancelBottomScrollSettle();
    };
  }, [cancelBottomScrollSettle, hasMessages, initialScrollKey, scrollRef, sessionLoading, settleBottomScroll]);

  useLayoutEffect(() => {
    const tailBlock = messages?.[messages.length - 1];
    const tailKey = getConversationTailBlockKey(tailBlock);

    if (!isStreaming) {
      streamingTailAutoScrollKeyRef.current = tailKey;
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
