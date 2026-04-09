import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  invalidateAppTopicsMock,
  logErrorMock,
} = vi.hoisted(() => ({
  invalidateAppTopicsMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock('../middleware/index.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
  logError: logErrorMock,
}));

import { registerProfileRoutes } from './profiles.js';

describe('registerProfileRoutes', () => {
  beforeEach(() => {
    invalidateAppTopicsMock.mockReset();
    logErrorMock.mockReset();
  });

  function createHarness(options?: {
    getCurrentProfile?: () => string;
    setCurrentProfile?: (profile: string) => Promise<string>;
    listAvailableProfiles?: () => string[];
  }) {
    let getHandler: ((req: any, res: any) => void) | undefined;
    let patchHandler: ((req: any, res: any) => Promise<void>) | undefined;
    const router = {
      get: vi.fn((path: string, next: typeof getHandler) => {
        expect(path).toBe('/api/profiles');
        getHandler = next;
      }),
      patch: vi.fn((path: string, next: typeof patchHandler) => {
        expect(path).toBe('/api/profiles/current');
        patchHandler = next;
      }),
    };

    registerProfileRoutes(router as never, {
      getCurrentProfile: options?.getCurrentProfile ?? (() => 'assistant'),
      setCurrentProfile: options?.setCurrentProfile ?? (async (profile) => profile),
      listAvailableProfiles: options?.listAvailableProfiles ?? (() => ['assistant', 'other']),
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

  it('lists the current and available profiles', () => {
    const { getHandler } = createHarness({
      getCurrentProfile: () => 'datadog',
      listAvailableProfiles: () => ['assistant', 'datadog'],
    });
    const res = createResponse();

    getHandler({}, res);

    expect(res.json).toHaveBeenCalledWith({
      currentProfile: 'datadog',
      profiles: ['assistant', 'datadog'],
    });
  });

  it('logs and returns 500 when listing profiles fails', () => {
    const { getHandler } = createHarness({
      getCurrentProfile: () => {
        throw new Error('boom');
      },
    });
    const res = createResponse();

    getHandler({}, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'boom',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: boom' });
  });

  it('rejects profile changes when the request body is missing a profile', async () => {
    const { patchHandler } = createHarness();
    const res = createResponse();

    await patchHandler({ body: {} }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'profile required' });
    expect(invalidateAppTopicsMock).not.toHaveBeenCalled();
  });

  it('switches to the requested profile', async () => {
    const setCurrentProfile = vi.fn(async (profile: string) => `${profile}-resolved`);
    const { patchHandler } = createHarness({ setCurrentProfile });
    const res = createResponse();

    await patchHandler({ body: { profile: 'assistant' } }, res);

    expect(setCurrentProfile).toHaveBeenCalledWith('assistant');
    expect(res.json).toHaveBeenCalledWith({ ok: true, currentProfile: 'assistant-resolved' });
  });

  it('returns 400 when the requested profile does not exist', async () => {
    const { patchHandler } = createHarness({
      setCurrentProfile: async () => {
        throw new Error('Unknown profile: missing');
      },
    });
    const res = createResponse();

    await patchHandler({ body: { profile: 'missing' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unknown profile: missing' });
  });

  it('returns 500 for unexpected profile-switch failures', async () => {
    const { patchHandler } = createHarness({
      setCurrentProfile: async () => {
        throw new Error('disk exploded');
      },
    });
    const res = createResponse();

    await patchHandler({ body: { profile: 'assistant' } }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'disk exploded' });
  });
});
