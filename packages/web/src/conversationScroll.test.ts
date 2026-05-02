import { describe, expect, it } from 'vitest';
import { isConversationScrolledToBottom, shouldShowScrollToBottomControl } from './conversationScroll.js';

describe('conversation scroll helpers', () => {
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

  it('never shows the scroll-to-bottom control for empty conversations', () => {
    expect(shouldShowScrollToBottomControl(0, false)).toBe(false);
    expect(shouldShowScrollToBottomControl(0, true)).toBe(false);
  });

  it('shows the scroll-to-bottom control only when messages exist and the view is not pinned', () => {
    expect(shouldShowScrollToBottomControl(4, true)).toBe(false);
    expect(shouldShowScrollToBottomControl(4, false)).toBe(true);
  });
});
