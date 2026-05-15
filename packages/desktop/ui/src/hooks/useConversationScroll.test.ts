// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConversationScroll } from './useConversationScroll.js';

function setScrollMetrics(el: HTMLDivElement, metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: metrics.clientHeight });
  el.scrollTop = metrics.scrollTop;
}

describe('useConversationScroll', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => window.setTimeout(() => callback(performance.now()), 0));
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((handle) => window.clearTimeout(handle));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not let stale programmatic scrolls re-pin after the user detaches during streaming', () => {
    const scrollEl = document.createElement('div');
    setScrollMetrics(scrollEl, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    scrollEl.querySelector = vi.fn().mockReturnValue(null);
    const scrollRef = { current: scrollEl };
    const messages = [{ type: 'text' as const, ts: '1', text: 'hello' }];

    const { result, rerender } = renderHook(
      ({ isStreaming }) =>
        useConversationScroll({
          conversationId: 'conversation-1',
          messages,
          scrollRef,
          sessionLoading: false,
          isStreaming,
          initialScrollKey: null,
        }),
      { initialProps: { isStreaming: false } },
    );

    const scrollToBottomFromBeforeStreamingRender = result.current.scrollToBottom;

    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -80 }));
    });
    expect(result.current.atBottom).toBe(false);

    rerender({ isStreaming: true });
    act(() => {
      scrollToBottomFromBeforeStreamingRender();
    });

    expect(scrollEl.scrollTop).toBe(600);
    expect(result.current.atBottom).toBe(false);
  });

  it('keeps the viewport pinned when the user wheels down at the bottom', () => {
    const scrollEl = document.createElement('div');
    setScrollMetrics(scrollEl, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    scrollEl.querySelector = vi.fn().mockReturnValue(null);
    const scrollRef = { current: scrollEl };
    const messages = [{ type: 'text' as const, ts: '1', text: 'hello' }];

    const { result } = renderHook(() =>
      useConversationScroll({
        conversationId: 'conversation-1',
        messages,
        scrollRef,
        sessionLoading: false,
        isStreaming: true,
        initialScrollKey: null,
      }),
    );

    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: 80 }));
    });

    expect(result.current.atBottom).toBe(true);
  });

  it('keeps short transcripts pinned when the user clicks in the transcript', () => {
    const scrollEl = document.createElement('div');
    setScrollMetrics(scrollEl, { scrollHeight: 320, clientHeight: 400, scrollTop: 0 });
    scrollEl.querySelector = vi.fn().mockReturnValue(null);
    scrollEl.getBoundingClientRect = vi.fn().mockReturnValue({ left: 0, right: 400, top: 0, bottom: 400 });
    const scrollRef = { current: scrollEl };
    const messages = [{ type: 'text' as const, ts: '1', text: 'hello' }];

    const { result } = renderHook(() =>
      useConversationScroll({
        conversationId: 'conversation-1',
        messages,
        scrollRef,
        sessionLoading: false,
        isStreaming: true,
        initialScrollKey: null,
      }),
    );

    act(() => {
      scrollEl.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10 }));
    });

    expect(result.current.atBottom).toBe(true);
  });

  it('preserves the bottom-relative position when the pinned streaming tail grows', () => {
    const scrollEl = document.createElement('div');
    setScrollMetrics(scrollEl, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    scrollEl.querySelector = vi.fn().mockReturnValue(null);
    const scrollRef = { current: scrollEl };

    const { result, rerender } = renderHook(
      ({ messages, isStreaming }) =>
        useConversationScroll({
          conversationId: 'conversation-1',
          messages,
          scrollRef,
          sessionLoading: false,
          isStreaming,
          initialScrollKey: null,
        }),
      {
        initialProps: {
          isStreaming: false,
          messages: [{ type: 'text' as const, ts: '1', text: 'hello' }],
        },
      },
    );

    rerender({ isStreaming: true, messages: [{ type: 'text' as const, ts: '1', text: 'hello' }] });
    setScrollMetrics(scrollEl, { scrollHeight: 1120, clientHeight: 400, scrollTop: 600 });
    rerender({ isStreaming: true, messages: [{ type: 'text' as const, ts: '1', text: 'hello streamed text' }] });

    expect(scrollEl.scrollTop).toBe(720);
    expect(result.current.atBottom).toBe(true);
  });

  it('does not preserve streaming tail growth after the user detaches', () => {
    const scrollEl = document.createElement('div');
    setScrollMetrics(scrollEl, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    scrollEl.querySelector = vi.fn().mockReturnValue(null);
    const scrollRef = { current: scrollEl };

    const { result, rerender } = renderHook(
      ({ messages, isStreaming }) =>
        useConversationScroll({
          conversationId: 'conversation-1',
          messages,
          scrollRef,
          sessionLoading: false,
          isStreaming,
          initialScrollKey: null,
        }),
      {
        initialProps: {
          isStreaming: true,
          messages: [{ type: 'text' as const, ts: '1', text: 'hello' }],
        },
      },
    );

    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -80 }));
    });
    expect(result.current.atBottom).toBe(false);

    setScrollMetrics(scrollEl, { scrollHeight: 1120, clientHeight: 400, scrollTop: 560 });
    rerender({ isStreaming: true, messages: [{ type: 'text' as const, ts: '1', text: 'hello streamed text' }] });

    expect(scrollEl.scrollTop).toBe(560);
    expect(result.current.atBottom).toBe(false);
  });

  it('allows explicit scroll-to-bottom actions to re-pin during streaming', () => {
    const scrollEl = document.createElement('div');
    setScrollMetrics(scrollEl, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    scrollEl.querySelector = vi.fn().mockReturnValue(null);
    const scrollRef = { current: scrollEl };
    const messages = [{ type: 'text' as const, ts: '1', text: 'hello' }];

    const { result, rerender } = renderHook(
      ({ isStreaming }) =>
        useConversationScroll({
          conversationId: 'conversation-1',
          messages,
          scrollRef,
          sessionLoading: false,
          isStreaming,
          initialScrollKey: null,
        }),
      { initialProps: { isStreaming: false } },
    );

    act(() => {
      scrollEl.dispatchEvent(new WheelEvent('wheel', { deltaY: -80 }));
    });
    expect(result.current.atBottom).toBe(false);

    rerender({ isStreaming: true });
    act(() => {
      result.current.scrollToBottom({ force: true });
    });

    expect(scrollEl.scrollTop).toBe(600);
    expect(result.current.atBottom).toBe(true);
  });
});
