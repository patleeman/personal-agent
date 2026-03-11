export const NEW_CONVERSATION_TITLE = 'New Conversation';

export function normalizeConversationTitle(title: string | null | undefined): string | null {
  if (typeof title !== 'string') {
    return null;
  }

  const trimmed = title.trim();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.toLowerCase();
  if (normalized === '(new conversation)' || normalized === 'new conversation') {
    return NEW_CONVERSATION_TITLE;
  }

  return trimmed;
}

export function getConversationDisplayTitle(...titles: Array<string | null | undefined>): string {
  for (const title of titles) {
    const normalized = normalizeConversationTitle(title);
    if (normalized) {
      return normalized;
    }
  }

  return NEW_CONVERSATION_TITLE;
}
