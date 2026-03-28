import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import {
  getConversationTailBlockKey,
  isConversationScrolledToBottom,
  shouldAutoScrollToStreamingTail,
} from '../conversationScroll';
import type { MessageBlock } from '../types';

const INITIAL_SCROLL_STABLE_FRAME_COUNT = 2;
const INITIAL_SCROLL_MAX_FRAMES = 45;

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
  } | null>(null);
  const hasMessages = (messages?.length ?? 0) > 0;

  useLayoutEffect(() => {
    pendingPrependRestoreRef.current = null;
    completedInitialScrollKeyRef.current = null;
    streamingTailAutoScrollKeyRef.current = null;
    scrollPinnedToBottomRef.current = true;

    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }

    setAtBottom(true);
  }, [conversationId, scrollRef]);

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
    if (options?.behavior) {
      el.scrollTo({ top: el.scrollHeight, behavior: options.behavior });
    } else {
      el.scrollTop = el.scrollHeight;
    }
    setAtBottom(true);
  }, [scrollRef]);

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

    const delta = el.scrollHeight - pendingRestore.scrollHeight;
    el.scrollTop = pendingRestore.scrollTop + Math.max(0, delta);
    pendingPrependRestoreRef.current = null;
  }, [conversationId, messages, prependRestoreKey, scrollRef]);

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

    const el = scrollRef.current;
    let animationFrame = 0;
    let lastScrollHeight = -1;
    let stableFrames = 0;
    let frameCount = 0;

    const settleScroll = () => {
      animationFrame = 0;
      const nextScrollHeight = el.scrollHeight;
      scrollPinnedToBottomRef.current = true;
      el.scrollTop = nextScrollHeight;
      setAtBottom(true);
      frameCount += 1;

      if (nextScrollHeight === lastScrollHeight) {
        stableFrames += 1;
      } else {
        lastScrollHeight = nextScrollHeight;
        stableFrames = 0;
      }

      if (stableFrames >= INITIAL_SCROLL_STABLE_FRAME_COUNT || frameCount >= INITIAL_SCROLL_MAX_FRAMES) {
        completedInitialScrollKeyRef.current = initialScrollKey;
        return;
      }

      animationFrame = window.requestAnimationFrame(settleScroll);
    };

    settleScroll();

    return () => {
      if (animationFrame !== 0) {
        window.cancelAnimationFrame(animationFrame);
      }
    };
  }, [hasMessages, initialScrollKey, scrollRef, sessionLoading]);

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
