import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clearActivityAttentionForCurrentProfileMock,
  createLiveSessionMock,
  findActivityRecordMock,
  invalidateAppTopicsMock,
  listActivityForCurrentProfileMock,
  listConversationSessionsSnapshotMock,
  markActivityReadStateMock,
  queuePromptContextMock,
  resolveConversationCwdMock,
  setActivityConversationLinksMock,
  toggleConversationAttentionMock,
} = vi.hoisted(() => ({
  clearActivityAttentionForCurrentProfileMock: vi.fn(),
  createLiveSessionMock: vi.fn(),
  findActivityRecordMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  listActivityForCurrentProfileMock: vi.fn(),
  listConversationSessionsSnapshotMock: vi.fn(),
  markActivityReadStateMock: vi.fn(),
  queuePromptContextMock: vi.fn(),
  resolveConversationCwdMock: vi.fn(),
  setActivityConversationLinksMock: vi.fn(),
  toggleConversationAttentionMock: vi.fn(),
}));

vi.mock('@personal-agent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@personal-agent/core')>();
  return {
    ...actual,
    setActivityConversationLinks: setActivityConversationLinksMock,
  };
});

vi.mock('./inboxService.js', () => ({
  clearActivityAttentionForCurrentProfile: clearActivityAttentionForCurrentProfileMock,
  findActivityRecord: findActivityRecordMock,
  listActivityForCurrentProfile: listActivityForCurrentProfileMock,
  markActivityReadState: markActivityReadStateMock,
}));

vi.mock('../conversations/conversationCwd.js', () => ({
  resolveConversationCwd: resolveConversationCwdMock,
}));

vi.mock('../conversations/conversationService.js', () => ({
  listConversationSessionsSnapshot: listConversationSessionsSnapshotMock,
  toggleConversationAttention: toggleConversationAttentionMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  createSession: createLiveSessionMock,
  queuePromptContext: queuePromptContextMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

import {
  clearActivityAttentionCapability,
  markActivityReadCapability,
  markConversationAttentionCapability,
  readActivityDetailCapability,
  readActivityEntriesCapability,
  startActivityConversationCapability,
} from './inboxCapability.js';

describe('activityAttentionCapability', () => {
  beforeEach(() => {
    clearActivityAttentionForCurrentProfileMock.mockReset();
    createLiveSessionMock.mockReset();
    findActivityRecordMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    listActivityForCurrentProfileMock.mockReset();
    listConversationSessionsSnapshotMock.mockReset();
    markActivityReadStateMock.mockReset();
    queuePromptContextMock.mockReset();
    resolveConversationCwdMock.mockReset();
    setActivityConversationLinksMock.mockReset();
    toggleConversationAttentionMock.mockReset();
  });

  it('reads activity entries and merges read state into details', () => {
    listActivityForCurrentProfileMock.mockReturnValue([
      { id: 'activity-1', read: false },
      { id: 'activity-2', read: true },
      { id: 'activity-3' },
    ]);
    findActivityRecordMock.mockReturnValue({
      entry: { id: 'activity-1', summary: 'Watch deploys' },
      read: true,
    });

    expect(readActivityEntriesCapability('assistant')).toEqual([
      { id: 'activity-1', read: false },
      { id: 'activity-2', read: true },
      { id: 'activity-3' },
    ]);
    expect(readActivityDetailCapability('assistant', ' activity-1 ')).toEqual({
      id: 'activity-1',
      summary: 'Watch deploys',
      read: true,
    });
    expect(readActivityDetailCapability('assistant', '   ')).toBeUndefined();

    expect(listActivityForCurrentProfileMock).toHaveBeenCalledWith('assistant');
    expect(findActivityRecordMock).toHaveBeenCalledWith('assistant', 'activity-1');
  });

  it('marks activity read state and invalidates only when the state changes', () => {
    markActivityReadStateMock.mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(markActivityReadCapability('assistant', 'activity-1', false)).toBe(true);
    expect(markActivityReadCapability('assistant', 'missing', true)).toBe(false);
    expect(markActivityReadCapability('assistant', '   ', true)).toBe(false);

    expect(markActivityReadStateMock).toHaveBeenNthCalledWith(1, 'assistant', 'activity-1', false);
    expect(markActivityReadStateMock).toHaveBeenNthCalledWith(2, 'assistant', 'missing', true);
    expect(invalidateAppTopicsMock).toHaveBeenCalledTimes(1);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('sessions');
  });

  it('clears activity attention state and invalidates when entries change', () => {
    listConversationSessionsSnapshotMock.mockReturnValue([{ id: 'conversation-1', messageCount: 3 }]);
    clearActivityAttentionForCurrentProfileMock
      .mockReturnValueOnce({
        deletedActivityIds: ['activity-1'],
        clearedConversationIds: ['conversation-1'],
      })
      .mockReturnValueOnce({
        deletedActivityIds: [],
        clearedConversationIds: [],
      });

    expect(clearActivityAttentionCapability({
      profile: 'assistant',
      openConversationIds: ['open-1', 'pinned-1'],
    })).toEqual({
      deletedActivityIds: ['activity-1'],
      clearedConversationIds: ['conversation-1'],
    });

    expect(clearActivityAttentionCapability('assistant', {
      openConversationIds: [],
      pinnedConversationIds: ['pinned-2'],
      archivedConversationIds: [],
      nodeBrowserViews: [],
    })).toEqual({
      deletedActivityIds: [],
      clearedConversationIds: [],
    });

    expect(clearActivityAttentionForCurrentProfileMock).toHaveBeenNthCalledWith(1, {
      profile: 'assistant',
      sessions: [{ id: 'conversation-1', messageCount: 3 }],
      openConversationIds: ['open-1', 'pinned-1'],
    });
    expect(clearActivityAttentionForCurrentProfileMock).toHaveBeenNthCalledWith(2, {
      profile: 'assistant',
      sessions: [{ id: 'conversation-1', messageCount: 3 }],
      openConversationIds: ['pinned-2'],
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledTimes(1);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('sessions');
  });

  it('starts activity conversations, writes durable context, and invalidates snapshots', async () => {
    findActivityRecordMock.mockReturnValue({
      stateRoot: '/state-root',
      entry: {
        id: 'activity-1',
        kind: 'reminder',
        createdAt: '2026-04-09T17:00:00.000Z',
        summary: 'Review the deploy diff',
        details: 'Look at the staging rollout before merging.',
        notificationState: 'delivered',
        relatedConversationIds: ['conversation-0'],
      },
    });
    resolveConversationCwdMock.mockReturnValue('/repo/worktree');
    createLiveSessionMock.mockResolvedValue({ id: 'conversation-1', sessionFile: '/sessions/conversation-1.json' });

    const result = await startActivityConversationCapability('activity-1', {
      getCurrentProfile: () => 'assistant',
      getRepoRoot: () => '/repo',
      getDefaultWebCwd: () => '/default-cwd',
      buildLiveSessionResourceOptions: () => ({ additionalExtensionPaths: ['extensions'] }),
      buildLiveSessionExtensionFactories: () => ['factory'],
      getSavedWebUiPreferences: () => ({
        openConversationIds: [],
        pinnedConversationIds: [],
        archivedConversationIds: [],
        nodeBrowserViews: [],
      }),
    });

    expect(resolveConversationCwdMock).toHaveBeenCalledWith({
      repoRoot: '/repo',
      profile: 'assistant',
      defaultCwd: '/default-cwd',
    });
    expect(createLiveSessionMock).toHaveBeenCalledWith('/repo/worktree', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
    });
    expect(setActivityConversationLinksMock).toHaveBeenCalledWith({
      stateRoot: '/state-root',
      profile: 'assistant',
      activityId: 'activity-1',
      relatedConversationIds: ['conversation-0', 'conversation-1'],
    });
    expect(queuePromptContextMock).toHaveBeenCalledWith(
      'conversation-1',
      'referenced_context',
      expect.stringContaining('Activity context for this conversation:'),
    );
    expect(queuePromptContextMock).toHaveBeenCalledWith(
      'conversation-1',
      'referenced_context',
      expect.stringContaining('- notification state: delivered'),
    );
    expect(queuePromptContextMock).toHaveBeenCalledWith(
      'conversation-1',
      'referenced_context',
      expect.stringContaining('Look at the staging rollout before merging.'),
    );
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('sessions');
    expect(result).toEqual({
      activityId: 'activity-1',
      id: 'conversation-1',
      sessionFile: '/sessions/conversation-1.json',
      cwd: '/repo/worktree',
      relatedConversationIds: ['conversation-0', 'conversation-1'],
    });
  });

  it('marks conversation attention and invalidates session snapshots only when updated', () => {
    toggleConversationAttentionMock.mockReturnValueOnce(true).mockReturnValueOnce(false);

    expect(markConversationAttentionCapability('assistant', 'conversation-1', false)).toBe(true);
    expect(markConversationAttentionCapability('assistant', 'missing', true)).toBe(false);
    expect(markConversationAttentionCapability('assistant', '   ', true)).toBe(false);

    expect(toggleConversationAttentionMock).toHaveBeenNthCalledWith(1, {
      profile: 'assistant',
      conversationId: 'conversation-1',
      read: false,
    });
    expect(toggleConversationAttentionMock).toHaveBeenNthCalledWith(2, {
      profile: 'assistant',
      conversationId: 'missing',
      read: true,
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledTimes(1);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('sessions');
  });
});
