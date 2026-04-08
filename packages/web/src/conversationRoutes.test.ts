import { describe, expect, it } from 'vitest';
import { resolveConversationIndexRedirect } from './conversationRoutes';

describe('resolveConversationIndexRedirect', () => {
  it('prefers the open workspace conversations', () => {
    expect(resolveConversationIndexRedirect({
      openIds: ['open-1', 'open-2'],
      pinnedIds: ['pinned-1'],
      hasDraft: true,
    })).toBe('/conversations/open-1');
  });

  it('falls back to pinned conversations when no open tabs remain', () => {
    expect(resolveConversationIndexRedirect({
      openIds: [],
      pinnedIds: ['pinned-1'],
    })).toBe('/conversations/pinned-1');
  });

  it('reopens the draft when it is the only remaining conversation surface', () => {
    expect(resolveConversationIndexRedirect({
      openIds: [],
      pinnedIds: [],
      hasDraft: true,
    })).toBe('/conversations/new');
  });

  it('falls back to a new conversation when nothing is open', () => {
    expect(resolveConversationIndexRedirect({
      openIds: ['   ', 'new'],
      pinnedIds: [''],
      hasDraft: false,
    })).toBe('/conversations/new');
  });
});
