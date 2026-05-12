import { describe, expect, it, vi } from 'vitest';

import {
  getConversationBottomScrollTop,
  getConversationInitialScrollKey,
  getConversationPrependRestoreScrollTop,
  getConversationTailBlockKey,
  isConversationScrolledToBottom,
  isConversationScrollOverflowing,
  isConversationTailVisibleAtBottom,
  scrollConversationTailIntoView,
  shouldAutoScrollToStreamingTail,
  shouldContinueConversationBottomSettle,
  shouldPreservePinnedBottomDuringAutoScroll,
  shouldRunConversationInitialScroll,
  shouldShowScrollToBottomControl,
} from './conversationScroll.js';

describe('conversation scroll helpers', () => {
  it('uses a provisional initial-scroll key until a live snapshot arrives', () => {
    expect(
      getConversationInitialScrollKey('conv-123', {
        isLiveSession: true,
        hasLiveSnapshot: false,
      }),
    ).toBe('conv-123:provisional');

    expect(
      getConversationInitialScrollKey('conv-123', {
        isLiveSession: true,
        hasLiveSnapshot: true,
      }),
    ).toBe('conv-123:settled');

    expect(
      getConversationInitialScrollKey('conv-123', {
        isLiveSession: false,
        hasLiveSnapshot: false,
      }),
    ).toBe('conv-123:settled');
  });

  it('returns the maximum scrollTop needed to reach the bottom of the conversation', () => {
    expect(
      getConversationBottomScrollTop({
        scrollHeight: 1200,
        clientHeight: 400,
      }),
    ).toBe(800);

    expect(
      getConversationBottomScrollTop({
        scrollHeight: 320,
        clientHeight: 400,
      }),
    ).toBe(0);
  });

  it('treats the viewport as pinned when it is within the bottom threshold', () => {
    expect(
      isConversationScrolledToBottom({
        scrollHeight: 1200,
        scrollTop: 761,
        clientHeight: 400,
      }),
    ).toBe(true);

    expect(
      isConversationScrolledToBottom({
        scrollHeight: 1200,
        scrollTop: 760,
        clientHeight: 400,
      }),
    ).toBe(false);
  });

  it('only treats the conversation as scrollable when there is room to detach from the bottom', () => {
    expect(isConversationScrollOverflowing({ scrollHeight: 1200, clientHeight: 400 })).toBe(true);
    expect(isConversationScrollOverflowing({ scrollHeight: 420, clientHeight: 400 })).toBe(false);
    expect(isConversationScrollOverflowing({ scrollHeight: 320, clientHeight: 400 })).toBe(false);
  });

  it('keeps prepended history pinned to the latest message when the view was already at the bottom', () => {
    expect(
      getConversationPrependRestoreScrollTop({
        previousScrollHeight: 1200,
        previousScrollTop: 800,
        nextScrollHeight: 1800,
        nextClientHeight: 400,
        stickToBottom: true,
      }),
    ).toBe(1400);
  });

  it('preserves the viewport position when prepended history loads above a scrolled-up view', () => {
    expect(
      getConversationPrependRestoreScrollTop({
        previousScrollHeight: 1200,
        previousScrollTop: 280,
        nextScrollHeight: 1800,
        nextClientHeight: 400,
        stickToBottom: false,
      }),
    ).toBe(880);
  });

  it('scrolls the marked transcript tail into view when a tail anchor is present', () => {
    const scrollIntoView = vi.fn();
    const root = {
      querySelector: vi.fn().mockReturnValue({
        scrollIntoView,
      }),
    };

    expect(scrollConversationTailIntoView(root as unknown as Pick<ParentNode, 'querySelector'>)).toBe(true);
    expect(root.querySelector).toHaveBeenCalledWith('[data-chat-tail="1"]');
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'end',
      inline: 'nearest',
    });
  });

  it('falls back when no transcript tail anchor is available', () => {
    const root = {
      querySelector: vi.fn().mockReturnValue(null),
    };

    expect(scrollConversationTailIntoView(root as unknown as Pick<ParentNode, 'querySelector'>, { behavior: 'smooth' })).toBe(false);
    expect(root.querySelector).toHaveBeenCalledWith('[data-chat-tail="1"]');
  });

  it('treats a visible tail anchor near the viewport bottom as pinned', () => {
    const container = {
      querySelector: vi.fn().mockReturnValue({
        getBoundingClientRect: () => ({ top: 430, bottom: 495 }),
      }),
      getBoundingClientRect: () => ({ top: 100, bottom: 500 }),
    };

    expect(
      isConversationTailVisibleAtBottom(
        container as unknown as Pick<ParentNode, 'querySelector'> & { getBoundingClientRect: () => { top: number; bottom: number } },
      ),
    ).toBe(true);
  });

  it('does not treat an offscreen tail anchor as pinned', () => {
    const container = {
      querySelector: vi.fn().mockReturnValue({
        getBoundingClientRect: () => ({ top: 820, bottom: 900 }),
      }),
      getBoundingClientRect: () => ({ top: 100, bottom: 500 }),
    };

    expect(
      isConversationTailVisibleAtBottom(
        container as unknown as Pick<ParentNode, 'querySelector'> & { getBoundingClientRect: () => { top: number; bottom: number } },
      ),
    ).toBe(false);
  });

  it('does not treat a merely visible tail anchor as pinned to the bottom', () => {
    const container = {
      querySelector: vi.fn().mockReturnValue({
        getBoundingClientRect: () => ({ top: 160, bottom: 240 }),
      }),
      getBoundingClientRect: () => ({ top: 100, bottom: 500 }),
    };

    expect(
      isConversationTailVisibleAtBottom(
        container as unknown as Pick<ParentNode, 'querySelector'> & { getBoundingClientRect: () => { top: number; bottom: number } },
      ),
    ).toBe(false);
  });

  it('returns a stable tail key for in-place streaming text updates', () => {
    expect(
      getConversationTailBlockKey({
        type: 'text',
        ts: '2026-03-21T10:00:00.000Z',
        text: 'Hello',
      }),
    ).toBe('text:2026-03-21T10:00:00.000Z');

    expect(
      getConversationTailBlockKey({
        type: 'text',
        ts: '2026-03-21T10:00:00.000Z',
        text: 'Hello, world',
      }),
    ).toBe('text:2026-03-21T10:00:00.000Z');
  });

  it('auto-scrolls while the streaming tail continues to grow in place', () => {
    const previousTailKey = 'text:2026-03-21T10:00:00.000Z';

    expect(
      shouldAutoScrollToStreamingTail(previousTailKey, {
        type: 'text',
        ts: '2026-03-21T10:00:00.000Z',
        text: 'Longer streamed text',
      }),
    ).toBe(true);

    expect(
      shouldAutoScrollToStreamingTail('thinking:2026-03-21T10:00:01.000Z', {
        type: 'thinking',
        ts: '2026-03-21T10:00:01.000Z',
        text: 'More reasoning',
      }),
    ).toBe(true);

    expect(
      shouldAutoScrollToStreamingTail('tool_use:tool-call-1', {
        type: 'tool_use',
        ts: '2026-03-21T10:00:02.000Z',
        tool: 'bash',
        input: {},
        output: 'more output',
        status: 'running',
        _toolCallId: 'tool-call-1',
      }),
    ).toBe(true);

    expect(
      shouldAutoScrollToStreamingTail(previousTailKey, {
        type: 'summary',
        ts: '2026-03-21T10:00:00.000Z',
        kind: 'compaction',
        title: 'Summary',
        text: 'Same block',
        id: 'summary-1',
      }),
    ).toBe(true);

    expect(
      shouldAutoScrollToStreamingTail('summary:summary-1', {
        type: 'summary',
        ts: '2026-03-21T10:00:00.000Z',
        kind: 'compaction',
        title: 'Summary',
        text: 'Same block',
        id: 'summary-1',
      }),
    ).toBe(false);
  });

  it('never shows the scroll-to-bottom control for empty conversations', () => {
    expect(shouldShowScrollToBottomControl(0, false)).toBe(false);
    expect(shouldShowScrollToBottomControl(0, true)).toBe(false);
  });

  it('shows the scroll-to-bottom control only when messages exist and the view is not pinned', () => {
    expect(shouldShowScrollToBottomControl(4, true)).toBe(false);
    expect(shouldShowScrollToBottomControl(4, false)).toBe(true);
  });

  it('starts the initial bottom scroll as soon as transcript content is available', () => {
    expect(
      shouldRunConversationInitialScroll({
        initialScrollKey: 'conv-123:settled',
        hasMessages: true,
        sessionLoading: true,
      }),
    ).toBe(true);

    expect(
      shouldRunConversationInitialScroll({
        initialScrollKey: 'conv-123:settled',
        hasMessages: false,
        sessionLoading: false,
      }),
    ).toBe(false);

    expect(
      shouldRunConversationInitialScroll({
        initialScrollKey: null,
        hasMessages: true,
        sessionLoading: false,
      }),
    ).toBe(false);
  });

  it('preserves bottom pinning during transient auto-scroll layout churn', () => {
    expect(
      shouldPreservePinnedBottomDuringAutoScroll({
        wasPinnedToBottom: true,
        isAutoScrollActive: true,
        nextAtBottom: false,
      }),
    ).toBe(true);

    expect(
      shouldPreservePinnedBottomDuringAutoScroll({
        wasPinnedToBottom: false,
        isAutoScrollActive: true,
        nextAtBottom: false,
      }),
    ).toBe(false);

    expect(
      shouldPreservePinnedBottomDuringAutoScroll({
        wasPinnedToBottom: true,
        isAutoScrollActive: false,
        nextAtBottom: false,
      }),
    ).toBe(false);

    expect(
      shouldPreservePinnedBottomDuringAutoScroll({
        wasPinnedToBottom: true,
        isAutoScrollActive: true,
        nextAtBottom: true,
      }),
    ).toBe(false);
  });

  it('keeps the initial bottom-settle loop alive until the minimum frame budget has elapsed', () => {
    expect(
      shouldContinueConversationBottomSettle({
        frameCount: 2,
        stableFrames: 2,
        minFrames: 6,
        stableFrameCount: 2,
        maxFrames: 45,
      }),
    ).toBe(true);

    expect(
      shouldContinueConversationBottomSettle({
        frameCount: 6,
        stableFrames: 2,
        minFrames: 6,
        stableFrameCount: 2,
        maxFrames: 45,
      }),
    ).toBe(false);
  });

  it('always stops the bottom-settle loop once the max frame cap is reached', () => {
    expect(
      shouldContinueConversationBottomSettle({
        frameCount: 45,
        stableFrames: 0,
        minFrames: 24,
        stableFrameCount: 2,
        maxFrames: 45,
      }),
    ).toBe(false);
  });

  it('defaults fractional bottom-settle frame limits instead of honoring them', () => {
    expect(
      shouldContinueConversationBottomSettle({
        frameCount: 2,
        stableFrames: 2,
        minFrames: 6.5,
        stableFrameCount: 2,
        maxFrames: 45,
      }),
    ).toBe(false);

    expect(
      shouldContinueConversationBottomSettle({
        frameCount: 2,
        stableFrames: 0,
        minFrames: 0,
        stableFrameCount: 1.5,
        maxFrames: 45,
      }),
    ).toBe(true);

    expect(
      shouldContinueConversationBottomSettle({
        frameCount: 2,
        stableFrames: 0,
        minFrames: 0,
        stableFrameCount: 2,
        maxFrames: 1.5,
      }),
    ).toBe(true);
  });

  it('caps huge bottom-settle frame limits instead of running indefinitely', () => {
    expect(
      shouldContinueConversationBottomSettle({
        frameCount: 45,
        stableFrames: 0,
        minFrames: 0,
        stableFrameCount: 2,
        maxFrames: Number.MAX_SAFE_INTEGER,
      }),
    ).toBe(false);

    expect(
      shouldContinueConversationBottomSettle({
        frameCount: 45,
        stableFrames: 0,
        minFrames: Number.MAX_SAFE_INTEGER,
        stableFrameCount: 2,
        maxFrames: 45,
      }),
    ).toBe(false);
  });
});
