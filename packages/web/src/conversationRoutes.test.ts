import { describe, expect, it } from 'vitest';
import { resolveConversationCloseRedirect, resolveConversationIndexRedirect } from './conversationRoutes';

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

describe('resolveConversationCloseRedirect', () => {
  it('opens the next tab after closing an active tab in the middle of the list', () => {
    expect(resolveConversationCloseRedirect({
      orderedIds: ['open-1', 'open-2', 'open-3'],
      closingId: 'open-2',
    })).toBe('/conversations/open-3');
  });

  it('falls back to the previous remaining tab when closing the last tab in the list', () => {
    expect(resolveConversationCloseRedirect({
      orderedIds: ['open-1', 'open-2', 'open-3'],
      closingId: 'open-3',
    })).toBe('/conversations/open-2');
  });

  it('opens the create conversation page when no tabs remain', () => {
    expect(resolveConversationCloseRedirect({
      orderedIds: ['open-1'],
      closingId: 'open-1',
    })).toBe('/conversations/new');
  });

  it('treats the draft route as a close target and redirect destination', () => {
    expect(resolveConversationCloseRedirect({
      orderedIds: ['open-1', 'new'],
      closingId: 'open-1',
    })).toBe('/conversations/new');
  });
});
