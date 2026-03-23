import { describe, expect, it } from 'vitest';
import {
  getConversationInitialScrollKey,
  getConversationTailBlockKey,
  isConversationScrolledToBottom,
  shouldAutoScrollToStreamingTail,
  shouldShowScrollToBottomControl,
} from './conversationScroll.js';

describe('conversation scroll helpers', () => {
  it('uses a provisional initial-scroll key until a live snapshot arrives', () => {
    expect(getConversationInitialScrollKey('conv-123', {
      isLiveSession: true,
      hasLiveSnapshot: false,
    })).toBe('conv-123:provisional');

    expect(getConversationInitialScrollKey('conv-123', {
      isLiveSession: true,
      hasLiveSnapshot: true,
    })).toBe('conv-123:settled');

    expect(getConversationInitialScrollKey('conv-123', {
      isLiveSession: false,
      hasLiveSnapshot: false,
    })).toBe('conv-123:settled');
  });

  it('treats the viewport as pinned when it is within the bottom threshold', () => {
    expect(isConversationScrolledToBottom({
      scrollHeight: 1200,
      scrollTop: 761,
      clientHeight: 400,
    })).toBe(true);

    expect(isConversationScrolledToBottom({
      scrollHeight: 1200,
      scrollTop: 760,
      clientHeight: 400,
    })).toBe(false);
  });

  it('returns a stable tail key for in-place streaming text updates', () => {
    expect(getConversationTailBlockKey({
      type: 'text',
      ts: '2026-03-21T10:00:00.000Z',
      text: 'Hello',
    })).toBe('text:2026-03-21T10:00:00.000Z');

    expect(getConversationTailBlockKey({
      type: 'text',
      ts: '2026-03-21T10:00:00.000Z',
      text: 'Hello, world',
    })).toBe('text:2026-03-21T10:00:00.000Z');
  });

  it('auto-scrolls only when the streaming tail changes to a new block', () => {
    const previousTailKey = 'text:2026-03-21T10:00:00.000Z';

    expect(shouldAutoScrollToStreamingTail(previousTailKey, {
      type: 'text',
      ts: '2026-03-21T10:00:00.000Z',
      text: 'Longer streamed text',
    })).toBe(false);

    expect(shouldAutoScrollToStreamingTail(previousTailKey, {
      type: 'tool_use',
      ts: '2026-03-21T10:00:02.000Z',
      tool: 'bash',
      input: {},
      output: '',
      status: 'running',
      _toolCallId: 'tool-call-1',
    })).toBe(true);
  });

  it('never shows the scroll-to-bottom control for empty conversations', () => {
    expect(shouldShowScrollToBottomControl(0, false)).toBe(false);
    expect(shouldShowScrollToBottomControl(0, true)).toBe(false);
  });

  it('shows the scroll-to-bottom control only when messages exist and the view is not pinned', () => {
    expect(shouldShowScrollToBottomControl(4, true)).toBe(false);
    expect(shouldShowScrollToBottomControl(4, false)).toBe(true);
  });
});
