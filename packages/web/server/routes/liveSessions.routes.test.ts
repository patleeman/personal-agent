import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  LiveSessionControlErrorClass,
  abortLocalSessionMock,
  branchSessionMock,
  compactSessionMock,
  createLocalSessionMock,
  prewarmLiveSessionLoaderMock,
  destroySessionMock,
  existsSyncMock,
  exportSessionHtmlMock,
  forkSessionMock,
  getLiveSessionForkEntriesMock,
  getLiveSessionsMock,
  getSessionStatsMock,
  invalidateAppTopicsMock,
  isLiveMock,
  listPendingBackgroundRunResultsMock,
  liveRegistry,
  loadDaemonConfigMock,
  logErrorMock,
  logSlowConversationPerfMock,
  logWarnMock,
  markBackgroundRunResultsDeliveredMock,
  parseTailBlocksQueryMock,
  extractMentionIdsMock,
  pickPromptReferencesInOrderMock,
  queuePromptContextMock,
  readGitStatusSummaryWithTelemetryMock,
  readSessionBlocksMock,
  readSessionMetaMock,
  reloadSessionResourcesMock,
  resolveConversationAttachmentPromptFilesMock,
  resolveConversationCwdMock,
  resolveDaemonPathsMock,
  resolveDurableRunsRootMock,
  resolveMentionedVaultFilesMock,
  resolvePromptReferencesMock,
  restoreQueuedMessageMock,
  resumeLocalSessionMock,
  setServerTimingHeadersMock,
  submitLocalPromptSessionMock,
  subscribeLocalMock,
  summarizeAndForkSessionMock,
  syncWebLiveConversationRunMock,
  takeOverSessionControlMock,
  buildReferencedMemoryDocsContextMock,
  buildReferencedTasksContextMock,
  buildReferencedVaultFilesContextMock,
  expandPromptReferencesWithNodeGraphMock,
  createSessionListenerUnsubscribeMock,
} = vi.hoisted(() => ({
  LiveSessionControlErrorClass: class LiveSessionControlError extends Error {},
  abortLocalSessionMock: vi.fn(),
  branchSessionMock: vi.fn(),
  compactSessionMock: vi.fn(),
  createLocalSessionMock: vi.fn(),
  prewarmLiveSessionLoaderMock: vi.fn(),
  createSessionListenerUnsubscribeMock: vi.fn(),
  destroySessionMock: vi.fn(),
  existsSyncMock: vi.fn(),
  exportSessionHtmlMock: vi.fn(),
  forkSessionMock: vi.fn(),
  getLiveSessionForkEntriesMock: vi.fn(),
  getLiveSessionsMock: vi.fn(),
  getSessionStatsMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  isLiveMock: vi.fn(),
  listPendingBackgroundRunResultsMock: vi.fn(),
  liveRegistry: new Map<string, unknown>(),
  loadDaemonConfigMock: vi.fn(),
  logErrorMock: vi.fn(),
  logSlowConversationPerfMock: vi.fn(),
  logWarnMock: vi.fn(),
  markBackgroundRunResultsDeliveredMock: vi.fn(),
  parseTailBlocksQueryMock: vi.fn(),
  extractMentionIdsMock: vi.fn(),
  pickPromptReferencesInOrderMock: vi.fn(),
  queuePromptContextMock: vi.fn(),
  readGitStatusSummaryWithTelemetryMock: vi.fn(),
  readSessionBlocksMock: vi.fn(),
  readSessionMetaMock: vi.fn(),
  reloadSessionResourcesMock: vi.fn(),
  resolveConversationAttachmentPromptFilesMock: vi.fn(),
  resolveConversationCwdMock: vi.fn(),
  resolveDaemonPathsMock: vi.fn(),
  resolveDurableRunsRootMock: vi.fn(),
  resolveMentionedVaultFilesMock: vi.fn(),
  resolvePromptReferencesMock: vi.fn(),
  restoreQueuedMessageMock: vi.fn(),
  resumeLocalSessionMock: vi.fn(),
  setServerTimingHeadersMock: vi.fn(),
  submitLocalPromptSessionMock: vi.fn(),
  subscribeLocalMock: vi.fn(),
  summarizeAndForkSessionMock: vi.fn(),
  syncWebLiveConversationRunMock: vi.fn(),
  takeOverSessionControlMock: vi.fn(),
  buildReferencedMemoryDocsContextMock: vi.fn(),
  buildReferencedTasksContextMock: vi.fn(),
  buildReferencedVaultFilesContextMock: vi.fn(),
  expandPromptReferencesWithNodeGraphMock: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: existsSyncMock,
}));

vi.mock('@personal-agent/core', () => ({
  resolveConversationAttachmentPromptFiles: resolveConversationAttachmentPromptFilesMock,
}));

vi.mock('@personal-agent/daemon', () => ({
  listPendingBackgroundRunResults: listPendingBackgroundRunResultsMock,
  loadDaemonConfig: loadDaemonConfigMock,
  markBackgroundRunResultsDelivered: markBackgroundRunResultsDeliveredMock,
  resolveDaemonPaths: resolveDaemonPathsMock,
  resolveDurableRunsRoot: resolveDurableRunsRootMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  LiveSessionControlError: LiveSessionControlErrorClass,
  abortSession: abortLocalSessionMock,
  branchSession: branchSessionMock,
  compactSession: compactSessionMock,
  createSession: createLocalSessionMock,
  prewarmLiveSessionLoader: prewarmLiveSessionLoaderMock,
  destroySession: destroySessionMock,
  exportSessionHtml: exportSessionHtmlMock,
  forkSession: forkSessionMock,
  getLiveSessionForkEntries: getLiveSessionForkEntriesMock,
  getLiveSessions: getLiveSessionsMock,
  getSessionStats: getSessionStatsMock,
  isLive: isLiveMock,
  queuePromptContext: queuePromptContextMock,
  registry: liveRegistry,
  reloadSessionResources: reloadSessionResourcesMock,
  renameSession: vi.fn(),
  restoreQueuedMessage: restoreQueuedMessageMock,
  resumeSession: resumeLocalSessionMock,
  submitPromptSession: submitLocalPromptSessionMock,
  subscribe: subscribeLocalMock,
  summarizeAndForkSession: summarizeAndForkSessionMock,
  takeOverSessionControl: takeOverSessionControlMock,
}));


vi.mock('../middleware/index.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
  logError: logErrorMock,
  logSlowConversationPerf: logSlowConversationPerfMock,
  logWarn: logWarnMock,
  setServerTimingHeaders: setServerTimingHeadersMock,
}));

vi.mock('../conversations/conversationService.js', () => ({
  parseTailBlocksQuery: parseTailBlocksQueryMock,
}));

vi.mock('../conversations/sessions.js', () => ({
  readSessionBlocks: readSessionBlocksMock,
  readSessionMeta: readSessionMetaMock,
}));

vi.mock('../conversations/conversationCwd.js', () => ({
  resolveConversationCwd: resolveConversationCwdMock,
}));

vi.mock('../knowledge/promptReferences.js', () => ({
  buildReferencedMemoryDocsContext: buildReferencedMemoryDocsContextMock,
  buildReferencedTasksContext: buildReferencedTasksContextMock,
  expandPromptReferencesWithNodeGraph: expandPromptReferencesWithNodeGraphMock,
  extractMentionIds: extractMentionIdsMock,
  pickPromptReferencesInOrder: pickPromptReferencesInOrderMock,
  resolvePromptReferences: resolvePromptReferencesMock,
}));

vi.mock('../knowledge/vaultFiles.js', () => ({
  buildReferencedVaultFilesContext: buildReferencedVaultFilesContextMock,
  resolveMentionedVaultFiles: resolveMentionedVaultFilesMock,
}));

vi.mock('../conversations/conversationRuns.js', () => ({
  syncWebLiveConversationRun: syncWebLiveConversationRunMock,
}));

vi.mock('../workspace/gitStatus.js', () => ({
  readGitStatusSummaryWithTelemetry: readGitStatusSummaryWithTelemetryMock,
}));

import {
  handleLiveSessionPrompt,
  registerLiveSessionRoutes,
  registerLiveSessionStatsRoutes,
  writeLiveConversationControlError,
} from './liveSessions.js';

type Handler = (req: unknown, res: unknown) => Promise<void> | void;

function createRequest(overrides: Record<string, unknown> = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const req = {
    body: {},
    headers: {},
    on: vi.fn((event: string, listener: () => void) => {
      const existing = listeners.get(event) ?? [];
      existing.push(listener);
      listeners.set(event, existing);
    }),
    originalUrl: undefined as string | undefined,
    params: {},
    query: {},
    url: '',
    emit(event: string) {
      for (const listener of listeners.get(event) ?? []) {
        listener();
      }
    },
    ...overrides,
  };

  return req;
}

function createResponse() {
  const response = {
    body: undefined as unknown,
    headers: {} as Record<string, unknown>,
    statusCode: 200,
    end: vi.fn(),
    flushHeaders: vi.fn(),
    json: vi.fn((payload: unknown) => {
      response.body = payload;
      return response;
    }),
    setHeader: vi.fn((name: string, value: unknown) => {
      response.headers[name] = value;
    }),
    status: vi.fn((code: number) => {
      response.statusCode = code;
      return response;
    }),
    write: vi.fn(),
  };

  return response;
}

function createDesktopHarness(options?: {
  flushLiveDeferredResumes?: () => Promise<void>;
  listMemoryDocs?: () => Array<Record<string, unknown>>;
  listTasksForCurrentProfile?: () => Array<Record<string, unknown>>;
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

  registerLiveSessionRoutes(router as never, {
    buildLiveSessionExtensionFactories: () => ['factory'],
    buildLiveSessionResourceOptions: () => ({ additionalExtensionPaths: ['extensions'] }),
    flushLiveDeferredResumes: options?.flushLiveDeferredResumes ?? (async () => {}),
    getCurrentProfile: () => 'assistant',
    getDefaultWebCwd: () => '/default-cwd',
    getRepoRoot: () => '/repo',
    listMemoryDocs: options?.listMemoryDocs ?? (() => []),
    listTasksForCurrentProfile: options?.listTasksForCurrentProfile ?? (() => []),
  });

  return {
    deleteHandler: (path: string) => deleteHandlers.get(path)!,
    getHandler: (path: string) => getHandlers.get(path)!,
    patchHandler: (path: string) => patchHandlers.get(path)!,
    postHandler: (path: string) => postHandlers.get(path)!,
  };
}

function createStatsHarness() {
  const getHandlers = new Map<string, Handler>();
  const router = {
    get: vi.fn((path: string, handler: Handler) => {
      getHandlers.set(path, handler);
    }),
  };

  registerLiveSessionStatsRoutes(router as never, {
    buildLiveSessionExtensionFactories: () => [],
    buildLiveSessionResourceOptions: () => ({}),
    flushLiveDeferredResumes: async () => {},
    getCurrentProfile: () => 'assistant',
    getDefaultWebCwd: () => '/default-cwd',
    getRepoRoot: () => '/repo',
    listMemoryDocs: () => [],
    listTasksForCurrentProfile: () => [],
  });

  return {
    getHandler: (path: string) => getHandlers.get(path)!,
  };
}

describe('live session routes', () => {
  beforeEach(() => {
    abortLocalSessionMock.mockReset();
    branchSessionMock.mockReset();
    compactSessionMock.mockReset();
    createLocalSessionMock.mockReset();
    prewarmLiveSessionLoaderMock.mockReset();
    createSessionListenerUnsubscribeMock.mockReset();
    destroySessionMock.mockReset();
    existsSyncMock.mockReset();
    exportSessionHtmlMock.mockReset();
    forkSessionMock.mockReset();
    getLiveSessionForkEntriesMock.mockReset();
    getLiveSessionsMock.mockReset();
    getSessionStatsMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    isLiveMock.mockReset();
    listPendingBackgroundRunResultsMock.mockReset();
    loadDaemonConfigMock.mockReset();
    logErrorMock.mockReset();
    logSlowConversationPerfMock.mockReset();
    logWarnMock.mockReset();
    markBackgroundRunResultsDeliveredMock.mockReset();
    parseTailBlocksQueryMock.mockReset();
    extractMentionIdsMock.mockReset();
    pickPromptReferencesInOrderMock.mockReset();
    queuePromptContextMock.mockReset();
    readGitStatusSummaryWithTelemetryMock.mockReset();
    readSessionBlocksMock.mockReset();
    readSessionMetaMock.mockReset();
    reloadSessionResourcesMock.mockReset();
    resolveConversationAttachmentPromptFilesMock.mockReset();
    resolveConversationCwdMock.mockReset();
    resolveDaemonPathsMock.mockReset();
    resolveDurableRunsRootMock.mockReset();
    resolveMentionedVaultFilesMock.mockReset();
    resolvePromptReferencesMock.mockReset();
    restoreQueuedMessageMock.mockReset();
    resumeLocalSessionMock.mockReset();
    setServerTimingHeadersMock.mockReset();
    submitLocalPromptSessionMock.mockReset();
    subscribeLocalMock.mockReset();
    summarizeAndForkSessionMock.mockReset();
    syncWebLiveConversationRunMock.mockReset();
    takeOverSessionControlMock.mockReset();
    buildReferencedMemoryDocsContextMock.mockReset();
    buildReferencedTasksContextMock.mockReset();
    buildReferencedVaultFilesContextMock.mockReset();
    expandPromptReferencesWithNodeGraphMock.mockReset();
    liveRegistry.clear();
    vi.useRealTimers();

    abortLocalSessionMock.mockResolvedValue(undefined);
    branchSessionMock.mockResolvedValue({ id: 'branch-1' });
    compactSessionMock.mockResolvedValue('compacted');
    createLocalSessionMock.mockResolvedValue({ id: 'live-new', sessionFile: '/sessions/live-new.jsonl' });
    prewarmLiveSessionLoaderMock.mockResolvedValue(undefined);
    existsSyncMock.mockReturnValue(true);
    exportSessionHtmlMock.mockResolvedValue('/tmp/export.html');
    forkSessionMock.mockResolvedValue({ id: 'fork-1' });
    getLiveSessionForkEntriesMock.mockReturnValue([{ id: 'fork-entry-1' }]);
    getLiveSessionsMock.mockReturnValue([{ id: 'live-1', cwd: '/repo/worktree', title: 'Live 1' }]);
    getSessionStatsMock.mockReturnValue({ totalMessages: 12 });
    isLiveMock.mockReturnValue(false);
    listPendingBackgroundRunResultsMock.mockReturnValue([]);
    loadDaemonConfigMock.mockReturnValue({ ipc: { socketPath: '/tmp/daemon.sock' } });
    markBackgroundRunResultsDeliveredMock.mockReturnValue([]);
    parseTailBlocksQueryMock.mockReturnValue(undefined);
    extractMentionIdsMock.mockReturnValue([]);
    pickPromptReferencesInOrderMock.mockImplementation((ids: string[], entries: Array<{ id?: string }>) => entries.filter((entry) => entry.id && ids.includes(entry.id)));
    readGitStatusSummaryWithTelemetryMock.mockReturnValue({
      summary: {
        branch: 'main',
        changeCount: 1,
        changes: [{ relativePath: 'src/index.ts', change: 'M' }],
        linesAdded: 5,
        linesDeleted: 2,
      },
      telemetry: {
        cache: 'hit',
        degraded: false,
        durationMs: 12,
      },
    });
    readSessionBlocksMock.mockReturnValue(null);
    readSessionMetaMock.mockReturnValue(null);
    resolveConversationAttachmentPromptFilesMock.mockReturnValue([]);
    resolveConversationCwdMock.mockReturnValue('/repo/worktree');
    resolveDaemonPathsMock.mockReturnValue({ root: '/daemon' });
    resolveDurableRunsRootMock.mockReturnValue('/daemon/runs');
    resolveMentionedVaultFilesMock.mockReturnValue([]);
    resolvePromptReferencesMock.mockReturnValue({ projectIds: [], taskIds: [], memoryDocIds: [], skillNames: [], profileIds: [] });
    restoreQueuedMessageMock.mockResolvedValue({ restoredIndex: 0 });
    resumeLocalSessionMock.mockResolvedValue({ id: 'live-resumed' });
    submitLocalPromptSessionMock.mockResolvedValue({ acceptedAs: 'started', completion: Promise.resolve() });
    subscribeLocalMock.mockImplementation(() => createSessionListenerUnsubscribeMock);
    summarizeAndForkSessionMock.mockResolvedValue({ id: 'summary-fork-1' });
    syncWebLiveConversationRunMock.mockResolvedValue(undefined);
    takeOverSessionControlMock.mockReturnValue({ ok: true, surfaceId: 'surface-1' });
    buildReferencedMemoryDocsContextMock.mockReturnValue('Memory docs context');
    buildReferencedTasksContextMock.mockReturnValue('Task context');
    buildReferencedVaultFilesContextMock.mockReturnValue('Vault files context');
    expandPromptReferencesWithNodeGraphMock.mockReturnValue({ projectIds: [], memoryDocIds: [], skillNames: [] });
  });

  it('skips reference catalog lookups for plain prompts without mentions', async () => {
    const listMemoryDocs = vi.fn(() => [{ id: 'note-1', title: 'Memory', path: '/notes/memory.md', summary: 'Summary' }]);
    const listTasksForCurrentProfile = vi.fn(() => [{ id: 'task-1', prompt: 'Run the tests', enabled: true, running: false }]);
    createDesktopHarness({ listMemoryDocs, listTasksForCurrentProfile });

    isLiveMock.mockReturnValue(true);
    submitLocalPromptSessionMock.mockResolvedValue({ acceptedAs: 'started', completion: Promise.resolve() });

    const promptRes = createResponse();
    await handleLiveSessionPrompt(createRequest({
      params: { id: 'live-plain' },
      body: { text: 'Please continue.' },
    }), promptRes);
    await Promise.resolve();

    expect(listTasksForCurrentProfile).not.toHaveBeenCalled();
    expect(listMemoryDocs).not.toHaveBeenCalled();
    expect(resolvePromptReferencesMock).not.toHaveBeenCalled();
    expect(expandPromptReferencesWithNodeGraphMock).not.toHaveBeenCalled();
    expect(resolveMentionedVaultFilesMock).not.toHaveBeenCalled();
    expect(queuePromptContextMock).not.toHaveBeenCalled();
    expect(promptRes.json).toHaveBeenCalledWith({
      accepted: true,
      delivery: 'started',
      ok: true,
      referencedAttachmentIds: [],
      referencedMemoryDocIds: [],
      referencedTaskIds: [],
      referencedVaultFileIds: [],
    });
  });

  it('handles prompt validation, hidden context injection, resumed sessions, and control conflicts', async () => {
    const flushLiveDeferredResumes = vi.fn(async () => {});
    createDesktopHarness({
      flushLiveDeferredResumes,
      listMemoryDocs: () => [{ id: 'note-1', title: 'Memory', path: '/notes/memory.md', summary: 'Summary' }],
      listTasksForCurrentProfile: () => [{ id: 'task-1', prompt: 'Run the tests', enabled: true, running: false }],
    });

    const emptyRes = createResponse();
    await handleLiveSessionPrompt(createRequest({ params: { id: 'live-1' }, body: {} }), emptyRes);
    expect(emptyRes.status).toHaveBeenCalledWith(400);
    expect(emptyRes.json).toHaveBeenCalledWith({ error: 'text, images, or attachmentRefs required' });

    resolveConversationAttachmentPromptFilesMock.mockImplementationOnce(() => {
      throw new Error('Attachment not found');
    });

    const badAttachmentRes = createResponse();
    await handleLiveSessionPrompt(createRequest({
      params: { id: 'live-1' },
      body: { text: 'hello', attachmentRefs: [{ attachmentId: 'att-1' }] },
    }), badAttachmentRes);
    expect(badAttachmentRes.status).toHaveBeenCalledWith(400);
    expect(badAttachmentRes.json).toHaveBeenCalledWith({ error: 'Attachment not found' });

    extractMentionIdsMock.mockReturnValue(['task-1', 'note-1', 'vault-1']);
    resolvePromptReferencesMock.mockReturnValue({ projectIds: [], taskIds: ['task-1'], memoryDocIds: ['note-1'], skillNames: [], profileIds: [] });
    expandPromptReferencesWithNodeGraphMock.mockReturnValue({ projectIds: [], memoryDocIds: ['note-1'], skillNames: [] });
    resolveMentionedVaultFilesMock.mockReturnValue([{ id: 'vault-1', title: 'Vault file' }]);
    resolveConversationAttachmentPromptFilesMock.mockReturnValue([
      {
        attachmentId: 'att-1',
        kind: 'excalidraw',
        previewMimeType: 'image/png',
        previewPath: '/tmp/preview.png',
        revision: 2,
        sourceMimeType: 'application/json',
        sourcePath: '/tmp/source.excalidraw',
        title: 'Diagram',
      },
    ]);
    listPendingBackgroundRunResultsMock.mockReturnValue([{ id: 'result-1', prompt: 'Background result.' }]);
    markBackgroundRunResultsDeliveredMock.mockReturnValue(['result-1']);
    readSessionBlocksMock.mockReturnValue({ meta: { file: '/sessions/stored.jsonl' } });
    liveRegistry.set('stored-session', {
      session: { sessionFile: '/sessions/stored.jsonl' },
    });
    resumeLocalSessionMock.mockImplementation(async () => {
      liveRegistry.set('live-resumed', {
        cwd: '/repo/resumed',
        session: { sessionFile: '/sessions/stored.jsonl' },
        title: 'Resumed conversation',
      });
      return { id: 'live-resumed' };
    });

    const promptRes = createResponse();
    await handleLiveSessionPrompt(createRequest({
      params: { id: 'stored-session' },
      body: {
        attachmentRefs: [{ attachmentId: 'att-1', revision: 2 }],
        behavior: 'followUp',
        surfaceId: 'surface-1',
        text: 'Please continue.',
      },
    }), promptRes);
    await Promise.resolve();
    await Promise.resolve();

    expect(flushLiveDeferredResumes).toHaveBeenCalled();
    expect(queuePromptContextMock).toHaveBeenCalledWith(
      'live-resumed',
      'referenced_context',
      expect.stringContaining('Background result.'),
    );
    expect(queuePromptContextMock).toHaveBeenCalledWith(
      'live-resumed',
      'referenced_context',
      expect.stringContaining('Referenced conversation attachments:'),
    );
    expect(syncWebLiveConversationRunMock).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'live-resumed',
      pendingOperation: expect.objectContaining({
        behavior: 'followUp',
        text: 'Please continue.',
      }),
      profile: 'assistant',
      state: 'running',
    }));
    expect(submitLocalPromptSessionMock).toHaveBeenCalledWith('live-resumed', 'Please continue.', 'followUp', undefined, 'surface-1');
    expect(markBackgroundRunResultsDeliveredMock).toHaveBeenCalledWith({
      resultIds: ['result-1'],
      runsRoot: '/daemon/runs',
      sessionFile: '/sessions/stored.jsonl',
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('runs');
    expect(promptRes.json).toHaveBeenCalledWith({
      accepted: true,
      delivery: 'started',
      ok: true,
      referencedAttachmentIds: ['att-1'],
      referencedMemoryDocIds: ['note-1'],
      referencedTaskIds: ['task-1'],
      referencedVaultFileIds: ['vault-1'],
    });

    isLiveMock.mockReturnValue(true);
    submitLocalPromptSessionMock.mockImplementationOnce(async () => {
      throw new LiveSessionControlErrorClass('Session busy');
    });
    const conflictRes = createResponse();
    await handleLiveSessionPrompt(createRequest({ params: { id: 'live-1' }, body: { text: 'Retry' } }), conflictRes);
    expect(conflictRes.status).toHaveBeenCalledWith(409);
    expect(conflictRes.json).toHaveBeenCalledWith({ error: 'Session busy' });
  });

  it('registers desktop live-session routes for listing, creation, resume, SSE, and takeover flows', async () => {
    vi.useFakeTimers();
    const flushLiveDeferredResumes = vi.fn(async () => {});
    const { getHandler, postHandler } = createDesktopHarness({ flushLiveDeferredResumes });

    const listRes = createResponse();
    getHandler('/api/live-sessions')(createRequest(), listRes);
    expect(listRes.json).toHaveBeenCalledWith([{ id: 'live-1', cwd: '/repo/worktree', title: 'Live 1' }]);

    const missingRes = createResponse();
    getHandler('/api/live-sessions/:id')(createRequest({ params: { id: 'missing' } }), missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ live: false });

    isLiveMock.mockReturnValue(true);
    const detailRes = createResponse();
    getHandler('/api/live-sessions/:id')(createRequest({ params: { id: 'live-1' } }), detailRes);
    expect(detailRes.json).toHaveBeenCalledWith({ live: true, id: 'live-1', cwd: '/repo/worktree', title: 'Live 1' });

    liveRegistry.set('live-new', {
      cwd: '/repo/worktree',
      title: '',
      session: {
        isStreaming: false,
        model: { id: 'gpt-4o' },
      },
      pendingHiddenTurnCustomTypes: [],
      activeHiddenTurnCustomType: null,
    });

    const createRes = createResponse();
    await postHandler('/api/live-sessions')(createRequest({
      body: { cwd: '/explicit', model: 'gpt-4o', thinkingLevel: 'high' },
    }), createRes);
    expect(resolveConversationCwdMock).toHaveBeenCalledWith({
      defaultCwd: '/default-cwd',
      explicitCwd: '/explicit',
      profile: 'assistant',
      repoRoot: '/repo',
    });
    expect(createLocalSessionMock).toHaveBeenCalledWith('/repo/worktree', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
      initialModel: 'gpt-4o',
      initialThinkingLevel: 'high',
    });
    expect(createRes.json).toHaveBeenCalledWith({
      id: 'live-new',
      sessionFile: '/sessions/live-new.jsonl',
      bootstrap: {
        conversationId: 'live-new',
        sessionDetail: {
          meta: expect.objectContaining({
            id: 'live-new',
            file: '/sessions/live-new.jsonl',
            cwd: '/repo/worktree',
            cwdSlug: '-repo-worktree',
            model: 'gpt-4o',
            title: 'New Conversation',
            messageCount: 0,
            isRunning: false,
            isLive: true,
          }),
          blocks: [],
          blockOffset: 0,
          totalBlocks: 0,
          contextUsage: null,
        },
        sessionDetailSignature: null,
        liveSession: {
          live: true,
          id: 'live-new',
          cwd: '/repo/worktree',
          sessionFile: '/sessions/live-new.jsonl',
          title: 'New Conversation',
          isStreaming: false,
        },
      },
    });

    expect(prewarmLiveSessionLoaderMock).toHaveBeenCalledWith('/repo/worktree', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
    });

    const invalidResumeRes = createResponse();
    await postHandler('/api/live-sessions/resume')(createRequest({ body: {} }), invalidResumeRes);
    expect(invalidResumeRes.status).toHaveBeenCalledWith(400);
    expect(invalidResumeRes.json).toHaveBeenCalledWith({ error: 'sessionFile required' });

    const resumeRes = createResponse();
    await postHandler('/api/live-sessions/resume')(createRequest({ body: { sessionFile: '/sessions/stored.jsonl' } }), resumeRes);
    expect(resumeLocalSessionMock).toHaveBeenCalledWith('/sessions/stored.jsonl', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
    });
    expect(flushLiveDeferredResumes).toHaveBeenCalled();
    expect(resumeRes.json).toHaveBeenCalledWith({ id: 'live-resumed' });

    let sseListener: ((event: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    subscribeLocalMock.mockImplementationOnce((_id: string, listener: (event: unknown) => void) => {
      sseListener = listener;
      return unsubscribe;
    });
    parseTailBlocksQueryMock.mockReturnValue(5);

    const eventsReq = createRequest({
      params: { id: 'live-1' },
      query: { surfaceId: 'surface-1', surfaceType: 'mobile_web', tailBlocks: '5' },
    });
    const eventsRes = createResponse();
    getHandler('/api/live-sessions/:id/events')(eventsReq, eventsRes);
    expect(eventsRes.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(eventsRes.flushHeaders).toHaveBeenCalled();
    expect(subscribeLocalMock).toHaveBeenCalledWith('live-1', expect.any(Function), {
      surface: { surfaceId: 'surface-1', surfaceType: 'mobile_web' },
      tailBlocks: 5,
    });

    sseListener?.({ type: 'delta', text: 'hello' });
    expect(eventsRes.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'delta', text: 'hello' })}\n\n`);
    vi.advanceTimersByTime(15_000);
    expect(eventsRes.write).toHaveBeenCalledWith(': heartbeat\n\n');
    eventsReq.emit('close');
    expect(unsubscribe).toHaveBeenCalled();

    getLiveSessionForkEntriesMock.mockReturnValueOnce(null);
    const missingForkEntriesRes = createResponse();
    getHandler('/api/live-sessions/:id/fork-entries')(createRequest({ params: { id: 'missing' } }), missingForkEntriesRes);
    expect(missingForkEntriesRes.status).toHaveBeenCalledWith(404);
    expect(missingForkEntriesRes.json).toHaveBeenCalledWith({ error: 'Session not live' });

    const forkEntriesRes = createResponse();
    getHandler('/api/live-sessions/:id/fork-entries')(createRequest({ params: { id: 'live-1' } }), forkEntriesRes);
    expect(forkEntriesRes.json).toHaveBeenCalledWith([{ id: 'fork-entry-1' }]);

    const missingSurfaceRes = createResponse();
    postHandler('/api/live-sessions/:id/takeover')(createRequest({ params: { id: 'live-1' }, body: {} }), missingSurfaceRes);
    expect(missingSurfaceRes.status).toHaveBeenCalledWith(400);
    expect(missingSurfaceRes.json).toHaveBeenCalledWith({ error: 'surfaceId is required' });

    isLiveMock.mockReturnValue(false);
    const notLocalRes = createResponse();
    postHandler('/api/live-sessions/:id/takeover')(createRequest({ params: { id: 'remote-1' }, body: { surfaceId: 'surface-1' } }), notLocalRes);
    expect(notLocalRes.status).toHaveBeenCalledWith(400);
    expect(notLocalRes.json).toHaveBeenCalledWith({ error: 'Takeover is only available for local live conversations right now.' });

    isLiveMock.mockReturnValue(true);
    const takeoverRes = createResponse();
    postHandler('/api/live-sessions/:id/takeover')(createRequest({ params: { id: 'live-1' }, body: { surfaceId: ' surface-1 ' } }), takeoverRes);
    expect(takeOverSessionControlMock).toHaveBeenCalledWith('live-1', 'surface-1');
    expect(takeoverRes.json).toHaveBeenCalledWith({ ok: true, surfaceId: 'surface-1' });

    takeOverSessionControlMock.mockImplementationOnce(() => {
      throw new LiveSessionControlErrorClass('Already controlled elsewhere');
    });
    const conflictRes = createResponse();
    postHandler('/api/live-sessions/:id/takeover')(createRequest({ params: { id: 'live-1' }, body: { surfaceId: 'surface-2' } }), conflictRes);
    expect(conflictRes.status).toHaveBeenCalledWith(409);
    expect(conflictRes.json).toHaveBeenCalledWith({ error: 'Already controlled elsewhere' });
  });

  it('registers desktop action routes for dequeue, conversation actions, context lookup, and deletion', async () => {
    const { deleteHandler, getHandler, postHandler } = createDesktopHarness();
    liveRegistry.set('live-1', {
      cwd: '/repo/worktree',
      session: { sessionFile: '/sessions/live-1.jsonl' },
      title: 'Live title',
    });

    const badBehaviorRes = createResponse();
    await postHandler('/api/live-sessions/:id/dequeue')(createRequest({
      params: { id: 'live-1' },
      body: { behavior: 'invalid', index: 0 },
    }), badBehaviorRes);
    expect(badBehaviorRes.status).toHaveBeenCalledWith(400);
    expect(badBehaviorRes.json).toHaveBeenCalledWith({ error: 'behavior must be "steer" or "followUp"' });

    const badIndexRes = createResponse();
    await postHandler('/api/live-sessions/:id/dequeue')(createRequest({
      params: { id: 'live-1' },
      body: { behavior: 'steer', index: -1 },
    }), badIndexRes);
    expect(badIndexRes.status).toHaveBeenCalledWith(400);
    expect(badIndexRes.json).toHaveBeenCalledWith({ error: 'index must be a non-negative integer' });

    const dequeueRes = createResponse();
    await postHandler('/api/live-sessions/:id/dequeue')(createRequest({
      params: { id: 'live-1' },
      body: { behavior: 'followUp', index: 0, previewId: 'preview-1', surfaceId: 'surface-1' },
    }), dequeueRes);
    expect(restoreQueuedMessageMock).toHaveBeenCalledWith('live-1', 'followUp', 0, 'preview-1');
    expect(dequeueRes.json).toHaveBeenCalledWith({ ok: true, restoredIndex: 0 });

    restoreQueuedMessageMock.mockRejectedValueOnce(new Error('Queued prompt restore is unavailable'));
    const dequeueConflictRes = createResponse();
    await postHandler('/api/live-sessions/:id/dequeue')(createRequest({
      params: { id: 'live-1' },
      body: { behavior: 'steer', index: 1 },
    }), dequeueConflictRes);
    expect(dequeueConflictRes.status).toHaveBeenCalledWith(409);
    expect(dequeueConflictRes.json).toHaveBeenCalledWith({ error: 'Queued prompt restore is unavailable' });

    const compactRes = createResponse();
    await postHandler('/api/live-sessions/:id/compact')(createRequest({
      params: { id: 'live-1' },
      body: { customInstructions: '  Keep this short.  ', surfaceId: 'surface-1' },
    }), compactRes);
    expect(compactSessionMock).toHaveBeenCalledWith('live-1', 'Keep this short.');
    expect(compactRes.json).toHaveBeenCalledWith({ ok: true, result: 'compacted' });

    const reloadRes = createResponse();
    await postHandler('/api/live-sessions/:id/reload')(createRequest({ params: { id: 'live-1' }, body: { surfaceId: 'surface-1' } }), reloadRes);
    expect(reloadSessionResourcesMock).toHaveBeenCalledWith('live-1');
    expect(reloadRes.json).toHaveBeenCalledWith({ ok: true });

    const exportRes = createResponse();
    await postHandler('/api/live-sessions/:id/export')(createRequest({ params: { id: 'live-1' }, body: { outputPath: ' /tmp/export.html ' } }), exportRes);
    expect(exportSessionHtmlMock).toHaveBeenCalledWith('live-1', '/tmp/export.html');
    expect(exportRes.json).toHaveBeenCalledWith({ ok: true, path: '/tmp/export.html' });

    const abortRes = createResponse();
    await postHandler('/api/live-sessions/:id/abort')(createRequest({ params: { id: 'live-1' }, body: { surfaceId: 'surface-1' } }), abortRes);
    expect(abortLocalSessionMock).toHaveBeenCalledWith('live-1');
    expect(abortRes.json).toHaveBeenCalledWith({ ok: true });

    const missingContextRes = createResponse();
    liveRegistry.clear();
    getHandler('/api/live-sessions/:id/context')(createRequest({ params: { id: 'missing' } }), missingContextRes);
    expect(missingContextRes.status).toHaveBeenCalledWith(404);
    expect(missingContextRes.json).toHaveBeenCalledWith({ error: 'Session not found' });

    liveRegistry.set('live-1', {
      cwd: '/repo/worktree',
      session: { sessionFile: '/sessions/live-1.jsonl' },
      title: 'Live title',
    });
    const contextRes = createResponse();
    getHandler('/api/live-sessions/:id/context')(createRequest({ params: { id: 'live-1' } }), contextRes);
    expect(setServerTimingHeadersMock).toHaveBeenCalledWith(contextRes, expect.arrayContaining([
      expect.objectContaining({ description: 'hit' }),
      expect.objectContaining({ name: 'total' }),
    ]), expect.objectContaining({ route: 'live-session-context' }));
    expect(logSlowConversationPerfMock).toHaveBeenCalledWith('live session context request', expect.objectContaining({ conversationId: 'live-1' }));
    expect(contextRes.json).toHaveBeenCalledWith({
      branch: 'main',
      cwd: '/repo/worktree',
      git: {
        changeCount: 1,
        changes: [{ relativePath: 'src/index.ts', change: 'M' }],
        linesAdded: 5,
        linesDeleted: 2,
      },
    });

    const summarizeRes = createResponse();
    await postHandler('/api/live-sessions/:id/summarize-fork')(createRequest({ params: { id: 'live-1' }, body: { surfaceId: 'surface-1' } }), summarizeRes);
    expect(summarizeAndForkSessionMock).toHaveBeenCalledWith('live-1', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
    });
    expect(summarizeRes.json).toHaveBeenCalledWith({ id: 'summary-fork-1' });

    const missingEntryIdRes = createResponse();
    await postHandler('/api/live-sessions/:id/branch')(createRequest({ params: { id: 'live-1' }, body: {} }), missingEntryIdRes);
    expect(missingEntryIdRes.status).toHaveBeenCalledWith(400);
    expect(missingEntryIdRes.json).toHaveBeenCalledWith({ error: 'entryId required' });

    const branchRes = createResponse();
    await postHandler('/api/live-sessions/:id/branch')(createRequest({
      params: { id: 'live-1' },
      body: { entryId: 'entry-1', surfaceId: 'surface-1' },
    }), branchRes);
    expect(branchSessionMock).toHaveBeenCalledWith('live-1', 'entry-1', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
    });
    expect(branchRes.json).toHaveBeenCalledWith({ id: 'branch-1' });

    const forkRes = createResponse();
    await postHandler('/api/live-sessions/:id/fork')(createRequest({
      params: { id: 'live-1' },
      body: { entryId: 'entry-2', preserveSource: true, surfaceId: 'surface-1' },
    }), forkRes);
    expect(forkSessionMock).toHaveBeenCalledWith('live-1', 'entry-2', {
      additionalExtensionPaths: ['extensions'],
      extensionFactories: ['factory'],
      preserveSource: true,
    });
    expect(forkRes.json).toHaveBeenCalledWith({ id: 'fork-1' });

    const deleteRes = createResponse();
    await deleteHandler('/api/live-sessions/:id')(createRequest({ params: { id: 'live-1' }, body: { surfaceId: 'surface-1' } }), deleteRes);
    expect(destroySessionMock).toHaveBeenCalledWith('live-1');
    expect(deleteRes.json).toHaveBeenCalledWith({ ok: true });
  });

  it('registers stats routes and maps live-session control errors through the exported helper', () => {
    const { getHandler } = createStatsHarness();

    const statsRes = createResponse();
    getHandler('/api/live-sessions/:id/stats')(createRequest({ params: { id: 'live-1' } }), statsRes);
    expect(statsRes.json).toHaveBeenCalledWith({ totalMessages: 12 });

    getSessionStatsMock.mockReturnValueOnce(null);
    const missingStatsRes = createResponse();
    getHandler('/api/live-sessions/:id/stats')(createRequest({ params: { id: 'missing' } }), missingStatsRes);
    expect(missingStatsRes.status).toHaveBeenCalledWith(404);
    expect(missingStatsRes.json).toHaveBeenCalledWith({ error: 'Not found' });

    getSessionStatsMock.mockImplementationOnce(() => {
      throw new Error('stats exploded');
    });
    const statsErrorRes = createResponse();
    getHandler('/api/live-sessions/:id/stats')(createRequest({ params: { id: 'live-1' } }), statsErrorRes);
    expect(statsErrorRes.status).toHaveBeenCalledWith(500);
    expect(statsErrorRes.json).toHaveBeenCalledWith({ error: 'Error: stats exploded' });

    const errorRes = createResponse();
    expect(writeLiveConversationControlError(errorRes as never, new LiveSessionControlErrorClass('Busy'))).toBe(true);
    expect(errorRes.status).toHaveBeenCalledWith(409);
    expect(errorRes.json).toHaveBeenCalledWith({ error: 'Busy' });
  });
});
