import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createLocalSessionMock,
  findActivityRecordMock,
  installWebUiServiceAndReadStateMock,
  invalidateAppTopicsMock,
  logErrorMock,
  persistSettingsWriteMock,
  queuePromptContextMock,
  readSavedWebUiPreferencesMock,
  readWebUiStateMock,
  requestWebUiServiceRestartMock,
  resolveConversationCwdMock,
  setActivityConversationLinksMock,
  startWebUiServiceAndReadStateMock,
  stopWebUiServiceAndReadStateMock,
  syncConfiguredWebUiTailscaleServeMock,
  uninstallWebUiServiceAndReadStateMock,
  writeSavedWebUiPreferencesMock,
  writeWebUiConfigMock,
} = vi.hoisted(() => ({
  createLocalSessionMock: vi.fn(),
  findActivityRecordMock: vi.fn(),
  installWebUiServiceAndReadStateMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  logErrorMock: vi.fn(),
  persistSettingsWriteMock: vi.fn(),
  queuePromptContextMock: vi.fn(),
  readSavedWebUiPreferencesMock: vi.fn(),
  readWebUiStateMock: vi.fn(),
  requestWebUiServiceRestartMock: vi.fn(),
  resolveConversationCwdMock: vi.fn(),
  setActivityConversationLinksMock: vi.fn(),
  startWebUiServiceAndReadStateMock: vi.fn(),
  stopWebUiServiceAndReadStateMock: vi.fn(),
  syncConfiguredWebUiTailscaleServeMock: vi.fn(),
  uninstallWebUiServiceAndReadStateMock: vi.fn(),
  writeSavedWebUiPreferencesMock: vi.fn(),
  writeWebUiConfigMock: vi.fn(),
}));

vi.mock('../ui/applicationRestart.js', () => ({
  requestWebUiServiceRestart: requestWebUiServiceRestartMock,
}));

vi.mock('../ui/webUi.js', () => ({
  installWebUiServiceAndReadState: installWebUiServiceAndReadStateMock,
  readWebUiState: readWebUiStateMock,
  startWebUiServiceAndReadState: startWebUiServiceAndReadStateMock,
  stopWebUiServiceAndReadState: stopWebUiServiceAndReadStateMock,
  syncConfiguredWebUiTailscaleServe: syncConfiguredWebUiTailscaleServeMock,
  uninstallWebUiServiceAndReadState: uninstallWebUiServiceAndReadStateMock,
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

import { registerCompanionWebUiRoutes, registerWebUiRoutes } from './webUi.js';

type Handler = (req: any, res: any) => Promise<void> | void;

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

function createCompanionHarness(options?: {
  getCurrentProfile?: () => string;
  getRepoRoot?: () => string;
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

  registerCompanionWebUiRoutes(router as never, {
    getCurrentProfile: options?.getCurrentProfile ?? (() => 'assistant'),
    getRepoRoot: options?.getRepoRoot ?? (() => '/repo'),
    getSettingsFile: () => '/runtime/settings.json',
    getDefaultWebCwd: () => '/default-cwd',
    buildLiveSessionResourceOptions: () => ({ additionalExtensionPaths: [] }),
    buildLiveSessionExtensionFactories: () => [],
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
    installWebUiServiceAndReadStateMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    logErrorMock.mockReset();
    persistSettingsWriteMock.mockReset();
    queuePromptContextMock.mockReset();
    readSavedWebUiPreferencesMock.mockReset();
    readWebUiStateMock.mockReset();
    requestWebUiServiceRestartMock.mockReset();
    resolveConversationCwdMock.mockReset();
    setActivityConversationLinksMock.mockReset();
    startWebUiServiceAndReadStateMock.mockReset();
    stopWebUiServiceAndReadStateMock.mockReset();
    syncConfiguredWebUiTailscaleServeMock.mockReset();
    uninstallWebUiServiceAndReadStateMock.mockReset();
    writeSavedWebUiPreferencesMock.mockReset();
    writeWebUiConfigMock.mockReset();

    installWebUiServiceAndReadStateMock.mockReturnValue({ service: { status: 'installed' } });
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
        companionPort: 4242,
        companionUrl: 'http://127.0.0.1:4242',
        tailscaleServe: false,
        resumeFallbackPrompt: 'Resume the conversation.',
      },
      log: { lines: [] },
    });
    requestWebUiServiceRestartMock.mockReturnValue({ ok: true, action: 'restart' });
    resolveConversationCwdMock.mockReturnValue('/repo/worktree');
    startWebUiServiceAndReadStateMock.mockReturnValue({ service: { status: 'running' } });
    stopWebUiServiceAndReadStateMock.mockReturnValue({ service: { status: 'stopped' } });
    uninstallWebUiServiceAndReadStateMock.mockReturnValue({ service: { status: 'uninstalled' } });
    writeSavedWebUiPreferencesMock.mockReturnValue({
      openConversationIds: ['conversation-4'],
      pinnedConversationIds: ['conversation-5'],
      archivedConversationIds: ['conversation-6'],
    });
    writeWebUiConfigMock.mockReturnValue({
      companionPort: 4242,
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
        companionPort: 4242,
        companionUrl: 'http://127.0.0.1:4242',
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

  it('installs, starts, stops, and uninstalls the managed web UI service', () => {
    const { postHandler } = createDesktopHarness();

    const installRes = createResponse();
    postHandler('/api/web-ui/service/install')({}, installRes);
    expect(installWebUiServiceAndReadStateMock).toHaveBeenCalledTimes(1);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('webUi');
    expect(installRes.json).toHaveBeenCalledWith({ service: { status: 'installed' } });

    const startRes = createResponse();
    postHandler('/api/web-ui/service/start')({}, startRes);
    expect(startWebUiServiceAndReadStateMock).toHaveBeenCalledTimes(1);
    expect(startRes.json).toHaveBeenCalledWith({ service: { status: 'running' } });

    const stopRes = createResponse();
    postHandler('/api/web-ui/service/stop')({}, stopRes);
    expect(stopWebUiServiceAndReadStateMock).toHaveBeenCalledTimes(1);
    expect(stopRes.json).toHaveBeenCalledWith({ service: { status: 'stopped' } });

    const uninstallRes = createResponse();
    postHandler('/api/web-ui/service/uninstall')({}, uninstallRes);
    expect(uninstallWebUiServiceAndReadStateMock).toHaveBeenCalledTimes(1);
    expect(uninstallRes.json).toHaveBeenCalledWith({ service: { status: 'uninstalled' } });
  });

  it('maps desktop-runtime lifecycle rejections to bad requests', () => {
    const { postHandler } = createDesktopHarness();
    installWebUiServiceAndReadStateMock.mockImplementationOnce(() => {
      throw new Error('Managed web UI service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local UI surface.');
    });
    startWebUiServiceAndReadStateMock.mockImplementationOnce(() => {
      throw new Error('Managed web UI service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local UI surface.');
    });
    stopWebUiServiceAndReadStateMock.mockImplementationOnce(() => {
      throw new Error('Managed web UI service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local UI surface.');
    });
    uninstallWebUiServiceAndReadStateMock.mockImplementationOnce(() => {
      throw new Error('Managed web UI service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local UI surface.');
    });

    const installRes = createResponse();
    postHandler('/api/web-ui/service/install')({}, installRes);
    expect(installRes.status).toHaveBeenCalledWith(400);
    expect(installRes.json).toHaveBeenCalledWith({ error: 'Managed web UI service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local UI surface.' });

    const startRes = createResponse();
    postHandler('/api/web-ui/service/start')({}, startRes);
    expect(startRes.status).toHaveBeenCalledWith(400);
    expect(startRes.json).toHaveBeenCalledWith({ error: 'Managed web UI service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local UI surface.' });

    const stopRes = createResponse();
    postHandler('/api/web-ui/service/stop')({}, stopRes);
    expect(stopRes.status).toHaveBeenCalledWith(400);
    expect(stopRes.json).toHaveBeenCalledWith({ error: 'Managed web UI service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local UI surface.' });

    const uninstallRes = createResponse();
    postHandler('/api/web-ui/service/uninstall')({}, uninstallRes);
    expect(uninstallRes.status).toHaveBeenCalledWith(400);
    expect(uninstallRes.json).toHaveBeenCalledWith({ error: 'Managed web UI service lifecycle is unavailable in desktop runtime. The packaged desktop shell owns the local UI surface.' });
  });

  it('maps restart responses for desktop and companion routes', () => {
    const desktop = createDesktopHarness({ getRepoRoot: () => '/desktop-repo' });

    const desktopRes = createResponse();
    desktop.postHandler('/api/web-ui/service/restart')({}, desktopRes);
    expect(requestWebUiServiceRestartMock).toHaveBeenCalledWith({ repoRoot: '/desktop-repo' });
    expect(desktopRes.status).toHaveBeenCalledWith(202);
    expect(desktopRes.json).toHaveBeenCalledWith({ ok: true, action: 'restart' });

    const companion = createCompanionHarness({ getRepoRoot: () => '/companion-repo' });
    requestWebUiServiceRestartMock.mockImplementationOnce(() => {
      throw new Error('Managed web UI restart already in progress');
    });
    const conflictRes = createResponse();
    companion.postHandler('/api/web-ui/service/restart')({}, conflictRes);
    expect(conflictRes.status).toHaveBeenCalledWith(409);
    expect(conflictRes.json).toHaveBeenCalledWith({ error: 'Managed web UI restart already in progress' });

    const failingDesktop = createDesktopHarness({ getRepoRoot: () => '/desktop-repo' });
    requestWebUiServiceRestartMock.mockImplementationOnce(() => {
      throw new Error('Managed web UI service is not installed');
    });
    const missingServiceRes = createResponse();
    failingDesktop.postHandler('/api/web-ui/service/restart')({}, missingServiceRes);
    expect(missingServiceRes.status).toHaveBeenCalledWith(400);
    expect(missingServiceRes.json).toHaveBeenCalledWith({ error: 'Managed web UI service is not installed' });

    const unavailableDesktop = createDesktopHarness({ getRepoRoot: () => '/desktop-repo' });
    requestWebUiServiceRestartMock.mockImplementationOnce(() => {
      throw new Error('Managed web UI restart is unavailable in desktop runtime. The packaged desktop shell owns the local UI surface.');
    });
    const unavailableRes = createResponse();
    unavailableDesktop.postHandler('/api/web-ui/service/restart')({}, unavailableRes);
    expect(unavailableRes.status).toHaveBeenCalledWith(400);
    expect(unavailableRes.json).toHaveBeenCalledWith({ error: 'Managed web UI restart is unavailable in desktop runtime. The packaged desktop shell owns the local UI surface.' });

    const failingDesktopAgain = createDesktopHarness({ getRepoRoot: () => '/desktop-repo' });
    requestWebUiServiceRestartMock.mockImplementationOnce(() => {
      throw new Error('restart failed');
    });
    const failureRes = createResponse();
    failingDesktopAgain.postHandler('/api/web-ui/service/restart')({}, failureRes);
    expect(failureRes.status).toHaveBeenCalledWith(500);
    expect(failureRes.json).toHaveBeenCalledWith({ error: 'restart failed' });
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
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Provide companionPort, useTailscaleServe, and/or resumeFallbackPrompt.' });

    const invalidPortRes = createResponse();
    handler({ body: { companionPort: 70000 } }, invalidPortRes);
    expect(invalidPortRes.status).toHaveBeenCalledWith(400);
    expect(invalidPortRes.json).toHaveBeenCalledWith({ error: 'companionPort must be a valid port when provided.' });

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
        companionPort: 4242,
        useTailscaleServe: true,
        resumeFallbackPrompt: 'Resume later.',
      },
    }, successRes);
    expect(writeWebUiConfigMock).toHaveBeenCalledWith({
      companionPort: 4242,
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
        companionPort: 4242,
        companionUrl: 'http://127.0.0.1:4242',
        tailscaleServe: true,
        resumeFallbackPrompt: 'Resume later.',
      },
    });

    writeWebUiConfigMock.mockImplementationOnce(() => {
      throw new Error('config write failed');
    });
    const failureRes = createResponse();
    handler({ body: { companionPort: 3001 } }, failureRes);
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
