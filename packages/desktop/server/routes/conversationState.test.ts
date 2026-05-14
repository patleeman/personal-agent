import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  SessionManagerOpenMock,
  applyConversationModelPreferencesToSessionManagerMock,
  buildAppendOnlySessionDetailResponseMock,
  createSessionFromExistingMock,
  createWebLiveConversationRunIdMock,
  destroySessionMock,
  ensureRequestControlsLocalLiveConversationMock,
  existsSyncMock,
  getAvailableModelObjectsMock,
  getDurableRunMock,
  isLocalLiveMock,
  listAllLiveSessionsMock,
  liveRegistry,
  logErrorMock,
  publishAppEventMock,
  recoverConversationCapabilityMock,
  readConversationAutoModeStateFromSessionManagerMock,
  readLiveSessionAutoModeStateMock,
  buildModeContextMessageMock,
  logSlowConversationPerfMock,
  parsePendingOperationMock,
  parseTailBlocksQueryMock,
  promptLocalSessionMock,
  publishConversationSessionMetaChangedMock,
  queuePromptContextMock,
  requestConversationAutoModeTurnMock,
  readConversationModelPreferenceStateByIdMock,
  readConversationSessionSignatureMock,
  readSavedModelPreferencesMock,
  readSessionBlocksMock,
  readSessionDetailForRouteMock,
  renameSessionMock,
  renameStoredSessionMock,
  resolveConversationSessionFileMock,
  resolveRequestedCwdMock,
  resumeLocalSessionMock,
  setServerTimingHeadersMock,
  statSyncMock,
  setLiveSessionAutoModeStateMock,
  syncWebLiveConversationRunMock,
  toPublicLiveSessionMetaMock,
  updateLiveSessionModelPreferencesMock,
  writeConversationAutoModeStateMock,
  writeLiveConversationControlErrorMock,
} = vi.hoisted(() => ({
  SessionManagerOpenMock: vi.fn(),
  applyConversationModelPreferencesToSessionManagerMock: vi.fn(),
  buildAppendOnlySessionDetailResponseMock: vi.fn(),
  createSessionFromExistingMock: vi.fn(),
  createWebLiveConversationRunIdMock: vi.fn(),
  destroySessionMock: vi.fn(),
  ensureRequestControlsLocalLiveConversationMock: vi.fn(),
  existsSyncMock: vi.fn(),
  getAvailableModelObjectsMock: vi.fn(),
  getDurableRunMock: vi.fn(),
  isLocalLiveMock: vi.fn(),
  listAllLiveSessionsMock: vi.fn(),
  liveRegistry: new Map<string, unknown>(),
  logErrorMock: vi.fn(),
  logSlowConversationPerfMock: vi.fn(),
  publishAppEventMock: vi.fn(),
  recoverConversationCapabilityMock: vi.fn(),
  readConversationAutoModeStateFromSessionManagerMock: vi.fn(),
  readLiveSessionAutoModeStateMock: vi.fn(),
  buildModeContextMessageMock: vi.fn(),
  parsePendingOperationMock: vi.fn(),
  parseTailBlocksQueryMock: vi.fn(),
  promptLocalSessionMock: vi.fn(),
  publishConversationSessionMetaChangedMock: vi.fn(),
  queuePromptContextMock: vi.fn(),
  requestConversationAutoModeTurnMock: vi.fn(),
  readConversationModelPreferenceStateByIdMock: vi.fn(),
  readConversationSessionSignatureMock: vi.fn(),
  readSavedModelPreferencesMock: vi.fn(),
  readSessionBlocksMock: vi.fn(),
  readSessionDetailForRouteMock: vi.fn(),
  renameSessionMock: vi.fn(),
  renameStoredSessionMock: vi.fn(),
  resolveConversationSessionFileMock: vi.fn(),
  resolveRequestedCwdMock: vi.fn(),
  resumeLocalSessionMock: vi.fn(),
  setServerTimingHeadersMock: vi.fn(),
  statSyncMock: vi.fn(),
  setLiveSessionAutoModeStateMock: vi.fn(),
  syncWebLiveConversationRunMock: vi.fn(),
  toPublicLiveSessionMetaMock: vi.fn(),
  updateLiveSessionModelPreferencesMock: vi.fn(),
  writeConversationAutoModeStateMock: vi.fn(),
  writeLiveConversationControlErrorMock: vi.fn(),
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

vi.mock('@personal-agent/daemon', () => ({
  parsePendingOperation: parsePendingOperationMock,
}));

vi.mock('../conversations/conversationModelPreferences.js', () => ({
  applyConversationModelPreferencesToSessionManager: applyConversationModelPreferencesToSessionManagerMock,
}));

vi.mock('../conversations/conversationRuns.js', () => ({
  createWebLiveConversationRunId: createWebLiveConversationRunIdMock,
  syncWebLiveConversationRun: syncWebLiveConversationRunMock,
}));

vi.mock('../conversations/conversationService.js', () => ({
  listAllLiveSessions: listAllLiveSessionsMock,
  parseTailBlocksQuery: parseTailBlocksQueryMock,
  publishConversationSessionMetaChanged: publishConversationSessionMetaChangedMock,
  readConversationModelPreferenceStateById: readConversationModelPreferenceStateByIdMock,
  readConversationSessionSignature: readConversationSessionSignatureMock,
  readSessionDetailForRoute: readSessionDetailForRouteMock,
  resolveConversationSessionFile: resolveConversationSessionFileMock,
  toPublicLiveSessionMeta: toPublicLiveSessionMetaMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  createSessionFromExisting: createSessionFromExistingMock,
  destroySession: destroySessionMock,
  getAvailableModelObjects: getAvailableModelObjectsMock,
  isLive: isLocalLiveMock,
  promptSession: promptLocalSessionMock,
  queuePromptContext: queuePromptContextMock,
  readLiveSessionAutoModeState: readLiveSessionAutoModeStateMock,
  requestConversationAutoModeTurn: requestConversationAutoModeTurnMock,
  registry: liveRegistry,
  renameSession: renameSessionMock,
  resumeSession: resumeLocalSessionMock,
  setLiveSessionAutoModeState: setLiveSessionAutoModeStateMock,
  updateLiveSessionModelPreferences: updateLiveSessionModelPreferencesMock,
}));

vi.mock('../conversations/sessions.js', () => ({
  buildAppendOnlySessionDetailResponse: buildAppendOnlySessionDetailResponseMock,
  readSessionBlocks: readSessionBlocksMock,
  renameStoredSession: renameStoredSessionMock,
  appendConversationWorkspaceMetadata: vi.fn(),
}));

vi.mock('../models/modelPreferences.js', () => ({
  readSavedModelPreferences: readSavedModelPreferencesMock,
}));

vi.mock('../automation/durableRuns.js', () => ({
  getDurableRun: getDurableRunMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
  logSlowConversationPerf: logSlowConversationPerfMock,
  setServerTimingHeaders: setServerTimingHeadersMock,
}));

vi.mock('../conversations/conversationCwd.js', () => ({
  resolveRequestedCwd: resolveRequestedCwdMock,
}));

vi.mock('./liveSessions.js', () => ({
  ensureRequestControlsLocalLiveConversation: ensureRequestControlsLocalLiveConversationMock,
  writeLiveConversationControlError: writeLiveConversationControlErrorMock,
}));

vi.mock('../conversations/conversationAutoMode.js', () => ({
  readConversationAutoModeStateFromSessionManager: readConversationAutoModeStateFromSessionManagerMock,
  writeConversationAutoModeState: writeConversationAutoModeStateMock,
  buildModeContextMessage: buildModeContextMessageMock,
}));

vi.mock('../conversations/conversationRecovery.js', () => ({
  recoverConversationCapability: recoverConversationCapabilityMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  publishAppEvent: publishAppEventMock,
}));

import { registerConversationStateRoutes } from './conversationState.js';

type Handler = (req: Record<string, unknown>, res: Record<string, unknown>) => Promise<void> | void;

function createResponse() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
}

function createHarness(options?: {
  getCurrentProfile?: () => string;
  buildLiveSessionResourceOptions?: () => Record<string, unknown>;
  buildLiveSessionExtensionFactories?: () => unknown[];
  flushLiveDeferredResumes?: () => Promise<void>;
}) {
  const getHandlers = new Map<string, Handler>();
  const patchHandlers = new Map<string, Handler>();
  const postHandlers = new Map<string, Handler>();
  const router = {
    get: vi.fn((path: string, handler: Handler) => {
      getHandlers.set(path, handler);
    }),
    patch: vi.fn((path: string, handler: Handler) => {
      patchHandlers.set(path, handler);
    }),
    post: vi.fn((path: string, handler: Handler) => {
      postHandlers.set(path, handler);
    }),
  };

  registerConversationStateRoutes(router as never, {
    getCurrentProfile: options?.getCurrentProfile ?? (() => 'assistant'),
    buildLiveSessionResourceOptions: options?.buildLiveSessionResourceOptions ?? (() => ({ additionalExtensionPaths: [] })),
    buildLiveSessionExtensionFactories: options?.buildLiveSessionExtensionFactories ?? (() => []),
    flushLiveDeferredResumes: options?.flushLiveDeferredResumes ?? (async () => {}),
  });

  return {
    getHandler: (path: string) => getHandlers.get(path)!,
    patchHandler: (path: string) => patchHandlers.get(path)!,
    postHandler: (path: string) => postHandlers.get(path)!,
  };
}

describe('registerConversationStateRoutes', () => {
  beforeEach(() => {
    SessionManagerOpenMock.mockReset();
    applyConversationModelPreferencesToSessionManagerMock.mockReset();
    buildAppendOnlySessionDetailResponseMock.mockReset();
    createSessionFromExistingMock.mockReset();
    createWebLiveConversationRunIdMock.mockReset();
    destroySessionMock.mockReset();
    ensureRequestControlsLocalLiveConversationMock.mockReset();
    existsSyncMock.mockReset();
    getAvailableModelObjectsMock.mockReset();
    getDurableRunMock.mockReset();
    isLocalLiveMock.mockReset();
    listAllLiveSessionsMock.mockReset();
    liveRegistry.clear();
    logErrorMock.mockReset();
    logSlowConversationPerfMock.mockReset();
    publishAppEventMock.mockReset();
    recoverConversationCapabilityMock.mockReset();
    readConversationAutoModeStateFromSessionManagerMock.mockReset();
    readLiveSessionAutoModeStateMock.mockReset();
    parsePendingOperationMock.mockReset();
    parseTailBlocksQueryMock.mockReset();
    promptLocalSessionMock.mockReset();
    publishConversationSessionMetaChangedMock.mockReset();
    queuePromptContextMock.mockReset();
    requestConversationAutoModeTurnMock.mockReset();
    readConversationModelPreferenceStateByIdMock.mockReset();
    readConversationSessionSignatureMock.mockReset();
    readSavedModelPreferencesMock.mockReset();
    readSessionBlocksMock.mockReset();
    readSessionDetailForRouteMock.mockReset();
    renameSessionMock.mockReset();
    renameStoredSessionMock.mockReset();
    resolveConversationSessionFileMock.mockReset();
    resolveRequestedCwdMock.mockReset();
    resumeLocalSessionMock.mockReset();
    setServerTimingHeadersMock.mockReset();
    statSyncMock.mockReset();
    setLiveSessionAutoModeStateMock.mockReset();
    syncWebLiveConversationRunMock.mockReset();
    toPublicLiveSessionMetaMock.mockReset();
    updateLiveSessionModelPreferencesMock.mockReset();
    writeConversationAutoModeStateMock.mockReset();
    writeLiveConversationControlErrorMock.mockReset();

    createWebLiveConversationRunIdMock.mockImplementation((conversationId: string) => `web-run:${conversationId}`);
    existsSyncMock.mockReturnValue(true);
    getAvailableModelObjectsMock.mockReturnValue([{ id: 'model-1' }]);
    isLocalLiveMock.mockReturnValue(false);
    listAllLiveSessionsMock.mockReturnValue([]);
    parsePendingOperationMock.mockReturnValue(null);
    parseTailBlocksQueryMock.mockImplementation((value: unknown) => {
      if (typeof value === 'string') {
        return Number.parseInt(value, 10);
      }
      return undefined;
    });
    promptLocalSessionMock.mockResolvedValue(undefined);
    readConversationSessionSignatureMock.mockReturnValue(undefined);
    readSavedModelPreferencesMock.mockReturnValue({ defaultModel: 'openai/gpt-5', currentServiceTier: '' });
    resolveRequestedCwdMock.mockImplementation((requested: string | undefined, current: string) => requested?.trim() || current);
    resumeLocalSessionMock.mockResolvedValue({ id: 'resumed-conversation' });
    statSyncMock.mockReturnValue({ isDirectory: () => true });
    writeLiveConversationControlErrorMock.mockReturnValue(false);
  });

  it('returns 404 when bootstrap state is missing', async () => {
    const { getHandler } = createHarness();
    const handler = getHandler('/api/conversations/:id/bootstrap');
    const res = createResponse();

    readSessionDetailForRouteMock.mockResolvedValueOnce({
      sessionRead: {
        detail: null,
        telemetry: null,
      },
      remoteMirror: { status: 'missing', durationMs: 0 },
    });

    await handler(
      {
        params: { id: 'conversation-1' },
        query: { tailBlocks: '12' },
      },
      res,
    );

    expect(readSessionDetailForRouteMock).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      profile: 'assistant',
      tailBlocks: 12,
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Conversation not found' });
    expect(setServerTimingHeadersMock).not.toHaveBeenCalled();
  });

  it('reuses a known bootstrap signature for live conversations and records timing', async () => {
    const { getHandler } = createHarness({ getCurrentProfile: () => 'datadog' });
    const handler = getHandler('/api/conversations/:id/bootstrap');
    const res = createResponse();

    readConversationSessionSignatureMock.mockReturnValueOnce('sig-1');
    listAllLiveSessionsMock.mockReturnValueOnce([{ id: 'conversation-1', raw: true }]);
    toPublicLiveSessionMetaMock.mockReturnValueOnce({ id: 'conversation-1', title: 'Live title' });

    await handler(
      {
        params: { id: 'conversation-1' },
        query: { knownSessionSignature: ' sig-1 ' },
      },
      res,
    );

    expect(readSessionDetailForRouteMock).not.toHaveBeenCalled();
    expect(toPublicLiveSessionMetaMock).toHaveBeenCalledWith({ id: 'conversation-1', raw: true });
    expect(setServerTimingHeadersMock).toHaveBeenCalledWith(
      res,
      expect.any(Array),
      expect.objectContaining({
        route: 'conversation-bootstrap',
        conversationId: 'conversation-1',
        remoteMirror: { status: 'deferred', durationMs: 0 },
        sessionRead: null,
      }),
    );
    expect(logSlowConversationPerfMock).toHaveBeenCalledWith(
      'conversation bootstrap request',
      expect.objectContaining({
        conversationId: 'conversation-1',
        remoteMirrorStatus: 'deferred',
        sessionReadLoader: 'signature',
      }),
    );
    expect(res.json).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      sessionDetail: null,
      sessionDetailSignature: 'sig-1',
      sessionDetailUnchanged: true,
      liveSession: {
        live: true,
        id: 'conversation-1',
        title: 'Live title',
      },
    });
  });

  it('returns append-only bootstrap state when the known signature is stale', async () => {
    const { getHandler } = createHarness();
    const handler = getHandler('/api/conversations/:id/bootstrap');
    const res = createResponse();

    readConversationSessionSignatureMock.mockReturnValueOnce('sig-new');
    readSessionDetailForRouteMock.mockResolvedValueOnce({
      sessionRead: {
        detail: {
          signature: 'sig-new',
          blocks: [{ id: 'block-2' }],
        },
        telemetry: { cache: 'miss', loader: 'disk', durationMs: 4 },
      },
      remoteMirror: { status: 'synced', durationMs: 2 },
    });
    buildAppendOnlySessionDetailResponseMock.mockReturnValueOnce({
      signature: 'sig-append',
      blocks: [{ id: 'block-2' }],
    });

    await handler(
      {
        params: { id: 'conversation-1' },
        query: {
          knownSessionSignature: ' sig-old ',
          knownBlockOffset: String(Number.MAX_SAFE_INTEGER + 1),
          knownTotalBlocks: String(Number.MAX_SAFE_INTEGER + 1),
          knownLastBlockId: ' block-1 ',
        },
      },
      res,
    );

    expect(buildAppendOnlySessionDetailResponseMock).toHaveBeenCalledWith({
      detail: {
        signature: 'sig-new',
        blocks: [{ id: 'block-2' }],
      },
      knownBlockOffset: undefined,
      knownTotalBlocks: undefined,
      knownLastBlockId: 'block-1',
    });
    expect(res.json).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      sessionDetail: null,
      sessionDetailSignature: 'sig-append',
      sessionDetailAppendOnly: {
        signature: 'sig-append',
        blocks: [{ id: 'block-2' }],
      },
      liveSession: { live: false },
    });
  });

  it('returns bootstrap errors as 500 responses', async () => {
    const { getHandler } = createHarness();
    const handler = getHandler('/api/conversations/:id/bootstrap');
    const res = createResponse();

    readSessionDetailForRouteMock.mockRejectedValueOnce(new Error('bootstrap failed'));

    await handler(
      {
        params: { id: 'conversation-1' },
        query: {},
      },
      res,
    );

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'bootstrap failed' });
  });

  it('reads model preference state, 404s missing conversations, and logs failures', async () => {
    const { getHandler } = createHarness();
    const handler = getHandler('/api/conversations/:id/model-preferences');

    readConversationModelPreferenceStateByIdMock.mockResolvedValueOnce({ conversationId: 'conversation-1', model: 'gpt-5' });
    const successRes = createResponse();
    await handler({ params: { id: 'conversation-1' } }, successRes);
    expect(successRes.json).toHaveBeenCalledWith({ conversationId: 'conversation-1', model: 'gpt-5' });

    readConversationModelPreferenceStateByIdMock.mockResolvedValueOnce(null);
    const missingRes = createResponse();
    await handler({ params: { id: 'missing' } }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Conversation not found' });

    readConversationModelPreferenceStateByIdMock.mockRejectedValueOnce(new Error('model read failed'));
    const failureRes = createResponse();
    await handler({ params: { id: 'conversation-1' } }, failureRes);
    expect(logErrorMock).toHaveBeenCalledWith(
      'request handler error',
      expect.objectContaining({
        message: 'model read failed',
      }),
    );
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'model read failed' });
  });

  it('reads conversation auto mode state for live and stored sessions', async () => {
    const { getHandler } = createHarness();
    const handler = getHandler('/api/conversations/:id/auto-mode');

    isLocalLiveMock.mockReturnValueOnce(true);
    readLiveSessionAutoModeStateMock.mockReturnValueOnce({ enabled: true, stopReason: null, updatedAt: '2026-04-12T15:00:00.000Z' });
    const liveRes = createResponse();
    await handler({ params: { id: 'conversation-1' } }, liveRes);
    expect(readLiveSessionAutoModeStateMock).toHaveBeenCalledWith('conversation-1');
    expect(liveRes.json).toHaveBeenCalledWith({ enabled: true, stopReason: null, updatedAt: '2026-04-12T15:00:00.000Z' });

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/conversation-1.json');
    existsSyncMock.mockReturnValueOnce(true);
    SessionManagerOpenMock.mockReturnValueOnce({ id: 'session-manager' });
    readConversationAutoModeStateFromSessionManagerMock.mockReturnValueOnce({
      enabled: false,
      stopReason: 'done',
      updatedAt: '2026-04-12T15:05:00.000Z',
    });
    const storedRes = createResponse();
    await handler({ params: { id: 'conversation-1' } }, storedRes);
    expect(SessionManagerOpenMock).toHaveBeenCalledWith('/sessions/conversation-1.json');
    expect(readConversationAutoModeStateFromSessionManagerMock).toHaveBeenCalledWith({ id: 'session-manager' });
    expect(storedRes.json).toHaveBeenCalledWith({ enabled: false, stopReason: 'done', updatedAt: '2026-04-12T15:05:00.000Z' });
  });

  it('validates and updates conversation auto mode state', async () => {
    const { patchHandler } = createHarness();
    const handler = patchHandler('/api/conversations/:id/auto-mode');

    const invalidRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: {} }, invalidRes);
    expect(invalidRes.status).toHaveBeenCalledWith(400);
    expect(invalidRes.json).toHaveBeenCalledWith({ error: 'mode or enabled required' });

    isLocalLiveMock.mockReturnValueOnce(true);
    setLiveSessionAutoModeStateMock.mockResolvedValueOnce({ enabled: true, stopReason: null, updatedAt: '2026-04-12T15:10:00.000Z' });
    const liveRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: { enabled: true, surfaceId: 'surface-1' } }, liveRes);
    expect(ensureRequestControlsLocalLiveConversationMock).toHaveBeenCalledWith('conversation-1', {
      enabled: true,
      surfaceId: 'surface-1',
    });
    expect(setLiveSessionAutoModeStateMock).toHaveBeenCalledWith('conversation-1', { enabled: true });
    expect(liveRes.json).toHaveBeenCalledWith({ enabled: true, stopReason: null, updatedAt: '2026-04-12T15:10:00.000Z' });

    recoverConversationCapabilityMock.mockResolvedValueOnce({
      conversationId: 'conversation-1',
      live: true,
      recovered: true,
      replayedPendingOperation: false,
      usedFallbackPrompt: false,
    });
    setLiveSessionAutoModeStateMock.mockResolvedValueOnce({ enabled: true, stopReason: null, updatedAt: '2026-04-12T15:11:00.000Z' });
    const recoveredRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: { enabled: true, surfaceId: 'surface-2' } }, recoveredRes);
    expect(recoverConversationCapabilityMock).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({
        getCurrentProfile: expect.any(Function),
        buildLiveSessionResourceOptions: expect.any(Function),
        buildLiveSessionExtensionFactories: expect.any(Function),
        flushLiveDeferredResumes: expect.any(Function),
      }),
    );
    expect(ensureRequestControlsLocalLiveConversationMock).toHaveBeenCalledWith('conversation-1', {
      enabled: true,
      surfaceId: 'surface-2',
    });
    expect(setLiveSessionAutoModeStateMock).toHaveBeenCalledWith('conversation-1', { enabled: true });
    expect(recoveredRes.json).toHaveBeenCalledWith({ enabled: true, stopReason: null, updatedAt: '2026-04-12T15:11:00.000Z' });

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/conversation-1.json');
    existsSyncMock.mockReturnValueOnce(true);
    SessionManagerOpenMock.mockReturnValueOnce({ id: 'session-manager' });
    writeConversationAutoModeStateMock.mockReturnValueOnce({ enabled: false, stopReason: null, updatedAt: '2026-04-12T15:12:00.000Z' });
    const storedRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: { enabled: false } }, storedRes);
    expect(writeConversationAutoModeStateMock).toHaveBeenCalledWith({ id: 'session-manager' }, { enabled: false });
    expect(publishAppEventMock).toHaveBeenCalledWith({ type: 'session_file_changed', sessionId: 'conversation-1' });
    expect(storedRes.json).toHaveBeenCalledWith({ enabled: false, stopReason: null, updatedAt: '2026-04-12T15:12:00.000Z' });
  });

  it('validates and updates conversation goal state', async () => {
    const { patchHandler } = createHarness();
    const handler = patchHandler('/api/conversations/:id/goal');

    const invalidRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: { objective: 42 } }, invalidRes);
    expect(invalidRes.status).toHaveBeenCalledWith(400);
    expect(invalidRes.json).toHaveBeenCalledWith({ error: 'objective must be a string' });

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/conversation-1.json');
    existsSyncMock.mockReturnValueOnce(true);
    const clearedSessionManager = { appendCustomEntry: vi.fn() };
    SessionManagerOpenMock.mockReturnValueOnce(clearedSessionManager);
    const clearedRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: { objective: '   ' } }, clearedRes);
    expect(clearedSessionManager.appendCustomEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({
        objective: '',
        status: 'complete',
        stopReason: 'cleared',
        noProgressTurns: 0,
      }),
    );
    expect(clearedRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ objective: '', status: 'complete', stopReason: 'cleared', noProgressTurns: 0 }),
    );
    expect(publishAppEventMock).toHaveBeenCalledWith({ type: 'session_file_changed', sessionId: 'conversation-1' });

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/conversation-2.json');
    existsSyncMock.mockReturnValueOnce(true);
    const activeSessionManager = { appendCustomEntry: vi.fn() };
    SessionManagerOpenMock.mockReturnValueOnce(activeSessionManager);
    const activeRes = createResponse();
    await handler({ params: { id: 'conversation-2' }, body: { objective: ' ship it ' } }, activeRes);
    expect(activeSessionManager.appendCustomEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({
        objective: 'ship it',
        status: 'active',
        stopReason: null,
        noProgressTurns: 0,
      }),
    );
    expect(activeRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        objective: 'ship it',
        status: 'active',
        stopReason: null,
        noProgressTurns: 0,
      }),
    );
  });

  it('updates goal state on live conversations immediately', async () => {
    const { patchHandler } = createHarness();
    const handler = patchHandler('/api/conversations/:id/goal');
    const appendCustomEntry = vi.fn();
    const sendCustomMessage = vi.fn(async () => undefined);
    liveRegistry.set('conversation-live', {
      session: {
        isStreaming: false,
        sendCustomMessage,
        sessionManager: { appendCustomEntry },
      },
      pendingHiddenTurnCustomTypes: [],
      activeHiddenTurnCustomType: null,
    });

    isLocalLiveMock.mockReturnValueOnce(true);
    const activeRes = createResponse();
    await handler({ params: { id: 'conversation-live' }, body: { objective: ' keep looping ' } }, activeRes);
    expect(appendCustomEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({ objective: 'keep looping', status: 'active', stopReason: null, noProgressTurns: 0 }),
    );
    expect(activeRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ objective: 'keep looping', status: 'active', stopReason: null, noProgressTurns: 0 }),
    );
    await vi.waitFor(() => {
      expect(sendCustomMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          customType: 'goal-continuation',
          content: expect.stringContaining('Objective: keep looping'),
        }),
        { triggerTurn: true, deliverAs: 'followUp' },
      );
      expect(sendCustomMessage.mock.calls[0]?.[0]?.content).not.toContain('Do not mention this hidden continuation prompt.');
    });
    expect((liveRegistry.get('conversation-live') as any)?.pendingHiddenTurnCustomTypes).toEqual([]);

    isLocalLiveMock.mockReturnValueOnce(true);
    const clearRes = createResponse();
    await handler({ params: { id: 'conversation-live' }, body: {} }, clearRes);
    expect(appendCustomEntry).toHaveBeenCalledWith(
      'conversation-goal',
      expect.objectContaining({ objective: '', status: 'complete', stopReason: 'cleared', noProgressTurns: 0 }),
    );
    expect(clearRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ objective: '', status: 'complete', stopReason: 'cleared', noProgressTurns: 0 }),
    );
  });

  it('validates model preference patch input', async () => {
    const { patchHandler } = createHarness();
    const handler = patchHandler('/api/conversations/:id/model-preferences');

    const missingRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: {} }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(400);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'model, thinkingLevel, or serviceTier required' });

    const invalidTypeRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: { model: 42 } }, invalidTypeRes);
    expect(invalidTypeRes.status).toHaveBeenCalledWith(400);
    expect(invalidTypeRes.json).toHaveBeenCalledWith({ error: 'model, thinkingLevel, and serviceTier must be strings or null' });
  });

  it('updates live and stored conversation model preferences', async () => {
    const { patchHandler } = createHarness();
    const handler = patchHandler('/api/conversations/:id/model-preferences');

    isLocalLiveMock.mockReturnValueOnce(true);
    updateLiveSessionModelPreferencesMock.mockResolvedValueOnce({
      conversationId: 'conversation-1',
      model: 'gpt-5',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });
    const liveRes = createResponse();
    await handler(
      {
        params: { id: 'conversation-1' },
        body: { model: 'gpt-5', surfaceId: 'surface-1' },
      },
      liveRes,
    );
    expect(ensureRequestControlsLocalLiveConversationMock).toHaveBeenCalledWith('conversation-1', {
      model: 'gpt-5',
      surfaceId: 'surface-1',
    });
    expect(updateLiveSessionModelPreferencesMock).toHaveBeenCalledWith('conversation-1', { model: 'gpt-5' }, [{ id: 'model-1' }]);
    expect(liveRes.json).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      model: 'gpt-5',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/conversation-1.json');
    SessionManagerOpenMock.mockReturnValueOnce({ id: 'session-manager' });
    applyConversationModelPreferencesToSessionManagerMock.mockReturnValueOnce({
      conversationId: 'conversation-1',
      model: 'claude-4',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });
    const storedRes = createResponse();
    await handler(
      {
        params: { id: 'conversation-1' },
        body: { model: 'claude-4', thinkingLevel: null },
      },
      storedRes,
    );
    expect(SessionManagerOpenMock).toHaveBeenCalledWith('/sessions/conversation-1.json');
    expect(applyConversationModelPreferencesToSessionManagerMock).toHaveBeenCalledWith(
      { id: 'session-manager' },
      { model: 'claude-4', thinkingLevel: null },
      { defaultModel: 'openai/gpt-5', currentServiceTier: '' },
      [{ id: 'model-1' }],
    );
    expect(publishConversationSessionMetaChangedMock).toHaveBeenCalledWith('conversation-1');
    expect(storedRes.json).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      model: 'claude-4',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });
  });

  it('handles missing stored conversations and mapped model preference errors', async () => {
    const { patchHandler } = createHarness();
    const handler = patchHandler('/api/conversations/:id/model-preferences');

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/missing.json');
    existsSyncMock.mockReturnValueOnce(false);
    const missingRes = createResponse();
    await handler(
      {
        params: { id: 'missing' },
        body: { model: 'gpt-5' },
      },
      missingRes,
    );
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Conversation not found' });

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/conversation-1.json');
    SessionManagerOpenMock.mockReturnValueOnce({ id: 'session-manager' });
    applyConversationModelPreferencesToSessionManagerMock.mockImplementationOnce(() => {
      throw new Error('Unknown model: nope');
    });
    const invalidModelRes = createResponse();
    await handler(
      {
        params: { id: 'conversation-1' },
        body: { model: 'nope' },
      },
      invalidModelRes,
    );
    expect(invalidModelRes.status).toHaveBeenCalledWith(400);
    expect(invalidModelRes.json).toHaveBeenCalledWith({ error: 'Unknown model: nope' });

    isLocalLiveMock.mockReturnValueOnce(true);
    updateLiveSessionModelPreferencesMock.mockRejectedValueOnce(new Error('surface locked'));
    writeLiveConversationControlErrorMock.mockImplementationOnce((res, error) => {
      res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
      return true;
    });
    const controlRes = createResponse();
    await handler(
      {
        params: { id: 'conversation-1' },
        body: { model: 'gpt-5', surfaceId: 'surface-1' },
      },
      controlRes,
    );
    expect(controlRes.status).toHaveBeenCalledWith(409);
    expect(controlRes.json).toHaveBeenCalledWith({ error: 'surface locked' });
  });

  it('validates recover requests without a conversation id', async () => {
    const { postHandler } = createHarness();
    const handler = postHandler('/api/conversations/:id/recover');
    const res = createResponse();

    await handler({ params: { id: '' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'conversation id required' });
  });

  it('delegates recovery requests to the recovery capability', async () => {
    const flushLiveDeferredResumesMock = vi.fn().mockResolvedValue(undefined);
    const { postHandler } = createHarness({
      getCurrentProfile: () => 'assistant',
      buildLiveSessionResourceOptions: () => ({ additionalExtensionPaths: ['extensions'] }),
      buildLiveSessionExtensionFactories: () => ['factory'],
      flushLiveDeferredResumes: flushLiveDeferredResumesMock,
    });
    const handler = postHandler('/api/conversations/:id/recover');
    const res = createResponse();

    recoverConversationCapabilityMock.mockResolvedValueOnce({
      conversationId: 'conversation-1-live',
      live: true,
      recovered: true,
      replayedPendingOperation: true,
      usedFallbackPrompt: false,
    });

    await handler({ params: { id: 'conversation-1' } }, res);

    expect(recoverConversationCapabilityMock).toHaveBeenCalledWith(
      'conversation-1',
      expect.objectContaining({
        getCurrentProfile: expect.any(Function),
        buildLiveSessionResourceOptions: expect.any(Function),
        buildLiveSessionExtensionFactories: expect.any(Function),
        flushLiveDeferredResumes: flushLiveDeferredResumesMock,
      }),
      { replayPendingOperation: true },
    );
    expect(res.json).toHaveBeenCalledWith({
      conversationId: 'conversation-1-live',
      live: true,
      recovered: true,
      replayedPendingOperation: true,
      usedFallbackPrompt: false,
    });
  });

  it('maps missing conversations from the recovery capability to 404s', async () => {
    const { postHandler } = createHarness();
    const handler = postHandler('/api/conversations/:id/recover');
    const res = createResponse();

    recoverConversationCapabilityMock.mockRejectedValueOnce(new Error('Conversation not found.'));

    await handler({ params: { id: 'conversation-missing' } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Conversation not found.' });
  });

  it('maps invalid recovery input from the capability to 400s', async () => {
    const { postHandler } = createHarness();
    const handler = postHandler('/api/conversations/:id/recover');
    const res = createResponse();

    recoverConversationCapabilityMock.mockRejectedValueOnce(new Error('conversationId required'));

    await handler({ params: { id: 'conversation-2' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'conversationId required' });
  });

  it('validates and renames conversation titles for live and stored sessions', async () => {
    const { patchHandler } = createHarness();
    const handler = patchHandler('/api/conversations/:id/title');

    const missingNameRes = createResponse();
    handler({ params: { id: 'conversation-1' }, body: { name: '   ' } }, missingNameRes);
    expect(missingNameRes.status).toHaveBeenCalledWith(400);
    expect(missingNameRes.json).toHaveBeenCalledWith({ error: 'name required' });

    isLocalLiveMock.mockReturnValueOnce(true);
    const liveRes = createResponse();
    handler({ params: { id: 'conversation-1' }, body: { name: '  Live title  ', surfaceId: 'surface-1' } }, liveRes);
    expect(renameSessionMock).toHaveBeenCalledWith('conversation-1', 'Live title');
    expect(liveRes.json).toHaveBeenCalledWith({ ok: true, title: 'Live title' });

    renameStoredSessionMock.mockReturnValueOnce({ title: 'Stored title' });
    const storedRes = createResponse();
    handler({ params: { id: 'conversation-2' }, body: { name: 'Stored title' } }, storedRes);
    expect(renameStoredSessionMock).toHaveBeenCalledWith('conversation-2', 'Stored title');
    expect(publishConversationSessionMetaChangedMock).toHaveBeenCalledWith('conversation-2');
    expect(storedRes.json).toHaveBeenCalledWith({ ok: true, title: 'Stored title' });
  });

  it('maps title rename failures to route-specific status codes', () => {
    const { patchHandler } = createHarness();
    const handler = patchHandler('/api/conversations/:id/title');

    renameStoredSessionMock.mockImplementationOnce(() => {
      throw new Error('conversation not found');
    });
    const notFoundRes = createResponse();
    handler({ params: { id: 'missing' }, body: { name: 'Title' } }, notFoundRes);
    expect(notFoundRes.status).toHaveBeenCalledWith(404);
    expect(notFoundRes.json).toHaveBeenCalledWith({ error: 'conversation not found' });

    isLocalLiveMock.mockReturnValueOnce(true);
    renameSessionMock.mockImplementationOnce(() => {
      throw new Error('surface locked');
    });
    writeLiveConversationControlErrorMock.mockImplementationOnce((res, error) => {
      res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
      return true;
    });
    const controlRes = createResponse();
    handler({ params: { id: 'conversation-1' }, body: { name: 'Live title', surfaceId: 'surface-1' } }, controlRes);
    expect(controlRes.status).toHaveBeenCalledWith(409);
    expect(controlRes.json).toHaveBeenCalledWith({ error: 'surface locked' });
  });

  it('duplicates conversations from their full saved session state', async () => {
    const { postHandler } = createHarness({
      buildLiveSessionResourceOptions: () => ({ additionalExtensionPaths: ['extensions'] }),
      buildLiveSessionExtensionFactories: () => ['factory'],
    });
    const handler = postHandler('/api/conversations/:id/duplicate');

    const missingRes = createResponse();
    await handler({ params: { id: 'missing' }, body: {} }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Conversation not found.' });

    liveRegistry.set('conversation-1', {
      cwd: '/repo/source',
      session: { sessionFile: '/sessions/conversation-1.json', isStreaming: false },
    });
    createSessionFromExistingMock.mockResolvedValueOnce({ id: 'conversation-2', sessionFile: '/sessions/conversation-2.json' });

    const liveRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: {} }, liveRes);
    expect(createSessionFromExistingMock).toHaveBeenCalledWith('/sessions/conversation-1.json', '/repo/source', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
    });
    expect(publishConversationSessionMetaChangedMock).toHaveBeenCalledWith('conversation-1', 'conversation-2');
    expect(liveRes.json).toHaveBeenCalledWith({
      newSessionId: 'conversation-2',
      sessionFile: '/sessions/conversation-2.json',
    });

    liveRegistry.clear();
    readSessionBlocksMock.mockReturnValueOnce({
      meta: {
        cwd: '/repo/stored',
        file: '/sessions/conversation-3.json',
      },
    });
    createSessionFromExistingMock.mockResolvedValueOnce({ id: 'conversation-4', sessionFile: '/sessions/conversation-4.json' });

    const storedRes = createResponse();
    await handler({ params: { id: 'conversation-3' }, body: {} }, storedRes);
    expect(createSessionFromExistingMock).toHaveBeenCalledWith('/sessions/conversation-3.json', '/repo/stored', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
    });
    expect(publishConversationSessionMetaChangedMock).toHaveBeenCalledWith('conversation-3', 'conversation-4');
    expect(storedRes.json).toHaveBeenCalledWith({
      newSessionId: 'conversation-4',
      sessionFile: '/sessions/conversation-4.json',
    });
  });

  it('validates cwd changes and recreates sessions when the cwd changes', async () => {
    const { postHandler } = createHarness({
      buildLiveSessionResourceOptions: () => ({ additionalExtensionPaths: ['extensions'] }),
      buildLiveSessionExtensionFactories: () => ['factory'],
    });
    const handler = postHandler('/api/conversations/:id/cwd');

    const missingRes = createResponse();
    await handler({ params: { id: 'missing' }, body: { cwd: '/next' } }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Conversation not found.' });

    liveRegistry.set('conversation-1', {
      cwd: '/current',
      session: { sessionFile: '/sessions/conversation-1.json', isStreaming: true },
    });
    const streamingRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: { cwd: '/next' } }, streamingRes);
    expect(streamingRes.status).toHaveBeenCalledWith(409);
    expect(streamingRes.json).toHaveBeenCalledWith({ error: 'Stop the current response before changing the working directory.' });

    liveRegistry.set('conversation-2', {
      cwd: '/current',
      session: { sessionFile: '/sessions/conversation-2.json', isStreaming: false },
    });
    resolveRequestedCwdMock.mockReturnValueOnce(undefined);
    const missingCwdRes = createResponse();
    await handler({ params: { id: 'conversation-2' }, body: { cwd: '   ' } }, missingCwdRes);
    expect(missingCwdRes.status).toHaveBeenCalledWith(400);
    expect(missingCwdRes.json).toHaveBeenCalledWith({ error: 'cwd required' });

    liveRegistry.set('conversation-3', {
      cwd: '/current',
      session: { sessionFile: '/sessions/conversation-3.json', isStreaming: false },
    });
    resolveRequestedCwdMock.mockReturnValueOnce('/missing');
    existsSyncMock.mockReturnValueOnce(false);
    const missingDirRes = createResponse();
    await handler({ params: { id: 'conversation-3' }, body: { cwd: '/missing' } }, missingDirRes);
    expect(missingDirRes.status).toHaveBeenCalledWith(400);
    expect(missingDirRes.json).toHaveBeenCalledWith({ error: 'Directory does not exist: /missing' });

    liveRegistry.set('conversation-4', {
      cwd: '/current',
      session: { sessionFile: '/sessions/conversation-4.json', isStreaming: false },
    });
    resolveRequestedCwdMock.mockReturnValueOnce('/not-a-directory');
    statSyncMock.mockReturnValueOnce({ isDirectory: () => false });
    const notDirRes = createResponse();
    await handler({ params: { id: 'conversation-4' }, body: { cwd: '/not-a-directory' } }, notDirRes);
    expect(notDirRes.status).toHaveBeenCalledWith(400);
    expect(notDirRes.json).toHaveBeenCalledWith({ error: 'Not a directory: /not-a-directory' });

    liveRegistry.set('conversation-5', {
      cwd: '/current',
      session: { sessionFile: '/sessions/conversation-5.json', isStreaming: false },
    });
    resolveRequestedCwdMock.mockReturnValueOnce('/current');
    const unchangedRes = createResponse();
    await handler({ params: { id: 'conversation-5' }, body: { cwd: '/current' } }, unchangedRes);
    expect(unchangedRes.json).toHaveBeenCalledWith({
      id: 'conversation-5',
      sessionFile: '/sessions/conversation-5.json',
      cwd: '/current',
      changed: false,
    });

    liveRegistry.set('conversation-6', {
      cwd: '/current',
      session: { sessionFile: '/sessions/conversation-6.json', isStreaming: false },
    });
    resolveRequestedCwdMock.mockReturnValueOnce('/next');
    resumeLocalSessionMock.mockResolvedValueOnce({});
    const changedRes = createResponse();
    await handler({ params: { id: 'conversation-6' }, body: { cwd: '/next' } }, changedRes);
    expect(destroySessionMock).toHaveBeenCalledWith('conversation-6');
    expect(resumeLocalSessionMock).toHaveBeenCalledWith(
      '/sessions/conversation-6.json',
      expect.objectContaining({
        cwdOverride: '/next',
        extensionFactories: ['factory'],
      }),
    );
    expect(publishConversationSessionMetaChangedMock).toHaveBeenCalledWith('conversation-6');
    expect(changedRes.json).toHaveBeenCalledWith({
      id: 'conversation-6',
      sessionFile: '/sessions/conversation-6.json',
      cwd: '/next',
      changed: true,
    });
  });

  it('returns 500 when cwd changes fail unexpectedly', async () => {
    const { postHandler } = createHarness();
    const handler = postHandler('/api/conversations/:id/cwd');
    const res = createResponse();

    liveRegistry.set('conversation-1', {
      cwd: '/current',
      session: { sessionFile: '/sessions/conversation-1.json', isStreaming: false },
    });
    resolveRequestedCwdMock.mockReturnValueOnce('/next');
    resumeLocalSessionMock.mockRejectedValueOnce(new Error('cwd resume failed'));

    await handler({ params: { id: 'conversation-1' }, body: { cwd: '/next' } }, res);

    expect(logErrorMock).toHaveBeenCalledWith(
      'request handler error',
      expect.objectContaining({
        message: 'cwd resume failed',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: cwd resume failed' });
  });
});
