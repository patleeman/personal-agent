import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  LiveSessionControlErrorClass,
  SessionManagerOpenMock,
  applyConversationModelPreferencesToSessionManagerMock,
  buildAppendOnlySessionDetailResponseMock,
  buildContentDispositionHeaderMock,
  cancelDeferredResumeForSessionFileMock,
  fireDeferredResumeNowForSessionFileMock,
  getAvailableModelObjectsMock,
  getConversationArtifactMock,
  getConversationAttachmentMock,
  invalidateAppTopicsMock,
  isLocalLiveMock,
  listConversationArtifactsMock,
  listConversationAttachmentsMock,
  listConversationSessionsSnapshotMock,
  listDeferredResumesForSessionFileMock,
  logErrorMock,
  logSlowConversationPerfMock,
  parseTailBlocksQueryMock,
  publishConversationSessionMetaChangedMock,
  readConversationAttachmentDownloadMock,
  readConversationModelPreferenceStateByIdMock,
  readConversationSessionMetaMock,
  readConversationSessionSignatureMock,
  readSavedModelPreferencesMock,
  readSessionBlockMock,
  readSessionDetailForRouteMock,
  readSessionImageAssetMock,
  readSessionSearchTextMock,
  searchConversationInspectSessionsMock,
  resolveConversationSessionFileMock,
  saveConversationAttachmentMock,
  addConversationCommitCheckpointCommentMock,
  scheduleDeferredResumeForSessionFileMock,
  setConversationServiceContextMock,
  setServerTimingHeadersMock,
  toggleConversationAttentionMock,
  updateLiveSessionModelPreferencesMock,
  ensureRequestControlsLocalLiveConversationMock,
} = vi.hoisted(() => ({
  LiveSessionControlErrorClass: class LiveSessionControlError extends Error {},
  SessionManagerOpenMock: vi.fn(),
  applyConversationModelPreferencesToSessionManagerMock: vi.fn(),
  buildAppendOnlySessionDetailResponseMock: vi.fn(),
  buildContentDispositionHeaderMock: vi.fn(),
  cancelDeferredResumeForSessionFileMock: vi.fn(),
  fireDeferredResumeNowForSessionFileMock: vi.fn(),
  getAvailableModelObjectsMock: vi.fn(),
  getConversationArtifactMock: vi.fn(),
  getConversationAttachmentMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  isLocalLiveMock: vi.fn(),
  listConversationArtifactsMock: vi.fn(),
  listConversationAttachmentsMock: vi.fn(),
  listConversationSessionsSnapshotMock: vi.fn(),
  listDeferredResumesForSessionFileMock: vi.fn(),
  logErrorMock: vi.fn(),
  logSlowConversationPerfMock: vi.fn(),
  parseTailBlocksQueryMock: vi.fn(),
  publishConversationSessionMetaChangedMock: vi.fn(),
  readConversationAttachmentDownloadMock: vi.fn(),
  readConversationModelPreferenceStateByIdMock: vi.fn(),
  readConversationSessionMetaMock: vi.fn(),
  readConversationSessionSignatureMock: vi.fn(),
  readSavedModelPreferencesMock: vi.fn(),
  readSessionBlockMock: vi.fn(),
  readSessionDetailForRouteMock: vi.fn(),
  readSessionImageAssetMock: vi.fn(),
  readSessionSearchTextMock: vi.fn(),
  searchConversationInspectSessionsMock: vi.fn(),
  resolveConversationSessionFileMock: vi.fn(),
  saveConversationAttachmentMock: vi.fn(),
  addConversationCommitCheckpointCommentMock: vi.fn(),
  scheduleDeferredResumeForSessionFileMock: vi.fn(),
  setConversationServiceContextMock: vi.fn(),
  setServerTimingHeadersMock: vi.fn(),
  toggleConversationAttentionMock: vi.fn(),
  updateLiveSessionModelPreferencesMock: vi.fn(),
  ensureRequestControlsLocalLiveConversationMock: vi.fn(),
}));

vi.mock('@mariozechner/pi-coding-agent', () => ({
  SessionManager: {
    open: SessionManagerOpenMock,
  },
}));

vi.mock('@personal-agent/core', () => ({
  getConversationArtifact: getConversationArtifactMock,
  getConversationAttachment: getConversationAttachmentMock,
  listConversationArtifacts: listConversationArtifactsMock,
  listConversationAttachments: listConversationAttachmentsMock,
  readConversationAttachmentDownload: readConversationAttachmentDownloadMock,
  saveConversationAttachment: saveConversationAttachmentMock,
  addConversationCommitCheckpointComment: addConversationCommitCheckpointCommentMock,
}));

vi.mock('../automation/deferredResumes.js', () => ({
  cancelDeferredResumeForSessionFile: cancelDeferredResumeForSessionFileMock,
  fireDeferredResumeNowForSessionFile: fireDeferredResumeNowForSessionFileMock,
  listDeferredResumesForSessionFile: listDeferredResumesForSessionFileMock,
  scheduleDeferredResumeForSessionFile: scheduleDeferredResumeForSessionFileMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  LiveSessionControlError: LiveSessionControlErrorClass,
  getAvailableModelObjects: getAvailableModelObjectsMock,
  isLive: isLocalLiveMock,
  updateLiveSessionModelPreferences: updateLiveSessionModelPreferencesMock,
}));

vi.mock('./liveSessions.js', () => ({
  ensureRequestControlsLocalLiveConversation: ensureRequestControlsLocalLiveConversationMock,
}));

vi.mock('../ui/settingsPersistence.js', () => ({
  DEFAULT_RUNTIME_SETTINGS_FILE: '/runtime/settings.json',
}));

vi.mock('../conversations/conversationModelPreferences.js', () => ({
  applyConversationModelPreferencesToSessionManager: applyConversationModelPreferencesToSessionManagerMock,
}));

vi.mock('../models/modelPreferences.js', () => ({
  readSavedModelPreferences: readSavedModelPreferencesMock,
}));

vi.mock('../conversations/sessions.js', () => ({
  buildAppendOnlySessionDetailResponse: buildAppendOnlySessionDetailResponseMock,
  readSessionBlock: readSessionBlockMock,
  readSessionImageAsset: readSessionImageAssetMock,
  readSessionSearchText: readSessionSearchTextMock,
}));

vi.mock('../shared/httpHeaders.js', () => ({
  buildContentDispositionHeader: buildContentDispositionHeaderMock,
}));

vi.mock('../middleware/index.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
  logError: logErrorMock,
  logSlowConversationPerf: logSlowConversationPerfMock,
  setServerTimingHeaders: setServerTimingHeadersMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

vi.mock('../conversations/conversationService.js', () => ({
  listConversationSessionsSnapshot: listConversationSessionsSnapshotMock,
  parseTailBlocksQuery: parseTailBlocksQueryMock,
  publishConversationSessionMetaChanged: publishConversationSessionMetaChangedMock,
  readConversationModelPreferenceStateById: readConversationModelPreferenceStateByIdMock,
  readConversationSessionMeta: readConversationSessionMetaMock,
  readConversationSessionSignature: readConversationSessionSignatureMock,
  readSessionDetailForRoute: readSessionDetailForRouteMock,
  resolveConversationSessionFile: resolveConversationSessionFileMock,
  setConversationServiceContext: setConversationServiceContextMock,
  toggleConversationAttention: toggleConversationAttentionMock,
}));

vi.mock('../conversations/conversationInspectCapability.js', () => ({
  ConversationInspectCapabilityInputError: class ConversationInspectCapabilityInputError extends Error {},
  searchConversationInspectSessions: searchConversationInspectSessionsMock,
}));

import { registerConversationRoutes } from './conversations.js';

type Handler = (
  req: { body?: unknown; params?: Record<string, string>; query?: Record<string, unknown> },
  res: ReturnType<typeof createResponse>,
) => Promise<void> | void;

function createRequest(overrides: Record<string, unknown> = {}) {
  return {
    body: {},
    params: {},
    query: {},
    ...overrides,
  };
}

function createResponse() {
  const response = {
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
    statusCode: 200,
    json: vi.fn((payload: unknown) => {
      response.body = payload;
      return response;
    }),
    send: vi.fn(),
    sendFile: vi.fn(),
    setHeader: vi.fn((name: string, value: unknown) => {
      response.headers[name] = value;
    }),
    status: vi.fn((code: number) => {
      response.statusCode = code;
      return response;
    }),
    type: vi.fn((mimeType: string) => {
      response.headers['content-type'] = mimeType;
      return response;
    }),
  };

  return response;
}

function createDesktopHarness(options?: {
  flushLiveDeferredResumes?: () => Promise<void>;
}) {
  const deleteHandlers = new Map<string, Handler>();
  const getHandlers = new Map<string, Handler>();
  const patchHandlers = new Map<string, Handler>();
  const postHandlers = new Map<string, Handler>();
  const router = {
    delete: vi.fn((path: string, handler: Handler) => {
      deleteHandlers.set(path, handler);
    }),
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

  registerConversationRoutes(router as never, {
    flushLiveDeferredResumes: options?.flushLiveDeferredResumes ?? (async () => {}),
    getCurrentProfile: () => 'assistant',
    getRepoRoot: () => '/repo',
    getSavedUiPreferences: () => ({ compactConversations: false }),
  });

  return {
    deleteHandler: (path: string) => deleteHandlers.get(path)!,
    getHandler: (path: string) => getHandlers.get(path)!,
    patchHandler: (path: string) => patchHandlers.get(path)!,
    postHandler: (path: string) => postHandlers.get(path)!,
  };
}

describe('conversation routes', () => {
  beforeEach(() => {
    SessionManagerOpenMock.mockReset();
    applyConversationModelPreferencesToSessionManagerMock.mockReset();
    buildAppendOnlySessionDetailResponseMock.mockReset();
    buildContentDispositionHeaderMock.mockReset();
    cancelDeferredResumeForSessionFileMock.mockReset();
    fireDeferredResumeNowForSessionFileMock.mockReset();
    getAvailableModelObjectsMock.mockReset();
    getConversationArtifactMock.mockReset();
    getConversationAttachmentMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    isLocalLiveMock.mockReset();
    listConversationArtifactsMock.mockReset();
    listConversationAttachmentsMock.mockReset();
    listConversationSessionsSnapshotMock.mockReset();
    listDeferredResumesForSessionFileMock.mockReset();
    logErrorMock.mockReset();
    logSlowConversationPerfMock.mockReset();
    parseTailBlocksQueryMock.mockReset();
    publishConversationSessionMetaChangedMock.mockReset();
    readConversationAttachmentDownloadMock.mockReset();
    readConversationModelPreferenceStateByIdMock.mockReset();
    readConversationSessionMetaMock.mockReset();
    readConversationSessionSignatureMock.mockReset();
    readSavedModelPreferencesMock.mockReset();
    readSessionBlockMock.mockReset();
    readSessionDetailForRouteMock.mockReset();
    readSessionImageAssetMock.mockReset();
    readSessionSearchTextMock.mockReset();
    searchConversationInspectSessionsMock.mockReset();
    resolveConversationSessionFileMock.mockReset();
    saveConversationAttachmentMock.mockReset();
    addConversationCommitCheckpointCommentMock.mockReset();
    scheduleDeferredResumeForSessionFileMock.mockReset();
    setConversationServiceContextMock.mockReset();
    setServerTimingHeadersMock.mockReset();
    toggleConversationAttentionMock.mockReset();
    updateLiveSessionModelPreferencesMock.mockReset();
    ensureRequestControlsLocalLiveConversationMock.mockReset();

    SessionManagerOpenMock.mockReturnValue({ sessionFile: '/sessions/session-1.jsonl' });
    applyConversationModelPreferencesToSessionManagerMock.mockReturnValue({ model: 'gpt-4o', thinkingLevel: 'high' });
    buildAppendOnlySessionDetailResponseMock.mockReturnValue({ appended: true, sessionId: 'session-1' });
    buildContentDispositionHeaderMock.mockReturnValue('inline; filename="image.png"');
    fireDeferredResumeNowForSessionFileMock.mockResolvedValue({ id: 'resume-1', fired: true });
    getAvailableModelObjectsMock.mockReturnValue([{ id: 'gpt-4o' }]);
    getConversationArtifactMock.mockReturnValue({ id: 'artifact-1', title: 'Artifact 1' });
    getConversationAttachmentMock.mockReturnValue({ id: 'attachment-1', kind: 'excalidraw' });
    isLocalLiveMock.mockReturnValue(false);
    listConversationArtifactsMock.mockReturnValue([{ id: 'artifact-1', title: 'Artifact 1' }]);
    listConversationAttachmentsMock.mockReturnValue([{ id: 'attachment-1', kind: 'excalidraw' }]);
    listConversationSessionsSnapshotMock.mockReturnValue([{ id: 'session-1', title: 'Session 1' }]);
    listDeferredResumesForSessionFileMock.mockReturnValue([{ id: 'resume-1' }]);
    parseTailBlocksQueryMock.mockReturnValue(25);
    readConversationAttachmentDownloadMock.mockReturnValue({
      fileName: 'preview.png',
      filePath: '/tmp/preview.png',
      mimeType: 'image/png',
    });
    readConversationModelPreferenceStateByIdMock.mockResolvedValue({ model: 'gpt-4o', thinkingLevel: 'high' });
    readConversationSessionMetaMock.mockReturnValue({ id: 'session-1', title: 'Session 1' });
    readConversationSessionSignatureMock.mockReturnValue('sig-current');
    readSavedModelPreferencesMock.mockReturnValue({ currentModel: 'gpt-4o', currentThinkingLevel: 'high' });
    readSessionBlockMock.mockReturnValue({ id: 'block-1', text: 'Block text' });
    readSessionDetailForRouteMock.mockResolvedValue({
      remoteMirror: { durationMs: 0, status: 'skipped' },
      sessionRead: {
        detail: { id: 'session-1', signature: 'sig-next' },
        telemetry: { cache: 'miss', durationMs: 12, loader: 'local' },
      },
    });
    readSessionImageAssetMock.mockReturnValue({
      data: Buffer.from('image-data'),
      fileName: 'image.png',
      mimeType: 'image/png',
    });
    readSessionSearchTextMock.mockReturnValue('search text');
    searchConversationInspectSessionsMock.mockReturnValue({ query: 'needle', mode: 'allTerms', scope: 'all', totalMatching: 1, returnedCount: 1, matches: [{ conversationId: 'session-1', title: 'Session 1', snippet: 'needle found' }] });
    resolveConversationSessionFileMock.mockReturnValue('/sessions/session-1.jsonl');
    saveConversationAttachmentMock.mockReturnValue({ id: 'attachment-1', kind: 'excalidraw' });
    addConversationCommitCheckpointCommentMock.mockReturnValue({ id: 'checkpoint-1', commentCount: 1, comments: [{ id: 'comment-1', body: 'Ship it' }] });
    scheduleDeferredResumeForSessionFileMock.mockResolvedValue({ id: 'resume-2', delay: '5m' });
    toggleConversationAttentionMock.mockReturnValue({ read: true });
    updateLiveSessionModelPreferencesMock.mockResolvedValue({ model: 'gpt-4o', thinkingLevel: 'high' });
  });

  it('serves desktop session routes for metadata, detail responses, assets, list snapshots, and search text', async () => {
    const { getHandler, postHandler } = createDesktopHarness();

    expect(setConversationServiceContextMock).toHaveBeenCalledWith({
      getCurrentProfile: expect.any(Function),
      getRepoRoot: expect.any(Function),
      getSavedUiPreferences: expect.any(Function),
    });

    const metaRes = createResponse();
    getHandler('/api/sessions/:id/meta')(createRequest({ params: { id: 'session-1' } }), metaRes);
    expect(metaRes.json).toHaveBeenCalledWith({ id: 'session-1', title: 'Session 1' });

    readConversationSessionMetaMock.mockReturnValueOnce(null);
    const missingMetaRes = createResponse();
    getHandler('/api/sessions/:id/meta')(createRequest({ params: { id: 'missing' } }), missingMetaRes);
    expect(missingMetaRes.status).toHaveBeenCalledWith(404);
    expect(missingMetaRes.json).toHaveBeenCalledWith({ error: 'Session not found' });

    readConversationSessionSignatureMock.mockReturnValueOnce('sig-current');
    const unchangedRes = createResponse();
    await getHandler('/api/sessions/:id')(createRequest({
      params: { id: 'session-1' },
      query: { knownSessionSignature: ' sig-current ', tailBlocks: '5' },
    }), unchangedRes);
    expect(unchangedRes.json).toHaveBeenCalledWith({
      unchanged: true,
      sessionId: 'session-1',
      signature: 'sig-current',
    });

    readConversationSessionSignatureMock.mockReturnValueOnce('sig-current');
    buildAppendOnlySessionDetailResponseMock.mockReturnValueOnce({ appended: true, sessionId: 'session-1' });
    const appendOnlyRes = createResponse();
    await getHandler('/api/sessions/:id')(createRequest({
      params: { id: 'session-1' },
      query: {
        knownBlockOffset: '3abc',
        knownLastBlockId: 'block-3',
        knownSessionSignature: 'sig-old',
        knownTotalBlocks: '4abc',
        tailBlocks: '10',
      },
    }), appendOnlyRes);
    expect(readSessionDetailForRouteMock).toHaveBeenCalledWith({
      conversationId: 'session-1',
      profile: 'assistant',
      tailBlocks: 25,
    });
    expect(buildAppendOnlySessionDetailResponseMock).toHaveBeenCalledWith({
      detail: { id: 'session-1', signature: 'sig-next' },
      knownBlockOffset: undefined,
      knownLastBlockId: 'block-3',
      knownTotalBlocks: undefined,
    });
    expect(appendOnlyRes.json).toHaveBeenCalledWith({ appended: true, sessionId: 'session-1' });

    readSessionDetailForRouteMock.mockResolvedValueOnce({
      remoteMirror: { durationMs: 0, status: 'skipped' },
      sessionRead: {
        detail: { id: 'session-1', signature: 'sig-next', blocks: [] },
        telemetry: { cache: 'hit', durationMs: 8, loader: 'local' },
      },
    });
    const detailRes = createResponse();
    await getHandler('/api/sessions/:id')(createRequest({ params: { id: 'session-1' }, query: {} }), detailRes);
    expect(setServerTimingHeadersMock).toHaveBeenCalledWith(detailRes, expect.arrayContaining([
      expect.objectContaining({ description: 'skipped' }),
      expect.objectContaining({ description: 'hit/local' }),
    ]), expect.objectContaining({ route: 'session-detail' }));
    expect(logSlowConversationPerfMock).toHaveBeenCalledWith('session detail request', expect.objectContaining({ conversationId: 'session-1' }));
    expect(detailRes.json).toHaveBeenCalledWith({ id: 'session-1', signature: 'sig-next', blocks: [] });

    readSessionImageAssetMock.mockReturnValueOnce(null);
    const missingImageRes = createResponse();
    getHandler('/api/sessions/:id/blocks/:blockId/image')(createRequest({ params: { id: 'session-1', blockId: 'block-1' } }), missingImageRes);
    expect(missingImageRes.status).toHaveBeenCalledWith(404);
    expect(missingImageRes.json).toHaveBeenCalledWith({ error: 'Session image not found' });

    const imageRes = createResponse();
    getHandler('/api/sessions/:id/blocks/:blockId/image')(createRequest({ params: { id: 'session-1', blockId: 'block-1' } }), imageRes);
    expect(imageRes.setHeader).toHaveBeenCalledWith('Content-Disposition', 'inline; filename="image.png"');
    expect(imageRes.type).toHaveBeenCalledWith('image/png');
    expect(imageRes.send).toHaveBeenCalledWith(Buffer.from('image-data'));

    const indexedImageRes = createResponse();
    getHandler('/api/sessions/:id/blocks/:blockId/images/:imageIndex')(createRequest({
      params: { id: 'session-1', blockId: 'block-1', imageIndex: '2' },
    }), indexedImageRes);
    expect(readSessionImageAssetMock).toHaveBeenLastCalledWith('session-1', 'block-1', 2);
    expect(indexedImageRes.send).toHaveBeenCalledWith(Buffer.from('image-data'));

    const malformedIndexedImageRes = createResponse();
    getHandler('/api/sessions/:id/blocks/:blockId/images/:imageIndex')(createRequest({
      params: { id: 'session-1', blockId: 'block-1', imageIndex: '2abc' },
    }), malformedIndexedImageRes);
    expect(malformedIndexedImageRes.status).toHaveBeenCalledWith(400);
    expect(malformedIndexedImageRes.json).toHaveBeenCalledWith({ error: 'imageIndex must be a non-negative integer' });

    readSessionBlockMock.mockReturnValueOnce(null);
    const missingBlockRes = createResponse();
    getHandler('/api/sessions/:id/blocks/:blockId')(createRequest({ params: { id: 'session-1', blockId: 'missing' } }), missingBlockRes);
    expect(missingBlockRes.status).toHaveBeenCalledWith(404);
    expect(missingBlockRes.json).toHaveBeenCalledWith({ error: 'Session block not found' });

    const blockRes = createResponse();
    getHandler('/api/sessions/:id/blocks/:blockId')(createRequest({ params: { id: 'session-1', blockId: 'block-1' } }), blockRes);
    expect(blockRes.json).toHaveBeenCalledWith({ id: 'block-1', text: 'Block text' });

    const listRes = createResponse();
    getHandler('/api/sessions')(createRequest(), listRes);
    expect(listRes.json).toHaveBeenCalledWith([{ id: 'session-1', title: 'Session 1' }]);

    const emptySearchRes = createResponse();
    postHandler('/api/sessions/search-index')(createRequest({ body: { sessionIds: [] } }), emptySearchRes);
    expect(emptySearchRes.json).toHaveBeenCalledWith({ index: {} });

    const searchRes = createResponse();
    postHandler('/api/sessions/search-index')(createRequest({ body: { sessionIds: ['session-1', ' ', 42] } }), searchRes);
    expect(readSessionSearchTextMock).toHaveBeenCalledWith('session-1');
    expect(searchRes.json).toHaveBeenCalledWith({ index: { 'session-1': 'search text' } });

    const contentSearchRes = createResponse();
    postHandler('/api/sessions/search')(createRequest({ body: { query: 'needle', limit: 25 } }), contentSearchRes);
    expect(searchConversationInspectSessionsMock).toHaveBeenCalledWith({
      query: 'needle',
      limit: 25,
      scope: 'all',
      searchMode: 'allTerms',
      maxSnippetCharacters: 220,
      stopAfterLimit: true,
    });
    expect(contentSearchRes.json).toHaveBeenCalledWith({ query: 'needle', mode: 'allTerms', scope: 'all', totalMatching: 1, returnedCount: 1, matches: [{ conversationId: 'session-1', title: 'Session 1', snippet: 'needle found' }] });
  });

  it('handles deferred resumes, artifacts, attachments, attention toggles, and plan state routes', async () => {
    const flushLiveDeferredResumes = vi.fn(async () => {});
    const { deleteHandler, getHandler, patchHandler, postHandler } = createDesktopHarness({ flushLiveDeferredResumes });

    resolveConversationSessionFileMock.mockReturnValueOnce(null);
    const missingResumesRes = createResponse();
    getHandler('/api/conversations/:id/deferred-resumes')(createRequest({ params: { id: 'missing' } }), missingResumesRes);
    expect(missingResumesRes.status).toHaveBeenCalledWith(404);
    expect(missingResumesRes.json).toHaveBeenCalledWith({ error: 'Conversation not found' });

    const resumesRes = createResponse();
    getHandler('/api/conversations/:id/deferred-resumes')(createRequest({ params: { id: 'session-1' } }), resumesRes);
    expect(resumesRes.json).toHaveBeenCalledWith({
      conversationId: 'session-1',
      resumes: [{ id: 'resume-1' }],
    });

    resolveConversationSessionFileMock.mockReturnValueOnce('/sessions/session-1.jsonl');
    const missingDelayRes = createResponse();
    await postHandler('/api/conversations/:id/deferred-resumes')(createRequest({ params: { id: 'session-1' }, body: {} }), missingDelayRes);
    expect(missingDelayRes.status).toHaveBeenCalledWith(400);
    expect(missingDelayRes.json).toHaveBeenCalledWith({ error: 'delay is required' });

    const createResumeRes = createResponse();
    await postHandler('/api/conversations/:id/deferred-resumes')(createRequest({
      params: { id: 'session-1' },
      body: { delay: '5m', prompt: 'Check again later', behavior: 'followUp' },
    }), createResumeRes);
    expect(scheduleDeferredResumeForSessionFileMock).toHaveBeenCalledWith({
      delay: '5m',
      prompt: 'Check again later',
      behavior: 'followUp',
      sessionFile: '/sessions/session-1.jsonl',
    });
    expect(publishConversationSessionMetaChangedMock).toHaveBeenCalledWith('session-1');
    expect(createResumeRes.json).toHaveBeenCalledWith({
      conversationId: 'session-1',
      resume: { id: 'resume-2', delay: '5m' },
      resumes: [{ id: 'resume-1' }],
    });

    const cancelResumeRes = createResponse();
    await deleteHandler('/api/conversations/:id/deferred-resumes/:resumeId')(createRequest({
      params: { id: 'session-1', resumeId: 'resume-1' },
    }), cancelResumeRes);
    expect(cancelDeferredResumeForSessionFileMock).toHaveBeenCalledWith({
      id: 'resume-1',
      sessionFile: '/sessions/session-1.jsonl',
    });
    expect(cancelResumeRes.json).toHaveBeenCalledWith({
      cancelledId: 'resume-1',
      conversationId: 'session-1',
      resumes: [{ id: 'resume-1' }],
    });

    const fireResumeRes = createResponse();
    await postHandler('/api/conversations/:id/deferred-resumes/:resumeId/fire')(createRequest({
      params: { id: 'session-1', resumeId: 'resume-1' },
    }), fireResumeRes);
    expect(fireDeferredResumeNowForSessionFileMock).toHaveBeenCalledWith({
      id: 'resume-1',
      sessionFile: '/sessions/session-1.jsonl',
    });
    expect(flushLiveDeferredResumes).toHaveBeenCalled();
    expect(fireResumeRes.json).toHaveBeenCalledWith({
      conversationId: 'session-1',
      resume: { id: 'resume-1', fired: true },
      resumes: [{ id: 'resume-1' }],
    });

    const artifactsRes = createResponse();
    getHandler('/api/conversations/:id/artifacts')(createRequest({ params: { id: 'session-1' } }), artifactsRes);
    expect(artifactsRes.json).toHaveBeenCalledWith({
      artifacts: [{ id: 'artifact-1', title: 'Artifact 1' }],
      conversationId: 'session-1',
    });

    getConversationArtifactMock.mockReturnValueOnce(null);
    const missingArtifactRes = createResponse();
    getHandler('/api/conversations/:id/artifacts/:artifactId')(createRequest({
      params: { id: 'session-1', artifactId: 'missing' },
    }), missingArtifactRes);
    expect(missingArtifactRes.status).toHaveBeenCalledWith(404);
    expect(missingArtifactRes.json).toHaveBeenCalledWith({ error: 'Artifact not found' });

    const createCheckpointCommentRes = createResponse();
    postHandler('/api/conversations/:id/checkpoints/:checkpointId/comments')(createRequest({
      params: { id: 'session-1', checkpointId: 'checkpoint-1' },
      body: { body: 'Ship it' },
    }), createCheckpointCommentRes);
    expect(addConversationCommitCheckpointCommentMock).toHaveBeenCalledWith({
      profile: 'assistant',
      conversationId: 'session-1',
      checkpointId: 'checkpoint-1',
      body: 'Ship it',
      authorName: 'You',
      authorProfile: 'assistant',
    });
    expect(createCheckpointCommentRes.json).toHaveBeenCalledWith({
      conversationId: 'session-1',
      checkpoint: { id: 'checkpoint-1', commentCount: 1, comments: [{ id: 'comment-1', body: 'Ship it' }] },
    });

    const attachmentsRes = createResponse();
    getHandler('/api/conversations/:id/attachments')(createRequest({ params: { id: 'session-1' } }), attachmentsRes);
    expect(attachmentsRes.json).toHaveBeenCalledWith({
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
      conversationId: 'session-1',
    });

    getConversationAttachmentMock.mockReturnValueOnce(null);
    const missingAttachmentRes = createResponse();
    getHandler('/api/conversations/:id/attachments/:attachmentId')(createRequest({
      params: { id: 'session-1', attachmentId: 'missing' },
    }), missingAttachmentRes);
    expect(missingAttachmentRes.status).toHaveBeenCalledWith(404);
    expect(missingAttachmentRes.json).toHaveBeenCalledWith({ error: 'Attachment not found' });

    const badCreateAttachmentRes = createResponse();
    postHandler('/api/conversations/:id/attachments')(createRequest({ params: { id: 'session-1' }, body: {} }), badCreateAttachmentRes);
    expect(badCreateAttachmentRes.status).toHaveBeenCalledWith(400);
    expect(badCreateAttachmentRes.json).toHaveBeenCalledWith({ error: 'sourceData and previewData are required.' });

    const createAttachmentRes = createResponse();
    postHandler('/api/conversations/:id/attachments')(createRequest({
      params: { id: 'session-1' },
      body: {
        note: 'Diagram note',
        previewData: 'preview-data',
        previewMimeType: 'image/png',
        sourceData: 'source-data',
        sourceMimeType: 'application/json',
        title: 'Diagram',
      },
    }), createAttachmentRes);
    expect(saveConversationAttachmentMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'session-1',
      note: 'Diagram note',
      profile: 'assistant',
      title: 'Diagram',
    }));
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('attachments');

    const badPatchAttachmentRes = createResponse();
    patchHandler('/api/conversations/:id/attachments/:attachmentId')(createRequest({
      params: { id: 'session-1', attachmentId: 'attachment-1' },
      body: { sourceData: 'only-source' },
    }), badPatchAttachmentRes);
    expect(badPatchAttachmentRes.status).toHaveBeenCalledWith(400);
    expect(badPatchAttachmentRes.json).toHaveBeenCalledWith({ error: 'sourceData and previewData are required.' });

    getConversationAttachmentMock.mockReturnValueOnce(null);
    const patchMissingAttachmentRes = createResponse();
    patchHandler('/api/conversations/:id/attachments/:attachmentId')(createRequest({
      params: { id: 'session-1', attachmentId: 'missing' },
      body: { sourceData: 'source', previewData: 'preview' },
    }), patchMissingAttachmentRes);
    expect(patchMissingAttachmentRes.status).toHaveBeenCalledWith(404);
    expect(patchMissingAttachmentRes.json).toHaveBeenCalledWith({ error: 'Attachment not found' });

    const patchAttachmentRes = createResponse();
    patchHandler('/api/conversations/:id/attachments/:attachmentId')(createRequest({
      params: { id: 'session-1', attachmentId: 'attachment-1' },
      body: { sourceData: 'source', previewData: 'preview', title: 'Updated diagram' },
    }), patchAttachmentRes);
    expect(saveConversationAttachmentMock).toHaveBeenLastCalledWith(expect.objectContaining({
      attachmentId: 'attachment-1',
      title: 'Updated diagram',
    }));
    expect(patchAttachmentRes.json).toHaveBeenCalledWith(expect.objectContaining({
      attachment: { id: 'attachment-1', kind: 'excalidraw' },
      conversationId: 'session-1',
    }));

    const badAssetRes = createResponse();
    getHandler('/api/conversations/:id/attachments/:attachmentId/download/:asset')(createRequest({
      params: { id: 'session-1', attachmentId: 'attachment-1', asset: 'invalid' },
      query: {},
    }), badAssetRes);
    expect(badAssetRes.status).toHaveBeenCalledWith(400);
    expect(badAssetRes.json).toHaveBeenCalledWith({ error: 'asset must be "source" or "preview"' });

    const badRevisionRes = createResponse();
    getHandler('/api/conversations/:id/attachments/:attachmentId/download/:asset')(createRequest({
      params: { id: 'session-1', attachmentId: 'attachment-1', asset: 'preview' },
      query: { revision: '0' },
    }), badRevisionRes);
    expect(badRevisionRes.status).toHaveBeenCalledWith(400);
    expect(badRevisionRes.json).toHaveBeenCalledWith({ error: 'revision must be a positive integer when provided.' });

    const malformedRevisionRes = createResponse();
    getHandler('/api/conversations/:id/attachments/:attachmentId/download/:asset')(createRequest({
      params: { id: 'session-1', attachmentId: 'attachment-1', asset: 'preview' },
      query: { revision: '2abc' },
    }), malformedRevisionRes);
    expect(malformedRevisionRes.status).toHaveBeenCalledWith(400);
    expect(malformedRevisionRes.json).toHaveBeenCalledWith({ error: 'revision must be a positive integer when provided.' });

    const downloadRes = createResponse();
    getHandler('/api/conversations/:id/attachments/:attachmentId/download/:asset')(createRequest({
      params: { id: 'session-1', attachmentId: 'attachment-1', asset: 'preview' },
      query: { revision: '2' },
    }), downloadRes);
    expect(readConversationAttachmentDownloadMock).toHaveBeenCalledWith({
      asset: 'preview',
      attachmentId: 'attachment-1',
      conversationId: 'session-1',
      profile: 'assistant',
      revision: 2,
    });
    expect(downloadRes.sendFile).toHaveBeenCalledWith('/tmp/preview.png');

    readConversationAttachmentDownloadMock.mockImplementationOnce(() => {
      throw new Error('Attachment not found');
    });
    const downloadMissingRes = createResponse();
    getHandler('/api/conversations/:id/attachments/:attachmentId/download/:asset')(createRequest({
      params: { id: 'session-1', attachmentId: 'attachment-1', asset: 'source' },
      query: {},
    }), downloadMissingRes);
    expect(downloadMissingRes.status).toHaveBeenCalledWith(404);
    expect(downloadMissingRes.json).toHaveBeenCalledWith({ error: 'Attachment not found' });

    toggleConversationAttentionMock.mockReturnValueOnce(null);
    const missingAttentionRes = createResponse();
    patchHandler('/api/conversations/:id/attention')(createRequest({ params: { id: 'missing' }, body: { read: true } }), missingAttentionRes);
    expect(missingAttentionRes.status).toHaveBeenCalledWith(404);
    expect(missingAttentionRes.json).toHaveBeenCalledWith({ error: 'Conversation not found' });

    const attentionRes = createResponse();
    patchHandler('/api/conversations/:id/attention')(createRequest({ params: { id: 'session-1' }, body: { read: true } }), attentionRes);
    expect(toggleConversationAttentionMock).toHaveBeenCalledWith({
      conversationId: 'session-1',
      profile: 'assistant',
      read: true,
    });
    expect(attentionRes.json).toHaveBeenCalledWith({ ok: true });

  });
});
