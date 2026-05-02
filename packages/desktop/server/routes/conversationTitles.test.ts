import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  logErrorMock,
  persistSettingsWriteMock,
  readSavedConversationTitlePreferencesMock,
  writeSavedConversationTitlePreferencesMock,
} = vi.hoisted(() => ({
  logErrorMock: vi.fn(),
  persistSettingsWriteMock: vi.fn(),
  readSavedConversationTitlePreferencesMock: vi.fn(),
  writeSavedConversationTitlePreferencesMock: vi.fn(),
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

vi.mock('../ui/settingsPersistence.js', () => ({
  persistSettingsWrite: persistSettingsWriteMock,
}));

vi.mock('../ui/conversationTitlePreferences.js', () => ({
  readSavedConversationTitlePreferences: readSavedConversationTitlePreferencesMock,
  writeSavedConversationTitlePreferences: writeSavedConversationTitlePreferencesMock,
}));

import { registerConversationTitlesRoutes } from './conversationTitles.js';

describe('registerConversationTitlesRoutes', () => {
  beforeEach(() => {
    logErrorMock.mockReset();
    persistSettingsWriteMock.mockReset();
    readSavedConversationTitlePreferencesMock.mockReset();
    writeSavedConversationTitlePreferencesMock.mockReset();
  });

  function createHarness(settingsFile = '/tmp/settings.json') {
    let getHandler: ((req: any, res: any) => void) | undefined;
    let patchHandler: ((req: any, res: any) => void) | undefined;
    const router = {
      get: vi.fn((path: string, next: typeof getHandler) => {
        expect(path).toBe('/api/conversation-titles/settings');
        getHandler = next;
      }),
      patch: vi.fn((path: string, next: typeof patchHandler) => {
        expect(path).toBe('/api/conversation-titles/settings');
        patchHandler = next;
      }),
    };

    registerConversationTitlesRoutes(router as never, {
      getSettingsFile: () => settingsFile,
    });

    return {
      getHandler: getHandler!,
      patchHandler: patchHandler!,
    };
  }

  function createResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  }

  it('reads saved title preferences from the configured settings file', () => {
    const { getHandler } = createHarness('/tmp/custom-settings.json');
    const res = createResponse();
    readSavedConversationTitlePreferencesMock.mockReturnValue({
      enabled: true,
      currentModel: '',
      effectiveModel: 'openai-codex/gpt-5.4',
    });

    getHandler({}, res);

    expect(readSavedConversationTitlePreferencesMock).toHaveBeenCalledWith('/tmp/custom-settings.json');
    expect(res.json).toHaveBeenCalledWith({
      enabled: true,
      currentModel: '',
      effectiveModel: 'openai-codex/gpt-5.4',
    });
  });

  it('logs and returns 500 when reading preferences fails', () => {
    const { getHandler } = createHarness();
    const res = createResponse();
    readSavedConversationTitlePreferencesMock.mockImplementation(() => {
      throw new Error('read failed');
    });

    getHandler({}, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'read failed',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: read failed' });
  });

  it('rejects patch requests when neither enabled nor model is provided', () => {
    const { patchHandler } = createHarness();
    const res = createResponse();

    patchHandler({ body: {} }, res);

    expect(persistSettingsWriteMock).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'enabled or model required' });
  });

  it('persists updated title settings through settings persistence', () => {
    const { patchHandler } = createHarness('/tmp/title-settings.json');
    const res = createResponse();
    writeSavedConversationTitlePreferencesMock.mockReturnValue({
      enabled: false,
      currentModel: 'anthropic/claude-sonnet-4-6',
      effectiveModel: 'anthropic/claude-sonnet-4-6',
    });
    persistSettingsWriteMock.mockImplementation((writer, options) => {
      expect(options).toEqual({ runtimeSettingsFile: '/tmp/title-settings.json' });
      return writer('/tmp/title-settings.json');
    });

    patchHandler({
      body: {
        enabled: false,
        model: 'anthropic/claude-sonnet-4-6',
      },
    }, res);

    expect(writeSavedConversationTitlePreferencesMock).toHaveBeenCalledWith({
      enabled: false,
      model: 'anthropic/claude-sonnet-4-6',
    }, '/tmp/title-settings.json');
    expect(res.json).toHaveBeenCalledWith({
      enabled: false,
      currentModel: 'anthropic/claude-sonnet-4-6',
      effectiveModel: 'anthropic/claude-sonnet-4-6',
    });
  });

  it('accepts null model values and returns 500 when persistence fails', () => {
    const { patchHandler } = createHarness();
    const res = createResponse();
    persistSettingsWriteMock.mockImplementation(() => {
      throw new Error('persist failed');
    });

    patchHandler({ body: { model: null } }, res);

    expect(persistSettingsWriteMock).toHaveBeenCalledTimes(1);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'persist failed',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: persist failed' });
  });
});
