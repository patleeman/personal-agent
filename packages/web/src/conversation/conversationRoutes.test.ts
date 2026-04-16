import { describe, expect, it } from 'vitest';
import {
  buildConversationDeeplink,
  resolveConversationAdjacentPath,
  resolveConversationCloseRedirect,
  resolveConversationIndexRedirect,
} from './conversationRoutes';

describe('buildConversationDeeplink', () => {
  it('builds browser deeplinks from the current origin', () => {
    expect(buildConversationDeeplink('conversation-1', 'https://agent.tail.ts.net/settings')).toBe('https://agent.tail.ts.net/conversations/conversation-1');
  });

  it('preserves the desktop app protocol when running inside Electron', () => {
    expect(buildConversationDeeplink('conversation-1', 'personal-agent://app/automations')).toBe('personal-agent://app/conversations/conversation-1');
  });
});

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

describe('resolveConversationAdjacentPath', () => {
  it('cycles forward through the ordered conversations and wraps around', () => {
    expect(resolveConversationAdjacentPath({
      orderedIds: ['pinned-1', 'open-1', 'new'],
      activeId: 'open-1',
      direction: 1,
    })).toBe('/conversations/new');

    expect(resolveConversationAdjacentPath({
      orderedIds: ['pinned-1', 'open-1', 'new'],
      activeId: 'new',
      direction: 1,
    })).toBe('/conversations/pinned-1');
  });

  it('falls back to the edge conversation when nothing is active', () => {
    expect(resolveConversationAdjacentPath({
      orderedIds: ['pinned-1', 'open-1'],
      direction: -1,
    })).toBe('/conversations/open-1');
  });

  it('returns null when no workspace conversations are available', () => {
    expect(resolveConversationAdjacentPath({
      orderedIds: [],
      activeId: 'open-1',
      direction: 1,
    })).toBeNull();
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
