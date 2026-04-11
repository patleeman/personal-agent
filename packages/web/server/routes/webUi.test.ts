import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  invalidateAppTopicsMock,
  logErrorMock,
  persistSettingsWriteMock,
  readSavedWebUiPreferencesMock,
  readWebUiStateMock,
  syncConfiguredWebUiTailscaleServeMock,
  writeSavedWebUiPreferencesMock,
  writeWebUiConfigMock,
} = vi.hoisted(() => ({
  invalidateAppTopicsMock: vi.fn(),
  logErrorMock: vi.fn(),
  persistSettingsWriteMock: vi.fn(),
  readSavedWebUiPreferencesMock: vi.fn(),
  readWebUiStateMock: vi.fn(),
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

import { registerWebUiRoutes } from './webUi.js';

type Handler = (req: unknown, res: unknown) => Promise<void> | void;

function createResponse() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
}

function createDesktopHarness(options?: {
  getSettingsFile?: () => string;
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
    getSettingsFile: options?.getSettingsFile ?? (() => '/runtime/settings.json'),
  });

  return {
    getHandler: (path: string) => getHandlers.get(path)!,
    patchHandler: (path: string) => patchHandlers.get(path)!,
    postHandler: (path: string) => postHandlers.get(path)!,
  };
}

describe('web UI routes', () => {
  beforeEach(() => {
    invalidateAppTopicsMock.mockReset();
    logErrorMock.mockReset();
    persistSettingsWriteMock.mockReset();
    readSavedWebUiPreferencesMock.mockReset();
    readWebUiStateMock.mockReset();
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

});
