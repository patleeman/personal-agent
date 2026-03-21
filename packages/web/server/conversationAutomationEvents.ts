import { invalidateAppTopics } from './appEvents.js';

type ConversationAutomationListener = () => void;

const listenersByConversationId = new Map<string, Set<ConversationAutomationListener>>();

export function subscribeConversationAutomation(
  conversationId: string,
  listener: ConversationAutomationListener,
): () => void {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    return () => {};
  }

  const listeners = listenersByConversationId.get(normalizedConversationId) ?? new Set<ConversationAutomationListener>();
  listeners.add(listener);
  listenersByConversationId.set(normalizedConversationId, listeners);

  return () => {
    const currentListeners = listenersByConversationId.get(normalizedConversationId);
    if (!currentListeners) {
      return;
    }

    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      listenersByConversationId.delete(normalizedConversationId);
    }
  };
}

export function notifyConversationAutomationChanged(conversationId: string): void {
  invalidateAppTopics('automation');

  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    return;
  }

  const listeners = listenersByConversationId.get(normalizedConversationId);
  if (!listeners || listeners.size === 0) {
    return;
  }

  for (const listener of [...listeners]) {
    listener();
  }
}
