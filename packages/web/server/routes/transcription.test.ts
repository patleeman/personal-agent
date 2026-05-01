import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  persistSettingsWriteMock,
} = vi.hoisted(() => ({
  persistSettingsWriteMock: vi.fn(),
}));

vi.mock('../ui/settingsPersistence.js', () => ({
  persistSettingsWrite: persistSettingsWriteMock,
}));

import { readRequiredBase64, registerTranscriptionRoutes } from './transcription.js';

describe('registerTranscriptionRoutes', () => {
  beforeEach(() => {
    persistSettingsWriteMock.mockReset();
  });

  function createHarness(settingsFile = '/tmp/transcription-settings.json') {
    let patchHandler: ((req: { body: unknown }, res: ReturnType<typeof createResponse>) => void) | undefined;
    let postHandler: ((req: { body: unknown }, res: ReturnType<typeof createResponse>) => Promise<void>) | undefined;
    const router = {
      get: vi.fn(),
      post: vi.fn((path: string, next: typeof postHandler) => {
        expect(path).toBe('/api/transcription/transcribe-file');
        postHandler = next;
      }),
      patch: vi.fn((path: string, next: typeof patchHandler) => {
        expect(path).toBe('/api/transcription/settings');
        patchHandler = next;
      }),
    };

    registerTranscriptionRoutes(router as never, {
      getSettingsFile: () => settingsFile,
      getAuthFile: () => '/tmp/auth.json',
    });

    return { patchHandler: patchHandler!, postHandler: postHandler! };
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
        provider: 'local-whisper',
        model: 'base.en',
      },
    }, res);

    expect(persistSettingsWriteMock).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      settings: {
        provider: 'local-whisper',
        model: 'base.en',
      },
    }));
  });

  it('rejects malformed transcription file base64 before provider dispatch', () => {
    expect(() => readRequiredBase64('not-valid-base64!', 'dataBase64'))
      .toThrow('dataBase64 must contain valid base64 data.');
  });

  it('returns a client error for malformed transcription file base64', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pa-transcription-route-'));
    const settingsFile = join(root, 'settings.json');
    writeFileSync(settingsFile, JSON.stringify({ transcription: { provider: 'local-whisper' } }));
    const { postHandler } = createHarness(settingsFile);
    const res = createResponse();

    await postHandler({ body: { dataBase64: 'not-valid-base64!' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'dataBase64 must contain valid base64 data.' });
  });
});
