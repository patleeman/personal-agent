export const CONVERSATION_PROJECTS_CHANGED_EVENT = 'pa:conversation-projects-changed';

export function emitConversationProjectsChanged(conversationId: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(CONVERSATION_PROJECTS_CHANGED_EVENT, {
    detail: { conversationId },
  }));
}
