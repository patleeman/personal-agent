import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listConversationSessionsSnapshotMock,
  readConversationSessionMetaMock,
  readSessionSearchTextMock,
} = vi.hoisted(() => ({
  listConversationSessionsSnapshotMock: vi.fn(),
  readConversationSessionMetaMock: vi.fn(),
  readSessionSearchTextMock: vi.fn(),
}));

vi.mock('./conversationService.js', () => ({
  listConversationSessionsSnapshot: listConversationSessionsSnapshotMock,
  readConversationSessionMeta: readConversationSessionMetaMock,
}));

vi.mock('./sessions.js', () => ({
  readSessionSearchText: readSessionSearchTextMock,
}));

import {
  readConversationSessionMetaCapability,
  readConversationSessionSearchIndexCapability,
  readConversationSessionsCapability,
} from './conversationSessionCapability.js';

beforeEach(() => {
  listConversationSessionsSnapshotMock.mockReset();
  readConversationSessionMetaMock.mockReset();
  readSessionSearchTextMock.mockReset();
});

describe('conversationSessionCapability', () => {
  it('reads the decorated session snapshot', () => {
    listConversationSessionsSnapshotMock.mockReturnValue([{ id: 'conversation-1', title: 'Conversation 1' }]);

    expect(readConversationSessionsCapability()).toEqual([{ id: 'conversation-1', title: 'Conversation 1' }]);
    expect(listConversationSessionsSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it('reads normalized session metadata when present', () => {
    readConversationSessionMetaMock.mockReturnValue({ id: 'conversation-1', title: 'Conversation 1' });

    expect(readConversationSessionMetaCapability('  conversation-1  ')).toEqual({ id: 'conversation-1', title: 'Conversation 1' });
    expect(readConversationSessionMetaMock).toHaveBeenCalledWith('conversation-1');
  });

  it('returns null for blank or missing session metadata', () => {
    readConversationSessionMetaMock.mockReturnValue(null);

    expect(readConversationSessionMetaCapability('   ')).toBeNull();
    expect(readConversationSessionMetaMock).not.toHaveBeenCalled();
    expect(readConversationSessionMetaCapability('conversation-missing')).toBeNull();
    expect(readConversationSessionMetaMock).toHaveBeenCalledWith('conversation-missing');
  });

  it('builds a normalized session search index and tolerates missing sessions', () => {
    readSessionSearchTextMock
      .mockReturnValueOnce('hello world')
      .mockReturnValueOnce(null);

    expect(readConversationSessionSearchIndexCapability({
      sessionIds: [' conversation-1 ', 'conversation-2', '', 42],
    })).toEqual({
      index: {
        'conversation-1': 'hello world',
        'conversation-2': '',
      },
    });
    expect(readSessionSearchTextMock).toHaveBeenNthCalledWith(1, 'conversation-1');
    expect(readSessionSearchTextMock).toHaveBeenNthCalledWith(2, 'conversation-2');
  });

  it('returns an empty search index when no valid session ids are provided', () => {
    expect(readConversationSessionSearchIndexCapability({ sessionIds: [null, '   ', 123] })).toEqual({ index: {} });
    expect(readSessionSearchTextMock).not.toHaveBeenCalled();
  });
});
