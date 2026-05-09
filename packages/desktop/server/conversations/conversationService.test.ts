import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  SessionManagerOpenMock,
  ensureConversationAttentionBaselinesMock,
  ensureSessionFileExistsMock,
  existsSyncMock,
  getActivityConversationLinkMock,
  getAvailableModelObjectsMock,
  getLocalLiveSessionsMock,
  listDeferredResumeRecordsMock,
  listProfileActivityEntriesMock,
  listSessionsMock,
  liveSessionRegistry,
  loadDaemonConfigMock,
  loadDeferredResumeStateMock,
  loadProfileActivityReadStateMock,
  markConversationAttentionReadMock,
  markConversationAttentionUnreadMock,
  invalidateAppTopicsMock,
  publishAppEventMock,
  readConversationModelPreferenceSnapshotMock,
  readSavedModelPreferencesMock,
  readSessionBlocksWithTelemetryMock,
  readSessionMetaMock,
  resolveConversationModelPreferenceStateMock,
  resolveDaemonPathsMock,
  statSyncMock,
  summarizeConversationAttentionMock,
} = vi.hoisted(() => ({
  SessionManagerOpenMock: vi.fn(),
  ensureConversationAttentionBaselinesMock: vi.fn(),
  ensureSessionFileExistsMock: vi.fn(),
  existsSyncMock: vi.fn(),
  getActivityConversationLinkMock: vi.fn(),
  getAvailableModelObjectsMock: vi.fn(),
  getLocalLiveSessionsMock: vi.fn(),
  listDeferredResumeRecordsMock: vi.fn(),
  listProfileActivityEntriesMock: vi.fn(),
  listSessionsMock: vi.fn(),
  liveSessionRegistry: new Map<string, unknown>(),
  loadDaemonConfigMock: vi.fn(),
  loadDeferredResumeStateMock: vi.fn(),
  loadProfileActivityReadStateMock: vi.fn(),
  markConversationAttentionReadMock: vi.fn(),
  markConversationAttentionUnreadMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  publishAppEventMock: vi.fn(),
  readConversationModelPreferenceSnapshotMock: vi.fn(),
  readSavedModelPreferencesMock: vi.fn(),
  readSessionBlocksWithTelemetryMock: vi.fn(),
  readSessionMetaMock: vi.fn(),
  resolveConversationModelPreferenceStateMock: vi.fn(),
  resolveDaemonPathsMock: vi.fn(),
  statSyncMock: vi.fn(),
  summarizeConversationAttentionMock: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: existsSyncMock,
    statSync: statSyncMock,
  };
});

vi.mock('@earendil-works/pi-coding-agent', () => ({
  SessionManager: {
    open: SessionManagerOpenMock,
  },
}));

vi.mock('@personal-agent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@personal-agent/core')>();
  return {
    ...actual,
    ensureConversationAttentionBaselines: ensureConversationAttentionBaselinesMock,
    getActivityConversationLink: getActivityConversationLinkMock,
    listDeferredResumeRecords: listDeferredResumeRecordsMock,
    listProfileActivityEntries: listProfileActivityEntriesMock,
    loadDeferredResumeState: loadDeferredResumeStateMock,
    loadProfileActivityReadState: loadProfileActivityReadStateMock,
    markConversationAttentionRead: markConversationAttentionReadMock,
    markConversationAttentionUnread: markConversationAttentionUnreadMock,
    summarizeConversationAttention: summarizeConversationAttentionMock,
  };
});

vi.mock('@personal-agent/daemon', () => ({
  loadDaemonConfig: loadDaemonConfigMock,
  resolveDaemonPaths: resolveDaemonPathsMock,
}));

vi.mock('./liveSessions.js', () => ({
  ensureSessionFileExists: ensureSessionFileExistsMock,
  getAvailableModelObjects: getAvailableModelObjectsMock,
  getLiveSessions: getLocalLiveSessionsMock,
  registry: liveSessionRegistry,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
  publishAppEvent: publishAppEventMock,
}));

vi.mock('./sessions.js', () => ({
  listSessions: listSessionsMock,
  readSessionBlocksWithTelemetry: readSessionBlocksWithTelemetryMock,
  readSessionMeta: readSessionMetaMock,
}));

vi.mock('./conversationModelPreferences.js', () => ({
  readConversationModelPreferenceSnapshot: readConversationModelPreferenceSnapshotMock,
  resolveConversationModelPreferenceState: resolveConversationModelPreferenceStateMock,
}));

vi.mock('../models/modelPreferences.js', () => ({
  readSavedModelPreferences: readSavedModelPreferencesMock,
}));

import {
  getCurrentProfile,
  listAllLiveSessions,
  listConversationSessionsSnapshot,
  parseTailBlocksQuery,
  publishConversationSessionMetaChanged,
  readConversationModelPreferenceStateById,
  readConversationSessionMeta,
  readConversationSessionSignature,
  readSessionDetailForRoute,
  resolveConversationSessionFile,
  setConversationServiceContext,
  toggleConversationAttention,
  toPublicLiveSessionMeta,
} from './conversationService.js';

const defaultPreferences = {
  openConversationIds: [],
  pinnedConversationIds: [],
  archivedConversationIds: [],
  nodeBrowserViews: [],
};

describe('conversationService', () => {
  beforeEach(() => {
    SessionManagerOpenMock.mockReset();
    ensureConversationAttentionBaselinesMock.mockReset();
    ensureSessionFileExistsMock.mockReset();
    existsSyncMock.mockReset();
    getActivityConversationLinkMock.mockReset();
    getAvailableModelObjectsMock.mockReset();
    getLocalLiveSessionsMock.mockReset();
    listDeferredResumeRecordsMock.mockReset();
    listProfileActivityEntriesMock.mockReset();
    listSessionsMock.mockReset();
    liveSessionRegistry.clear();
    loadDaemonConfigMock.mockReset();
    loadDeferredResumeStateMock.mockReset();
    loadProfileActivityReadStateMock.mockReset();
    markConversationAttentionReadMock.mockReset();
    markConversationAttentionUnreadMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    publishAppEventMock.mockReset();
    readConversationModelPreferenceSnapshotMock.mockReset();
    readSavedModelPreferencesMock.mockReset();
    readSessionBlocksWithTelemetryMock.mockReset();
    readSessionMetaMock.mockReset();
    resolveConversationModelPreferenceStateMock.mockReset();
    resolveDaemonPathsMock.mockReset();
    statSyncMock.mockReset();
    summarizeConversationAttentionMock.mockReset();

    existsSyncMock.mockReturnValue(true);
    getActivityConversationLinkMock.mockReturnValue(undefined);
    getAvailableModelObjectsMock.mockReturnValue([{ id: 'gpt-5' }]);
    getLocalLiveSessionsMock.mockReturnValue([]);
    listDeferredResumeRecordsMock.mockReturnValue([]);
    listProfileActivityEntriesMock.mockReturnValue([]);
    listSessionsMock.mockReturnValue([]);
    loadDaemonConfigMock.mockImplementation(() => {
      throw new Error('daemon unavailable');
    });
    loadDeferredResumeStateMock.mockReturnValue({});
    loadProfileActivityReadStateMock.mockReturnValue(new Set());
    readSavedModelPreferencesMock.mockReturnValue({ defaultModel: 'gpt-5', currentServiceTier: '' });
    readSessionBlocksWithTelemetryMock.mockReturnValue({
      detail: null,
      telemetry: { cache: 'miss', loader: 'disk', durationMs: 4 },
    });
    readSessionMetaMock.mockReturnValue(null);
    resolveConversationModelPreferenceStateMock.mockReturnValue({
      currentModel: 'gpt-5',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });
    statSyncMock.mockImplementation(() => {
      throw new Error('stat unavailable');
    });
    summarizeConversationAttentionMock.mockImplementation(({ conversations }: { conversations: Array<{ conversationId: string }> }) =>
      conversations.map((conversation) => ({
        conversationId: conversation.conversationId,
        needsAttention: false,
        attentionUpdatedAt: '2026-04-09T00:00:00.000Z',
        unreadMessageCount: 0,
        unreadActivityCount: 0,
        unreadActivityIds: [],
      })),
    );

    setConversationServiceContext({
      getCurrentProfile: () => 'assistant',
      getRepoRoot: () => '/repo',
      getSavedUiPreferences: () => defaultPreferences,
    });
  });

  it('returns only the public live session fields', () => {
    const input = {
      id: 'conv-123',
      cwd: '/tmp/workspace',
      sessionFile: '/tmp/workspace/session.jsonl',
      title: 'Conversation title',
      isStreaming: true,
      hasPendingHiddenTurn: true,
      session: {
        get theme() {
          throw new Error('Theme not initialized. Call initTheme() first.');
        },
      },
    };

    expect(() => JSON.stringify({ live: true, ...input })).toThrow('Theme not initialized. Call initTheme() first.');

    const result = toPublicLiveSessionMeta(input);

    expect(result).toEqual({
      id: 'conv-123',
      cwd: '/tmp/workspace',
      sessionFile: '/tmp/workspace/session.jsonl',
      title: 'Conversation title',
      isStreaming: true,
      hasPendingHiddenTurn: true,
    });
    expect('session' in result).toBe(false);
    expect(() => JSON.stringify({ live: true, ...result })).not.toThrow();
  });

  it('tracks context and parses bounded integer query values', () => {
    setConversationServiceContext({
      getCurrentProfile: () => 'reviewer',
      getRepoRoot: () => '/alt-repo',
      getSavedUiPreferences: () => defaultPreferences,
    });

    expect(getCurrentProfile()).toBe('reviewer');
    expect(parseTailBlocksQuery('8')).toBe(8);
    expect(parseTailBlocksQuery(['3'])).toBe(3);
    expect(parseTailBlocksQuery('0')).toBeUndefined();
    expect(parseTailBlocksQuery('8abc')).toBeUndefined();
    expect(parseTailBlocksQuery(String(Number.MAX_SAFE_INTEGER + 1))).toBeUndefined();
    expect(parseTailBlocksQuery('5000')).toBe(1000);
  });

  it('publishes deduped session meta change events and refreshes the sessions snapshot', () => {
    publishConversationSessionMetaChanged(' conversation-1 ', undefined, 'conversation-1', null, 'conversation-2');

    expect(publishAppEventMock).toHaveBeenCalledTimes(2);
    expect(publishAppEventMock).toHaveBeenNthCalledWith(1, { type: 'session_meta_changed', sessionId: 'conversation-1' });
    expect(publishAppEventMock).toHaveBeenNthCalledWith(2, { type: 'session_meta_changed', sessionId: 'conversation-2' });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('sessions');
  });

  it('merges live registry state and resolves session files', () => {
    getLocalLiveSessionsMock.mockReturnValue([
      {
        id: 'conversation-1',
        cwd: '/repo/live',
        sessionFile: ' /sessions/live.jsonl ',
        title: 'Live title',
        isStreaming: true,
        hasPendingHiddenTurn: true,
      },
    ]);
    liveSessionRegistry.set('conversation-1', {
      session: { sessionManager: 'session-manager-1' },
    });

    expect(listAllLiveSessions()).toEqual([
      {
        id: 'conversation-1',
        cwd: '/repo/live',
        sessionFile: ' /sessions/live.jsonl ',
        title: 'Live title',
        isStreaming: true,
        hasPendingHiddenTurn: true,
        session: { sessionManager: 'session-manager-1' },
      },
    ]);
    expect(resolveConversationSessionFile('conversation-1')).toBe('/sessions/live.jsonl');
    expect(ensureSessionFileExistsMock).toHaveBeenCalledWith('session-manager-1');

    getLocalLiveSessionsMock.mockReturnValue([]);
    listSessionsMock.mockReturnValue([
      {
        id: 'conversation-2',
        file: '/sessions/stored.jsonl',
        timestamp: '2026-04-09T12:00:00.000Z',
        cwd: '/repo/stored',
        cwdSlug: '-repo-stored',
        model: 'gpt-5',
        title: 'Stored title',
        messageCount: 4,
      },
    ]);

    expect(resolveConversationSessionFile('conversation-2')).toBe('/sessions/stored.jsonl');
  });

  it('reads session signatures and tolerates missing files', () => {
    getLocalLiveSessionsMock.mockReturnValue([
      {
        id: 'conversation-1',
        cwd: '/repo/live',
        sessionFile: '/sessions/live.jsonl',
        isStreaming: false,
      },
    ]);
    liveSessionRegistry.set('conversation-1', {
      session: { sessionManager: 'session-manager-1' },
    });
    statSyncMock.mockReturnValue({ size: 123, mtimeMs: 456 });

    expect(readConversationSessionSignature('conversation-1')).toBe('123:456');

    getLocalLiveSessionsMock.mockReturnValue([]);
    listSessionsMock.mockReturnValue([]);
    existsSyncMock.mockReturnValueOnce(false);
    expect(readConversationSessionSignature('conversation-1')).toBeNull();
  });

  it('builds conversation snapshots from saved workspace state', () => {
    setConversationServiceContext({
      getCurrentProfile: () => 'assistant',
      getRepoRoot: () => '/repo',
      getSavedUiPreferences: () => ({
        openConversationIds: ['workspace-1'],
        pinnedConversationIds: ['pinned-1'],
        archivedConversationIds: ['archived-1'],
        nodeBrowserViews: [],
      }),
    });
    listDeferredResumeRecordsMock.mockReturnValue([
      {
        id: 'resume-1',
        sessionFile: '/sessions/review-1.jsonl',
        prompt: 'Resume the review',
        dueAt: '2026-04-10T00:00:00.000Z',
        createdAt: '2026-04-09T00:00:00.000Z',
        attempts: 0,
        status: 'ready',
        readyAt: '2026-04-09T12:30:00.000Z',
        kind: 'continue',
        title: 'Review follow-up',
        delivery: {
          alertLevel: 'none',
          autoResumeIfOpen: true,
          requireAck: false,
        },
      },
    ]);
    listSessionsMock.mockReturnValue([
      {
        id: 'workspace-1',
        file: '/sessions/workspace-1.jsonl',
        timestamp: '2026-04-09T12:00:00.000Z',
        cwd: '/repo/workspace',
        cwdSlug: '-repo-workspace',
        model: 'gpt-5',
        title: 'Workspace title',
        messageCount: 3,
      },
      {
        id: 'pinned-1',
        file: '/sessions/pinned-1.jsonl',
        timestamp: '2026-04-09T11:00:00.000Z',
        cwd: '/repo/pinned',
        cwdSlug: '-repo-pinned',
        model: 'gpt-5',
        title: 'Pinned title',
        messageCount: 2,
      },
      {
        id: 'review-1',
        file: '/sessions/review-1.jsonl',
        timestamp: '2026-04-09T10:00:00.000Z',
        cwd: '/repo/review',
        cwdSlug: '-repo-review',
        model: 'gpt-5',
        title: 'Needs review',
        messageCount: 4,
      },
      {
        id: 'archived-1',
        file: '/sessions/archived-1.jsonl',
        timestamp: '2026-04-09T09:00:00.000Z',
        cwd: '/repo/archived',
        cwdSlug: '-repo-archived',
        model: 'gpt-5',
        title: 'Archived title',
        messageCount: 1,
      },
    ]);
    getLocalLiveSessionsMock.mockReturnValue([
      {
        id: 'live-1',
        cwd: '/repo/live-only',
        sessionFile: '/sessions/live-1.jsonl',
        isStreaming: false,
      },
      {
        id: 'hidden-turn-1',
        cwd: '/repo/hidden-turn',
        sessionFile: '/sessions/hidden-turn-1.jsonl',
        isStreaming: false,
        hasPendingHiddenTurn: true,
      },
      {
        id: 'workspace-1',
        cwd: '/repo/workspace',
        sessionFile: '/sessions/workspace-1.jsonl',
        title: 'Live workspace',
        isStreaming: true,
      },
      {
        id: 'optimistic-running-1',
        cwd: '/repo/optimistic',
        sessionFile: '/sessions/optimistic-running-1.jsonl',
        title: 'Optimistic running',
        isStreaming: false,
        lastDurableRunState: 'running',
      },
    ]);
    summarizeConversationAttentionMock.mockImplementation(({ conversations }: { conversations: Array<{ conversationId: string }> }) =>
      conversations.map((conversation) => ({
        conversationId: conversation.conversationId,
        needsAttention: conversation.conversationId === 'review-1',
        attentionUpdatedAt: '2026-04-09T12:00:00.000Z',
        unreadMessageCount: conversation.conversationId === 'review-1' ? 2 : 0,
        unreadActivityCount: 0,
        unreadActivityIds: [],
      })),
    );

    const snapshot = listConversationSessionsSnapshot();
    expect(snapshot).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'live-1',
          title: 'New Conversation',
          isLive: true,
          isRunning: false,
        }),
        expect.objectContaining({
          id: 'hidden-turn-1',
          isLive: true,
          isRunning: true,
        }),
        expect.objectContaining({
          id: 'workspace-1',
          title: 'Live workspace',
          isLive: true,
          isRunning: true,
        }),
        expect.objectContaining({
          id: 'optimistic-running-1',
          isLive: true,
          isRunning: true,
        }),
        expect.objectContaining({
          id: 'review-1',
          needsAttention: true,
          deferredResumes: [expect.objectContaining({ id: 'resume-1', prompt: 'Resume the review' })],
        }),
      ]),
    );

    expect(toggleConversationAttention({ profile: 'assistant', conversationId: 'review-1', read: false })).toBe(true);
    expect(markConversationAttentionUnreadMock).toHaveBeenCalledWith({
      profile: 'assistant',
      conversationId: 'review-1',
      messageCount: 4,
    });
    expect(toggleConversationAttention({ profile: 'assistant', conversationId: 'workspace-1' })).toBe(true);
    expect(markConversationAttentionReadMock).toHaveBeenCalledWith({
      profile: 'assistant',
      conversationId: 'workspace-1',
      messageCount: 3,
    });
    expect(toggleConversationAttention({ profile: 'assistant', conversationId: 'missing' })).toBe(false);
  });

  it('reads isRunning from the live entry running field when present', () => {
    readSessionMetaMock.mockReturnValue({
      id: 'live-running',
      file: '/sessions/live-running.jsonl',
      timestamp: '2026-04-09T09:00:00.000Z',
      cwd: '/repo/live',
      cwdSlug: '-repo-live',
      model: 'gpt-5',
      title: 'Running conversation',
      messageCount: 2,
    });
    getLocalLiveSessionsMock.mockReturnValue([
      {
        id: 'live-running',
        cwd: '/repo/live',
        sessionFile: '/sessions/live-running.jsonl',
        running: true,
        isStreaming: false,
      },
    ]);

    const meta = readConversationSessionMeta('live-running');
    expect(meta).toEqual(
      expect.objectContaining({
        id: 'live-running',
        isLive: true,
        isRunning: true,
      }),
    );
  });

  it('falls back to legacy derivation when live entry has no running field', () => {
    readSessionMetaMock.mockReturnValue({
      id: 'fallback',
      file: '/sessions/fallback.jsonl',
      timestamp: '2026-04-09T09:00:00.000Z',
      cwd: '/repo/fallback',
      cwdSlug: '-repo-fallback',
      model: 'gpt-5',
      title: 'Fallback test',
      messageCount: 1,
    });
    getLocalLiveSessionsMock.mockReturnValue([
      {
        id: 'fallback',
        cwd: '/repo/fallback',
        sessionFile: '/sessions/fallback.jsonl',
        // no `running` field — exercise the legacy derivation path
        isStreaming: false,
        hasPendingHiddenTurn: true,
      },
    ]);

    const meta = readConversationSessionMeta('fallback');
    expect(meta).toEqual(
      expect.objectContaining({
        id: 'fallback',
        isLive: true,
        isRunning: true, // from hasPendingHiddenTurn via fallback path
      }),
    );
  });

  it('reads route session detail and model preference state', async () => {
    readSessionBlocksWithTelemetryMock.mockReturnValueOnce({
      detail: { id: 'detail-1' },
      telemetry: { cache: 'hit', loader: 'disk', durationMs: 2 },
    });

    await expect(
      readSessionDetailForRoute({
        conversationId: 'conversation-1',
        profile: 'assistant',
        tailBlocks: 5,
      }),
    ).resolves.toEqual({
      sessionRead: {
        detail: { id: 'detail-1' },
        telemetry: { cache: 'hit', loader: 'disk', durationMs: 2 },
      },
      remoteMirror: { status: 'deferred', durationMs: 0 },
    });
    expect(readSessionBlocksWithTelemetryMock).toHaveBeenCalledWith('conversation-1', { tailBlocks: 5 });

    readSessionBlocksWithTelemetryMock.mockReturnValueOnce({
      detail: { id: 'detail-capped' },
      telemetry: { cache: 'hit', loader: 'disk', durationMs: 2 },
    });
    await expect(
      readSessionDetailForRoute({
        conversationId: 'conversation-capped',
        profile: 'assistant',
        tailBlocks: 5000,
      }),
    ).resolves.toMatchObject({ sessionRead: { detail: { id: 'detail-capped' } } });
    expect(readSessionBlocksWithTelemetryMock).toHaveBeenLastCalledWith('conversation-capped', { tailBlocks: 1000 });

    readSessionBlocksWithTelemetryMock.mockReturnValueOnce({
      detail: null,
      telemetry: { cache: 'miss', loader: 'disk', durationMs: 3 },
    });
    await expect(
      readSessionDetailForRoute({
        conversationId: 'conversation-2',
        profile: 'assistant',
      }),
    ).resolves.toEqual({
      sessionRead: {
        detail: null,
        telemetry: { cache: 'miss', loader: 'disk', durationMs: 3 },
      },
      remoteMirror: { status: 'not-remote', durationMs: 0 },
    });
    expect(readSessionBlocksWithTelemetryMock).toHaveBeenLastCalledWith('conversation-2', undefined);

    getLocalLiveSessionsMock.mockReturnValue([
      {
        id: 'conversation-3',
        cwd: '/repo/live',
        sessionFile: '/sessions/conversation-3.jsonl',
        isStreaming: false,
      },
    ]);
    SessionManagerOpenMock.mockReturnValue({ id: 'session-manager' });
    readConversationModelPreferenceSnapshotMock.mockReturnValue({ model: 'gpt-5' });

    await expect(readConversationModelPreferenceStateById('conversation-3')).resolves.toEqual({
      currentModel: 'gpt-5',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });
    expect(SessionManagerOpenMock).toHaveBeenCalledWith('/sessions/conversation-3.jsonl');
    expect(readSavedModelPreferencesMock).toHaveBeenCalledWith(expect.any(String), [{ id: 'gpt-5' }]);
    expect(resolveConversationModelPreferenceStateMock).toHaveBeenCalledWith(
      { model: 'gpt-5' },
      { defaultModel: 'gpt-5', currentServiceTier: '' },
      [{ id: 'gpt-5' }],
    );

    getLocalLiveSessionsMock.mockReturnValue([]);
    listSessionsMock.mockReturnValue([]);
    existsSyncMock.mockReturnValueOnce(false);
    await expect(readConversationModelPreferenceStateById('missing')).resolves.toBeNull();
  });
});
