import { describe, expect, it, vi } from 'vitest';
import { subscribeAppEvents } from './appEvents.js';
import {
  notifyConversationAutomationChanged,
  subscribeConversationAutomation,
} from './conversationAutomationEvents.js';

describe('conversationAutomationEvents', () => {
  it('notifies only listeners for the changed conversation and invalidates automation', () => {
    const appEvents: Array<{ type: string; topics?: string[] }> = [];
    const conversationListener = vi.fn();
    const otherConversationListener = vi.fn();

    const unsubscribeAppEvents = subscribeAppEvents((event) => {
      appEvents.push(event as { type: string; topics?: string[] });
    });
    const unsubscribeConversation = subscribeConversationAutomation('conv-1', conversationListener);
    const unsubscribeOtherConversation = subscribeConversationAutomation('conv-2', otherConversationListener);

    notifyConversationAutomationChanged('conv-1');

    expect(conversationListener).toHaveBeenCalledTimes(1);
    expect(otherConversationListener).not.toHaveBeenCalled();
    expect(appEvents).toEqual([{ type: 'invalidate', topics: ['automation'] }]);

    unsubscribeOtherConversation();
    unsubscribeConversation();
    unsubscribeAppEvents();
  });

  it('stops notifying listeners after unsubscribe', () => {
    const conversationListener = vi.fn();
    const unsubscribeConversation = subscribeConversationAutomation('conv-1', conversationListener);

    unsubscribeConversation();
    notifyConversationAutomationChanged('conv-1');

    expect(conversationListener).not.toHaveBeenCalled();
  });
});
