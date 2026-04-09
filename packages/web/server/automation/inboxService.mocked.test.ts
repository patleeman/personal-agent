import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clearActivityConversationLinksMock,
  deleteProfileActivityEntriesMock,
  getActivityConversationLinkMock,
  listArchivedAttentionSessionsMock,
  listProfileActivityEntriesMock,
  listStandaloneActivityRecordsMock,
  loadDaemonConfigMock,
  loadProfileActivityReadStateMock,
  markConversationAttentionReadMock,
  resolveDaemonPathsMock,
  saveProfileActivityReadStateMock,
} = vi.hoisted(() => ({
  clearActivityConversationLinksMock: vi.fn(),
  deleteProfileActivityEntriesMock: vi.fn(),
  getActivityConversationLinkMock: vi.fn(),
  listArchivedAttentionSessionsMock: vi.fn(),
  listProfileActivityEntriesMock: vi.fn(),
  listStandaloneActivityRecordsMock: vi.fn(),
  loadDaemonConfigMock: vi.fn(),
  loadProfileActivityReadStateMock: vi.fn(),
  markConversationAttentionReadMock: vi.fn(),
  resolveDaemonPathsMock: vi.fn(),
  saveProfileActivityReadStateMock: vi.fn(),
}));

vi.mock('@personal-agent/daemon', () => ({
  loadDaemonConfig: loadDaemonConfigMock,
  resolveDaemonPaths: resolveDaemonPathsMock,
}));

vi.mock('@personal-agent/core', () => ({
  clearActivityConversationLinks: clearActivityConversationLinksMock,
  deleteProfileActivityEntries: deleteProfileActivityEntriesMock,
  getActivityConversationLink: getActivityConversationLinkMock,
  listProfileActivityEntries: listProfileActivityEntriesMock,
  loadProfileActivityReadState: loadProfileActivityReadStateMock,
  markConversationAttentionRead: markConversationAttentionReadMock,
  saveProfileActivityReadState: saveProfileActivityReadStateMock,
}));

vi.mock('./inbox.js', () => ({
  listArchivedAttentionSessions: listArchivedAttentionSessionsMock,
  listStandaloneActivityRecords: listStandaloneActivityRecordsMock,
}));

import {
  clearInboxForCurrentProfile,
  findActivityRecord,
  listActivityForCurrentProfile,
  markActivityReadState,
} from './inboxService.js';

describe('inboxService', () => {
  beforeEach(() => {
    clearActivityConversationLinksMock.mockReset();
    deleteProfileActivityEntriesMock.mockReset();
    getActivityConversationLinkMock.mockReset();
    listArchivedAttentionSessionsMock.mockReset();
    listProfileActivityEntriesMock.mockReset();
    listStandaloneActivityRecordsMock.mockReset();
    loadDaemonConfigMock.mockReset();
    loadProfileActivityReadStateMock.mockReset();
    markConversationAttentionReadMock.mockReset();
    resolveDaemonPathsMock.mockReset();
    saveProfileActivityReadStateMock.mockReset();

    loadDaemonConfigMock.mockReturnValue({ ipc: { socketPath: '/tmp/personal-agentd.sock' } });
    resolveDaemonPathsMock.mockReturnValue({ root: '/daemon-root' });
    getActivityConversationLinkMock.mockReturnValue(undefined);
    listArchivedAttentionSessionsMock.mockReturnValue([]);
    listStandaloneActivityRecordsMock.mockReturnValue([]);
    deleteProfileActivityEntriesMock.mockReturnValue([]);
    loadProfileActivityReadStateMock.mockReturnValue(new Set());
  });

  it('lists activity across state roots, sorts and dedupes duplicates, and finds records', () => {
    listProfileActivityEntriesMock.mockImplementation(({ stateRoot }) => {
      if (stateRoot === '/daemon-root') {
        return [
          { entry: { id: 'dup', createdAt: '2026-04-09T10:00:00.000Z', summary: 'daemon duplicate' } },
          { entry: { id: 'linked', createdAt: '2026-04-09T11:00:00.000Z', summary: 'linked entry' } },
        ];
      }

      return [
        { entry: { id: 'dup', createdAt: '2026-04-09T10:00:00.000Z', summary: 'local duplicate' } },
        { entry: { id: 'older', createdAt: '2026-04-09T09:00:00.000Z', summary: 'older entry' } },
      ];
    });
    loadProfileActivityReadStateMock.mockImplementation(({ stateRoot }) => new Set(stateRoot ? ['linked'] : ['dup']));
    getActivityConversationLinkMock.mockImplementation(({ activityId }) => activityId === 'linked'
      ? { relatedConversationIds: ['conversation-1'] }
      : undefined);

    expect(listActivityForCurrentProfile('assistant')).toEqual([
      {
        id: 'linked',
        createdAt: '2026-04-09T11:00:00.000Z',
        summary: 'linked entry',
        relatedConversationIds: ['conversation-1'],
        read: true,
      },
      {
        id: 'dup',
        createdAt: '2026-04-09T10:00:00.000Z',
        summary: 'local duplicate',
        read: true,
      },
      {
        id: 'older',
        createdAt: '2026-04-09T09:00:00.000Z',
        summary: 'older entry',
        read: false,
      },
    ]);

    expect(findActivityRecord('assistant', 'dup')).toEqual({
      stateRoot: undefined,
      entry: {
        id: 'dup',
        createdAt: '2026-04-09T10:00:00.000Z',
        summary: 'local duplicate',
      },
      read: true,
    });
    expect(findActivityRecord('assistant', 'missing')).toBeUndefined();
    expect(getActivityConversationLinkMock).toHaveBeenCalledWith({
      stateRoot: '/daemon-root',
      profile: 'assistant',
      activityId: 'linked',
    });
  });

  it('falls back to the default state root and updates read state only for matching activity ids', () => {
    loadDaemonConfigMock.mockImplementation(() => {
      throw new Error('daemon config unavailable');
    });
    listProfileActivityEntriesMock.mockImplementation(({ stateRoot }) => stateRoot === undefined
      ? [{ entry: { id: 'activity-1', createdAt: '2026-04-09T10:00:00.000Z' } }]
      : []);
    loadProfileActivityReadStateMock.mockImplementation(() => new Set(['activity-1']));

    expect(markActivityReadState('assistant', 'activity-1', false)).toBe(true);
    expect(saveProfileActivityReadStateMock).toHaveBeenCalledWith({
      stateRoot: undefined,
      profile: 'assistant',
      ids: new Set(),
    });
    expect(listProfileActivityEntriesMock).toHaveBeenCalledTimes(1);

    saveProfileActivityReadStateMock.mockClear();
    expect(markActivityReadState('assistant', 'missing', true)).toBe(false);
    expect(saveProfileActivityReadStateMock).not.toHaveBeenCalled();
  });

  it('clears normalized standalone activity ids, ignores read-state save failures, and dedupes sessions when clearing the inbox', () => {
    listProfileActivityEntriesMock.mockImplementation(({ stateRoot }) => {
      if (stateRoot === '/daemon-root') {
        return [{ entry: { id: 'daemon-delete', createdAt: '2026-04-09T08:00:00.000Z' } }];
      }

      return [
        { entry: { id: 'delete-me', createdAt: '2026-04-09T09:00:00.000Z' } },
        { entry: { id: 'keep', createdAt: '2026-04-09T10:00:00.000Z' } },
      ];
    });
    loadProfileActivityReadStateMock.mockImplementation(({ stateRoot }) => new Set(stateRoot ? ['daemon-delete'] : ['delete-me']));
    listStandaloneActivityRecordsMock.mockReturnValue([
      { entry: { id: ' delete-me ' }, read: false },
      { entry: { id: 'delete-me' }, read: false },
      { entry: { id: '' }, read: false },
      { entry: { id: 'daemon-delete' }, read: false },
    ]);
    listArchivedAttentionSessionsMock.mockReturnValue([
      { id: 'conversation-1', messageCount: 1 },
      { id: 'conversation-1', messageCount: 9 },
      { id: 'conversation-2', messageCount: 3 },
    ]);
    deleteProfileActivityEntriesMock.mockImplementation(({ stateRoot }) => stateRoot === '/daemon-root'
      ? ['daemon-delete']
      : ['delete-me']);
    saveProfileActivityReadStateMock.mockImplementation(() => {
      throw new Error('disk full');
    });

    expect(clearInboxForCurrentProfile({
      profile: 'assistant',
      sessions: [{ id: 'conversation-1', messageCount: 2, needsAttention: true }],
      openConversationIds: ['conversation-3'],
    })).toEqual({
      deletedActivityIds: ['delete-me', 'daemon-delete'],
      clearedConversationIds: ['conversation-1', 'conversation-2'],
    });

    expect(deleteProfileActivityEntriesMock).toHaveBeenCalledWith({
      stateRoot: undefined,
      profile: 'assistant',
      activityIds: ['delete-me'],
    });
    expect(deleteProfileActivityEntriesMock).toHaveBeenCalledWith({
      stateRoot: '/daemon-root',
      profile: 'assistant',
      activityIds: ['daemon-delete'],
    });
    expect(clearActivityConversationLinksMock).toHaveBeenCalledWith({
      stateRoot: undefined,
      profile: 'assistant',
      activityId: 'delete-me',
    });
    expect(clearActivityConversationLinksMock).toHaveBeenCalledWith({
      stateRoot: '/daemon-root',
      profile: 'assistant',
      activityId: 'daemon-delete',
    });
    expect(markConversationAttentionReadMock).toHaveBeenCalledTimes(2);
    expect(markConversationAttentionReadMock).toHaveBeenNthCalledWith(1, {
      profile: 'assistant',
      conversationId: 'conversation-1',
      messageCount: 9,
    });
    expect(markConversationAttentionReadMock).toHaveBeenNthCalledWith(2, {
      profile: 'assistant',
      conversationId: 'conversation-2',
      messageCount: 3,
    });
  });

  it('returns empty results when there is nothing to clear', () => {
    listProfileActivityEntriesMock.mockReturnValue([]);
    listStandaloneActivityRecordsMock.mockReturnValue([]);
    listArchivedAttentionSessionsMock.mockReturnValue([]);

    expect(clearInboxForCurrentProfile({
      profile: 'assistant',
      sessions: [],
      openConversationIds: [],
    })).toEqual({
      deletedActivityIds: [],
      clearedConversationIds: [],
    });

    expect(deleteProfileActivityEntriesMock).not.toHaveBeenCalled();
    expect(markConversationAttentionReadMock).not.toHaveBeenCalled();
    expect(saveProfileActivityReadStateMock).not.toHaveBeenCalled();
  });
});
