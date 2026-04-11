import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createLocalSessionMock,
  findActivityRecordMock,
  invalidateAppTopicsMock,
  logErrorMock,
  persistSettingsWriteMock,
  queuePromptContextMock,
  readSavedWebUiPreferencesMock,
  readWebUiStateMock,
  resolveConversationCwdMock,
  setActivityConversationLinksMock,
  syncConfiguredWebUiTailscaleServeMock,
  writeSavedWebUiPreferencesMock,
  writeWebUiConfigMock,
} = vi.hoisted(() => ({
  createLocalSessionMock: vi.fn(),
  findActivityRecordMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  logErrorMock: vi.fn(),
  persistSettingsWriteMock: vi.fn(),
  queuePromptContextMock: vi.fn(),
  readSavedWebUiPreferencesMock: vi.fn(),
  readWebUiStateMock: vi.fn(),
  resolveConversationCwdMock: vi.fn(),
  setActivityConversationLinksMock: vi.fn(),
  syncConfiguredWebUiTailscaleServeMock: vi.fn(),
  writeSavedWebUiPreferencesMock: vi.fn(),
  writeWebUiConfigMock: vi.fn(),
}));

vi.mock('../ui/webUi.js', () => ({
  readWebUiState: readWebUiStateMock,
  syncConfiguredWebUiTailscaleServe: syncConfiguredWebUiTailscaleServeMock,
  writeWebUiConfig: writeWebUiConfigMock,
}));

vi.mock('../ui/webUiPreferences.js', () => ({
  readSavedWebUiPreferences: readSavedWebUiPreferencesMock,
  writeSavedWebUiPreferences: writeSavedWebUiPreferencesMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

vi.mock('../ui/settingsPersistence.js', () => ({
  persistSettingsWrite: persistSettingsWriteMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

vi.mock('../conversations/conversationCwd.js', () => ({
  resolveConversationCwd: resolveConversationCwdMock,
}));

vi.mock('../conversations/liveSessions.js', () => ({
  createSession: createLocalSessionMock,
  queuePromptContext: queuePromptContextMock,
}));

vi.mock('../automation/inboxService.js', () => ({
  findActivityRecord: findActivityRecordMock,
}));

vi.mock('@personal-agent/core', () => ({
  setActivityConversationLinks: setActivityConversationLinksMock,
}));

import { registerWebUiRoutes } from './webUi.js';

type Handler = (req: unknown, res: unknown) => Promise<void> | void;

function createResponse() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
}

function createDesktopHarness(options?: {
  getCurrentProfile?: () => string;
  getRepoRoot?: () => string;
  getSettingsFile?: () => string;
  getDefaultWebCwd?: () => string;
  buildLiveSessionResourceOptions?: () => Record<string, unknown>;
  buildLiveSessionExtensionFactories?: () => unknown[];
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

  registerWebUiRoutes(router as never, {
    getCurrentProfile: options?.getCurrentProfile ?? (() => 'assistant'),
    getRepoRoot: options?.getRepoRoot ?? (() => '/repo'),
    getSettingsFile: options?.getSettingsFile ?? (() => '/runtime/settings.json'),
    getDefaultWebCwd: options?.getDefaultWebCwd ?? (() => '/default-cwd'),
    buildLiveSessionResourceOptions: options?.buildLiveSessionResourceOptions ?? (() => ({ additionalExtensionPaths: ['extensions'] })),
    buildLiveSessionExtensionFactories: options?.buildLiveSessionExtensionFactories ?? (() => ['factory']),
  });

  return {
    getHandler: (path: string) => getHandlers.get(path)!,
    patchHandler: (path: string) => patchHandlers.get(path)!,
    postHandler: (path: string) => postHandlers.get(path)!,
  };
}

describe('web UI routes', () => {
  beforeEach(() => {
    createLocalSessionMock.mockReset();
    findActivityRecordMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    logErrorMock.mockReset();
    persistSettingsWriteMock.mockReset();
    queuePromptContextMock.mockReset();
    readSavedWebUiPreferencesMock.mockReset();
    readWebUiStateMock.mockReset();
    resolveConversationCwdMock.mockReset();
    setActivityConversationLinksMock.mockReset();
    syncConfiguredWebUiTailscaleServeMock.mockReset();
    writeSavedWebUiPreferencesMock.mockReset();
    writeWebUiConfigMock.mockReset();

    persistSettingsWriteMock.mockImplementation((write: (settingsFile: string) => unknown, options: { runtimeSettingsFile: string }) => write(options.runtimeSettingsFile));
    readSavedWebUiPreferencesMock.mockReturnValue({
      openConversationIds: ['conversation-1'],
      pinnedConversationIds: ['conversation-2'],
      archivedConversationIds: ['conversation-3'],
    });
    readWebUiStateMock.mockReturnValue({
      warnings: [],
      service: {
        running: true,
        url: 'http://127.0.0.1:3000',
        tailscaleServe: false,
        resumeFallbackPrompt: 'Resume the conversation.',
      },
      log: { lines: [] },
    });
    resolveConversationCwdMock.mockReturnValue('/repo/worktree');
    writeSavedWebUiPreferencesMock.mockReturnValue({
      openConversationIds: ['conversation-4'],
      pinnedConversationIds: ['conversation-5'],
      archivedConversationIds: ['conversation-6'],
    });
    writeWebUiConfigMock.mockReturnValue({
      useTailscaleServe: true,
      resumeFallbackPrompt: 'Resume later.',
    });
  });

  it('reads web UI state and logs handler failures', () => {
    const { getHandler } = createDesktopHarness();
    const handler = getHandler('/api/web-ui/state');

    const successRes = createResponse();
    handler({}, successRes);
    expect(successRes.json).toHaveBeenCalledWith({
      warnings: [],
      service: {
        running: true,
        url: 'http://127.0.0.1:3000',
        tailscaleServe: false,
        resumeFallbackPrompt: 'Resume the conversation.',
      },
      log: { lines: [] },
    });

    readWebUiStateMock.mockImplementationOnce(() => {
      throw new Error('state failed');
    });
    const failureRes = createResponse();
    handler({}, failureRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'state failed',
    }));
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'Error: state failed' });
  });

  it('reads and writes open conversation layout with validation and persistence', async () => {
    const desktop = createDesktopHarness({ getSettingsFile: () => '/runtime/desktop-settings.json' });
    const getHandler = desktop.getHandler('/api/web-ui/open-conversations');
    const patchHandler = desktop.patchHandler('/api/web-ui/open-conversations');

    const readRes = createResponse();
    getHandler({}, readRes);
    expect(readSavedWebUiPreferencesMock).toHaveBeenCalledWith('/runtime/desktop-settings.json');
    expect(readRes.json).toHaveBeenCalledWith({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-2'],
      archivedSessionIds: ['conversation-3'],
    });

    const invalidSessionIdsRes = createResponse();
    await patchHandler({ body: { sessionIds: 'bad' } }, invalidSessionIdsRes);
    expect(invalidSessionIdsRes.status).toHaveBeenCalledWith(400);
    expect(invalidSessionIdsRes.json).toHaveBeenCalledWith({ error: 'sessionIds must be an array when provided' });

    const missingBodyRes = createResponse();
    await patchHandler({ body: {} }, missingBodyRes);
    expect(missingBodyRes.status).toHaveBeenCalledWith(400);
    expect(missingBodyRes.json).toHaveBeenCalledWith({ error: 'sessionIds, pinnedSessionIds, or archived conversation ids required' });

    const successRes = createResponse();
    await patchHandler({
      body: {
        sessionIds: ['conversation-4'],
        pinnedSessionIds: ['conversation-5'],
        archivedSessionIds: ['conversation-6'],
      },
    }, successRes);
    expect(persistSettingsWriteMock).toHaveBeenCalledWith(expect.any(Function), {
      runtimeSettingsFile: '/runtime/desktop-settings.json',
    });
    expect(writeSavedWebUiPreferencesMock).toHaveBeenCalledWith({
      openConversationIds: ['conversation-4'],
      pinnedConversationIds: ['conversation-5'],
      archivedConversationIds: ['conversation-6'],
    }, '/runtime/desktop-settings.json');
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('sessions');
    expect(successRes.json).toHaveBeenCalledWith({
      ok: true,
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedConversationIds: ['conversation-6'],
    });

    persistSettingsWriteMock.mockImplementationOnce(() => {
      throw new Error('persist failed');
    });
    const failureRes = createResponse();
    await patchHandler({ body: { pinnedSessionIds: ['conversation-7'] } }, failureRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'persist failed',
    }));
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'Error: persist failed' });
  });

  it('validates and writes web UI config updates', () => {
    const { postHandler } = createDesktopHarness();
    const handler = postHandler('/api/web-ui/config');

    const missingRes = createResponse();
    handler({ body: {} }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(400);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Provide useTailscaleServe and/or resumeFallbackPrompt.' });

    const invalidTailscaleRes = createResponse();
    handler({ body: { useTailscaleServe: 'yes' } }, invalidTailscaleRes);
    expect(invalidTailscaleRes.status).toHaveBeenCalledWith(400);
    expect(invalidTailscaleRes.json).toHaveBeenCalledWith({ error: 'useTailscaleServe must be a boolean when provided.' });

    const invalidPromptRes = createResponse();
    handler({ body: { resumeFallbackPrompt: 123 } }, invalidPromptRes);
    expect(invalidPromptRes.status).toHaveBeenCalledWith(400);
    expect(invalidPromptRes.json).toHaveBeenCalledWith({ error: 'resumeFallbackPrompt must be a string when provided.' });

    const successRes = createResponse();
    handler({
      body: {
        useTailscaleServe: true,
        resumeFallbackPrompt: 'Resume later.',
      },
    }, successRes);
    expect(writeWebUiConfigMock).toHaveBeenCalledWith({
      useTailscaleServe: true,
      resumeFallbackPrompt: 'Resume later.',
    });
    expect(syncConfiguredWebUiTailscaleServeMock).toHaveBeenCalledWith(true);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('webUi');
    expect(successRes.json).toHaveBeenCalledWith({
      warnings: [],
      log: { lines: [] },
      service: {
        running: true,
        url: 'http://127.0.0.1:3000',
        tailscaleServe: true,
        resumeFallbackPrompt: 'Resume later.',
      },
    });

    writeWebUiConfigMock.mockImplementationOnce(() => {
      throw new Error('config write failed');
    });
    const failureRes = createResponse();
    handler({ body: { useTailscaleServe: false } }, failureRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'config write failed',
    }));
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'Error: config write failed' });
  });

  it('starts activity conversations, adds inbox context, and handles missing or failing lookups', async () => {
    const { postHandler } = createDesktopHarness({
      getCurrentProfile: () => 'assistant',
      getRepoRoot: () => '/repo',
      getDefaultWebCwd: () => '/default-cwd',
      buildLiveSessionResourceOptions: () => ({ additionalExtensionPaths: ['extensions'] }),
      buildLiveSessionExtensionFactories: () => ['factory'],
    });
    const handler = postHandler('/api/activity/:id/start');

    findActivityRecordMock.mockReturnValueOnce(null);
    const missingRes = createResponse();
    await handler({ params: { id: 'activity-missing' } }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Not found' });

    findActivityRecordMock.mockReturnValueOnce({
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
    createLocalSessionMock.mockResolvedValueOnce({ id: 'conversation-1', sessionFile: '/sessions/conversation-1.json' });
    const successRes = createResponse();
    await handler({ params: { id: 'activity-1' } }, successRes);
    expect(resolveConversationCwdMock).toHaveBeenCalledWith({
      repoRoot: '/repo',
      profile: 'assistant',
      defaultCwd: '/default-cwd',
    });
    expect(createLocalSessionMock).toHaveBeenCalledWith('/repo/worktree', {
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
      expect.stringContaining('Inbox activity context for this conversation:'),
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
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('activity', 'sessions');
    expect(successRes.json).toHaveBeenCalledWith({
      activityId: 'activity-1',
      id: 'conversation-1',
      sessionFile: '/sessions/conversation-1.json',
      cwd: '/repo/worktree',
      relatedConversationIds: ['conversation-0', 'conversation-1'],
    });

    findActivityRecordMock.mockImplementationOnce(() => {
      throw new Error('activity failed');
    });
    const failureRes = createResponse();
    await handler({ params: { id: 'activity-1' } }, failureRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'activity failed',
    }));
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'Error: activity failed' });
  });
});
