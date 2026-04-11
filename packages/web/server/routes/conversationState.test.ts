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
  readConversationAutoModeStateFromSessionManagerMock,
  readLiveSessionAutoModeStateMock,
  logSlowConversationPerfMock,
  parsePendingOperationMock,
  parseTailBlocksQueryMock,
  promptLocalSessionMock,
  publishConversationSessionMetaChangedMock,
  queuePromptContextMock,
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
  readConversationAutoModeStateFromSessionManagerMock: vi.fn(),
  readLiveSessionAutoModeStateMock: vi.fn(),
  parsePendingOperationMock: vi.fn(),
  parseTailBlocksQueryMock: vi.fn(),
  promptLocalSessionMock: vi.fn(),
  publishConversationSessionMetaChangedMock: vi.fn(),
  queuePromptContextMock: vi.fn(),
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

vi.mock('@mariozechner/pi-coding-agent', () => ({
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
    readConversationAutoModeStateFromSessionManagerMock.mockReset();
    readLiveSessionAutoModeStateMock.mockReset();
    parsePendingOperationMock.mockReset();
    parseTailBlocksQueryMock.mockReset();
    promptLocalSessionMock.mockReset();
    publishConversationSessionMetaChangedMock.mockReset();
    queuePromptContextMock.mockReset();
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
    readSavedModelPreferencesMock.mockReturnValue({ defaultModel: 'openai/gpt-5' });
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

    await handler({
      params: { id: 'conversation-1' },
      query: { tailBlocks: '12' },
    }, res);

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

    await handler({
      params: { id: 'conversation-1' },
      query: { knownSessionSignature: ' sig-1 ' },
    }, res);

    expect(readSessionDetailForRouteMock).not.toHaveBeenCalled();
    expect(toPublicLiveSessionMetaMock).toHaveBeenCalledWith({ id: 'conversation-1', raw: true });
    expect(setServerTimingHeadersMock).toHaveBeenCalledWith(res, expect.any(Array), expect.objectContaining({
      route: 'conversation-bootstrap',
      conversationId: 'conversation-1',
      remoteMirror: { status: 'deferred', durationMs: 0 },
      sessionRead: null,
    }));
    expect(logSlowConversationPerfMock).toHaveBeenCalledWith('conversation bootstrap request', expect.objectContaining({
      conversationId: 'conversation-1',
      remoteMirrorStatus: 'deferred',
      sessionReadLoader: 'signature',
    }));
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

    await handler({
      params: { id: 'conversation-1' },
      query: {
        knownSessionSignature: ' sig-old ',
        knownBlockOffset: '3',
        knownTotalBlocks: '9',
        knownLastBlockId: ' block-1 ',
      },
    }, res);

    expect(buildAppendOnlySessionDetailResponseMock).toHaveBeenCalledWith({
      detail: {
        signature: 'sig-new',
        blocks: [{ id: 'block-2' }],
      },
      knownBlockOffset: 3,
      knownTotalBlocks: 9,
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

    await handler({
      params: { id: 'conversation-1' },
      query: {},
    }, res);

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
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'model read failed',
    }));
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
    readConversationAutoModeStateFromSessionManagerMock.mockReturnValueOnce({ enabled: false, stopReason: 'done', updatedAt: '2026-04-12T15:05:00.000Z' });
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
    expect(invalidRes.json).toHaveBeenCalledWith({ error: 'enabled must be boolean' });

    isLocalLiveMock.mockReturnValueOnce(true);
    setLiveSessionAutoModeStateMock.mockResolvedValueOnce({ enabled: true, stopReason: null, updatedAt: '2026-04-12T15:10:00.000Z' });
    const liveRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: { enabled: true, surfaceId: 'surface-1' } }, liveRes);
    expect(ensureRequestControlsLocalLiveConversationMock).toHaveBeenCalledWith('conversation-1', { enabled: true, surfaceId: 'surface-1' });
    expect(setLiveSessionAutoModeStateMock).toHaveBeenCalledWith('conversation-1', { enabled: true });
    expect(liveRes.json).toHaveBeenCalledWith({ enabled: true, stopReason: null, updatedAt: '2026-04-12T15:10:00.000Z' });

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/conversation-1.json');
    existsSyncMock.mockReturnValueOnce(true);
    SessionManagerOpenMock.mockReturnValueOnce({ id: 'session-manager' });
    writeConversationAutoModeStateMock.mockReturnValueOnce({ enabled: false, stopReason: null, updatedAt: '2026-04-12T15:11:00.000Z' });
    const storedRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: { enabled: false } }, storedRes);
    expect(writeConversationAutoModeStateMock).toHaveBeenCalledWith({ id: 'session-manager' }, { enabled: false });
    expect(publishAppEventMock).toHaveBeenCalledWith({ type: 'session_file_changed', sessionId: 'conversation-1' });
    expect(storedRes.json).toHaveBeenCalledWith({ enabled: false, stopReason: null, updatedAt: '2026-04-12T15:11:00.000Z' });
  });

  it('validates model preference patch input', async () => {
    const { patchHandler } = createHarness();
    const handler = patchHandler('/api/conversations/:id/model-preferences');

    const missingRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: {} }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(400);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'model or thinkingLevel required' });

    const invalidTypeRes = createResponse();
    await handler({ params: { id: 'conversation-1' }, body: { model: 42 } }, invalidTypeRes);
    expect(invalidTypeRes.status).toHaveBeenCalledWith(400);
    expect(invalidTypeRes.json).toHaveBeenCalledWith({ error: 'model and thinkingLevel must be strings or null' });
  });

  it('updates live and stored conversation model preferences', async () => {
    const { patchHandler } = createHarness();
    const handler = patchHandler('/api/conversations/:id/model-preferences');

    isLocalLiveMock.mockReturnValueOnce(true);
    updateLiveSessionModelPreferencesMock.mockResolvedValueOnce({ conversationId: 'conversation-1', model: 'gpt-5' });
    const liveRes = createResponse();
    await handler({
      params: { id: 'conversation-1' },
      body: { model: 'gpt-5', surfaceId: 'surface-1' },
    }, liveRes);
    expect(ensureRequestControlsLocalLiveConversationMock).toHaveBeenCalledWith('conversation-1', {
      model: 'gpt-5',
      surfaceId: 'surface-1',
    });
    expect(updateLiveSessionModelPreferencesMock).toHaveBeenCalledWith('conversation-1', { model: 'gpt-5' }, [{ id: 'model-1' }]);
    expect(liveRes.json).toHaveBeenCalledWith({ conversationId: 'conversation-1', model: 'gpt-5' });

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/conversation-1.json');
    SessionManagerOpenMock.mockReturnValueOnce({ id: 'session-manager' });
    applyConversationModelPreferencesToSessionManagerMock.mockReturnValueOnce({ conversationId: 'conversation-1', model: 'claude-4' });
    const storedRes = createResponse();
    await handler({
      params: { id: 'conversation-1' },
      body: { model: 'claude-4', thinkingLevel: null },
    }, storedRes);
    expect(SessionManagerOpenMock).toHaveBeenCalledWith('/sessions/conversation-1.json');
    expect(applyConversationModelPreferencesToSessionManagerMock).toHaveBeenCalledWith(
      { id: 'session-manager' },
      { model: 'claude-4', thinkingLevel: null },
      { defaultModel: 'openai/gpt-5' },
      [{ id: 'model-1' }],
    );
    expect(publishConversationSessionMetaChangedMock).toHaveBeenCalledWith('conversation-1');
    expect(storedRes.json).toHaveBeenCalledWith({ conversationId: 'conversation-1', model: 'claude-4' });
  });

  it('handles missing stored conversations and mapped model preference errors', async () => {
    const { patchHandler } = createHarness();
    const handler = patchHandler('/api/conversations/:id/model-preferences');

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/missing.json');
    existsSyncMock.mockReturnValueOnce(false);
    const missingRes = createResponse();
    await handler({
      params: { id: 'missing' },
      body: { model: 'gpt-5' },
    }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Conversation not found' });

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/conversation-1.json');
    SessionManagerOpenMock.mockReturnValueOnce({ id: 'session-manager' });
    applyConversationModelPreferencesToSessionManagerMock.mockImplementationOnce(() => {
      throw new Error('Unknown model: nope');
    });
    const invalidModelRes = createResponse();
    await handler({
      params: { id: 'conversation-1' },
      body: { model: 'nope' },
    }, invalidModelRes);
    expect(invalidModelRes.status).toHaveBeenCalledWith(400);
    expect(invalidModelRes.json).toHaveBeenCalledWith({ error: 'Unknown model: nope' });

    isLocalLiveMock.mockReturnValueOnce(true);
    updateLiveSessionModelPreferencesMock.mockRejectedValueOnce(new Error('surface locked'));
    writeLiveConversationControlErrorMock.mockImplementationOnce((res, error) => {
      res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
      return true;
    });
    const controlRes = createResponse();
    await handler({
      params: { id: 'conversation-1' },
      body: { model: 'gpt-5', surfaceId: 'surface-1' },
    }, controlRes);
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

  it('recovers live conversations without injecting a synthetic follow-up prompt', async () => {
    const { postHandler } = createHarness({ getCurrentProfile: () => 'assistant' });
    const handler = postHandler('/api/conversations/:id/recover');
    const res = createResponse();

    isLocalLiveMock.mockReturnValueOnce(true);
    liveRegistry.set('conversation-1', {
      cwd: '/repo/live',
      title: 'Live title',
      session: { sessionFile: '/sessions/conversation-1.json' },
    });

    await handler({ params: { id: 'conversation-1' } }, res);

    expect(syncWebLiveConversationRunMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-1',
      sessionFile: '/sessions/conversation-1.json',
      cwd: '/repo/live',
      title: 'Live title',
      profile: 'assistant',
      state: 'running',
    }));
    expect(syncWebLiveConversationRunMock.mock.calls[0]?.[0]?.pendingOperation).toBeNull();
    expect(promptLocalSessionMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      live: true,
      recovered: true,
      replayedPendingOperation: false,
      usedFallbackPrompt: false,
    });
  });

  it('replays pending operations when recovering stored conversations', async () => {
    const flushLiveDeferredResumesMock = vi.fn().mockResolvedValue(undefined);
    const { postHandler } = createHarness({
      getCurrentProfile: () => 'assistant',
      buildLiveSessionResourceOptions: () => ({ additionalExtensionPaths: ['extensions'] }),
      buildLiveSessionExtensionFactories: () => ['factory'],
      flushLiveDeferredResumes: flushLiveDeferredResumesMock,
    });
    const handler = postHandler('/api/conversations/:id/recover');
    const res = createResponse();
    const pendingOperation = {
      type: 'prompt' as const,
      text: 'Continue the deployment review.',
      behavior: 'append' as const,
      images: ['diagram.png'],
      contextMessages: [
        { customType: 'referenced_context', content: 'Remember the staging note.' },
      ],
      enqueuedAt: '2026-04-09T18:00:00.000Z',
    };

    createWebLiveConversationRunIdMock.mockReturnValueOnce('web-run:conversation-1');
    getDurableRunMock.mockResolvedValueOnce({
      run: {
        checkpoint: {
          payload: {
            pendingOperation: { type: 'prompt', text: 'ignored' },
            profile: ' reviewer ',
          },
        },
        manifest: {
          source: { filePath: ' /sessions/conversation-1.json ' },
          spec: { cwd: ' /manifest-cwd ' },
        },
      },
    });
    parsePendingOperationMock.mockReturnValueOnce(pendingOperation);
    readSessionBlocksMock.mockReturnValueOnce({
      meta: {
        file: '/sessions/conversation-1.json',
        cwd: '/repo/stored',
        title: 'Stored title',
      },
    });
    resumeLocalSessionMock.mockResolvedValueOnce({ id: 'conversation-1-live' });
    liveRegistry.set('conversation-1-live', { cwd: '/repo/resumed' });

    await handler({ params: { id: 'conversation-1' } }, res);

    expect(createWebLiveConversationRunIdMock).toHaveBeenCalledWith('conversation-1');
    expect(getDurableRunMock).toHaveBeenCalledWith('web-run:conversation-1');
    expect(resumeLocalSessionMock).toHaveBeenCalledWith('/sessions/conversation-1.json', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
    });
    expect(flushLiveDeferredResumesMock).toHaveBeenCalledTimes(1);
    expect(syncWebLiveConversationRunMock).toHaveBeenCalledWith({
      conversationId: 'conversation-1-live',
      sessionFile: '/sessions/conversation-1.json',
      cwd: '/repo/resumed',
      title: 'Stored title',
      profile: 'reviewer',
      state: 'running',
      pendingOperation,
    });
    expect(queuePromptContextMock).toHaveBeenCalledWith(
      'conversation-1-live',
      'referenced_context',
      'Remember the staging note.',
    );
    expect(promptLocalSessionMock).toHaveBeenCalledWith(
      'conversation-1-live',
      'Continue the deployment review.',
      'append',
      ['diagram.png'],
    );
    expect(res.json).toHaveBeenCalledWith({
      conversationId: 'conversation-1-live',
      live: true,
      recovered: true,
      replayedPendingOperation: true,
      usedFallbackPrompt: false,
    });
  });

  it('recovers stored conversations without fabricating a resume prompt', async () => {
    const { postHandler } = createHarness({ getCurrentProfile: () => 'assistant' });
    const handler = postHandler('/api/conversations/:id/recover');
    const res = createResponse();

    createWebLiveConversationRunIdMock.mockReturnValueOnce('web-run:conversation-2');
    getDurableRunMock.mockResolvedValueOnce({
      run: {
        checkpoint: {
          payload: {
            sessionFile: ' /sessions/from-checkpoint.json ',
            cwd: ' /checkpoint-cwd ',
            title: ' Checkpoint title ',
            profile: ' analyst ',
          },
        },
        manifest: {
          source: { filePath: ' /sessions/from-manifest.json ' },
          spec: { cwd: ' /manifest-cwd ' },
        },
      },
    });
    readSessionBlocksMock.mockReturnValueOnce(null);
    resumeLocalSessionMock.mockResolvedValueOnce({ id: 'conversation-2-live' });

    await handler({ params: { id: 'conversation-2' } }, res);

    expect(resumeLocalSessionMock).toHaveBeenCalledWith('/sessions/from-checkpoint.json', {
      additionalExtensionPaths: [],
      extensionFactories: [],
    });
    expect(syncWebLiveConversationRunMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conversation-2-live',
      sessionFile: '/sessions/from-checkpoint.json',
      cwd: '/checkpoint-cwd',
      title: 'Checkpoint title',
      profile: 'analyst',
      state: 'running',
    }));
    expect(syncWebLiveConversationRunMock.mock.calls[0]?.[0]?.pendingOperation).toBeNull();
    expect(promptLocalSessionMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      conversationId: 'conversation-2-live',
      live: true,
      recovered: true,
      replayedPendingOperation: false,
      usedFallbackPrompt: false,
    });
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
    createSessionFromExistingMock.mockResolvedValueOnce({ id: 'conversation-7', sessionFile: '/sessions/conversation-7.json' });
    const changedRes = createResponse();
    await handler({ params: { id: 'conversation-6' }, body: { cwd: '/next' } }, changedRes);
    expect(createSessionFromExistingMock).toHaveBeenCalledWith('/sessions/conversation-6.json', '/next', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
    });
    expect(destroySessionMock).toHaveBeenCalledWith('conversation-6');
    expect(publishConversationSessionMetaChangedMock).toHaveBeenCalledWith('conversation-6', 'conversation-7');
    expect(changedRes.json).toHaveBeenCalledWith({
      id: 'conversation-7',
      sessionFile: '/sessions/conversation-7.json',
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
    createSessionFromExistingMock.mockRejectedValueOnce(new Error('cwd clone failed'));

    await handler({ params: { id: 'conversation-1' }, body: { cwd: '/next' } }, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'cwd clone failed',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: cwd clone failed' });
  });
});
