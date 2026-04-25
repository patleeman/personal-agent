import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  persistSettingsWriteMock,
} = vi.hoisted(() => ({
  persistSettingsWriteMock: vi.fn(),
}));

vi.mock('../ui/settingsPersistence.js', () => ({
  persistSettingsWrite: persistSettingsWriteMock,
}));

import { registerTranscriptionRoutes } from './transcription.js';

describe('registerTranscriptionRoutes', () => {
  beforeEach(() => {
    persistSettingsWriteMock.mockReset();
  });

  function createHarness(settingsFile = '/tmp/transcription-settings.json') {
    let patchHandler: ((req: { body: unknown }, res: ReturnType<typeof createResponse>) => void) | undefined;
    const router = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn((path: string, next: typeof patchHandler) => {
        expect(path).toBe('/api/transcription/settings');
        patchHandler = next;
      }),
    };

    registerTranscriptionRoutes(router as never, {
      getSettingsFile: () => settingsFile,
      getAuthFile: () => '/tmp/auth.json',
    });

    return { patchHandler: patchHandler! };
  }

  function createResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  }

  it('persists dictation settings through durable settings persistence', () => {
    const { patchHandler } = createHarness('/tmp/runtime-settings.json');
    const res = createResponse();
    persistSettingsWriteMock.mockImplementation((writer, options) => {
      expect(options).toEqual({ runtimeSettingsFile: '/tmp/runtime-settings.json' });
      return writer('/tmp/runtime-settings.json');
    });

    patchHandler({
      body: {
        provider: 'openai-codex-realtime',
        model: 'gpt-4o-mini-transcribe',
      },
    }, res);

    expect(persistSettingsWriteMock).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      settings: {
        provider: 'openai-codex-realtime',
        model: 'gpt-4o-mini-transcribe',
      },
    }));
  });
});
