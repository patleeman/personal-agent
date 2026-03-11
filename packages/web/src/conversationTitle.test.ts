import { describe, expect, it } from 'vitest';
import { getConversationDisplayTitle, NEW_CONVERSATION_TITLE, normalizeConversationTitle } from './conversationTitle';

describe('conversation title helpers', () => {
  it('normalizes placeholder conversation titles', () => {
    expect(normalizeConversationTitle('(new conversation)')).toBe(NEW_CONVERSATION_TITLE);
    expect(normalizeConversationTitle('New conversation')).toBe(NEW_CONVERSATION_TITLE);
    expect(normalizeConversationTitle(' New Conversation ')).toBe(NEW_CONVERSATION_TITLE);
  });

  it('returns the first available normalized title', () => {
    expect(getConversationDisplayTitle('', '(new conversation)', 'Actual title')).toBe(NEW_CONVERSATION_TITLE);
    expect(getConversationDisplayTitle(undefined, null, 'Actual title')).toBe('Actual title');
  });

  it('falls back to the default new conversation title', () => {
    expect(getConversationDisplayTitle(undefined, '', null)).toBe(NEW_CONVERSATION_TITLE);
  });
});
