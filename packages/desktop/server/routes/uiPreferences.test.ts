import { describe, expect, it, vi } from 'vitest';

vi.mock('../ui/uiPreferences.js', () => ({
  readSavedUiPreferences: vi.fn(),
  writeSavedUiPreferences: vi.fn(),
}));

vi.mock('../middleware/index.js', () => ({
  logError: vi.fn(),
}));

vi.mock('../ui/settingsPersistence.js', () => ({
  persistSettingsWrite: vi.fn(),
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: vi.fn(),
}));

import * as appEvents from '../shared/appEvents.js';
import * as settingsPersistence from '../ui/settingsPersistence.js';
import * as uiPrefs from '../ui/uiPreferences.js';
import { registerUiPreferenceRoutes } from './uiPreferences.js';

function createMockRouter() {
  return {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
  };
}

function createMockResponse() {
  return {
    json: vi.fn(),
    status: vi.fn().mockReturnThis(),
  };
}

describe('registerUiPreferenceRoutes', () => {
  const settingsFile = '/tmp/test-settings.json';

  it('registers GET /api/ui/open-conversations', () => {
    const router = createMockRouter();
    registerUiPreferenceRoutes(router as never, {
      getSettingsFile: () => settingsFile,
    });
    expect(router.get).toHaveBeenCalledWith('/api/ui/open-conversations', expect.any(Function));
  });

  it('registers PATCH /api/ui/open-conversations', () => {
    const router = createMockRouter();
    registerUiPreferenceRoutes(router as never, {
      getSettingsFile: () => settingsFile,
    });
    expect(router.patch).toHaveBeenCalledWith('/api/ui/open-conversations', expect.any(Function));
  });

  it('GET handler returns saved preferences', async () => {
    vi.mocked(uiPrefs.readSavedUiPreferences).mockReturnValue({
      openConversationIds: ['c1', 'c2'],
      pinnedConversationIds: ['c1'],
      archivedConversationIds: ['c3'],
      workspacePaths: ['/repo/a', '/repo/b'],
    });

    const router = createMockRouter();
    registerUiPreferenceRoutes(router as never, { getSettingsFile: () => settingsFile });

    const getHandler = router.get.mock.calls[0][1];
    const req = {};

    const res = createMockResponse();
    await getHandler(req, res);

    expect(uiPrefs.readSavedUiPreferences).toHaveBeenCalledWith(settingsFile);
    expect(res.json).toHaveBeenCalledWith({
      sessionIds: ['c1', 'c2'],
      pinnedSessionIds: ['c1'],
      archivedSessionIds: ['c3'],
      workspacePaths: ['/repo/a', '/repo/b'],
    });
  });

  it('PATCH handler validates sessionIds', async () => {
    const router = createMockRouter();
    registerUiPreferenceRoutes(router as never, { getSettingsFile: () => settingsFile });
    const patchHandler = router.patch.mock.calls[0][1];
    const res = createMockResponse();

    await patchHandler({ body: { sessionIds: 'not-an-array' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'sessionIds must be an array when provided' });
  });

  it('PATCH handler validates workspacePaths', async () => {
    const router = createMockRouter();
    registerUiPreferenceRoutes(router as never, { getSettingsFile: () => settingsFile });
    const patchHandler = router.patch.mock.calls[0][1];
    const res = createMockResponse();

    await patchHandler({ body: { workspacePaths: 'not-an-array' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'workspacePaths must be an array when provided' });
  });

  it('PATCH handler requires at least one field', async () => {
    const router = createMockRouter();
    registerUiPreferenceRoutes(router as never, { getSettingsFile: () => settingsFile });
    const patchHandler = router.patch.mock.calls[0][1];
    const res = createMockResponse();

    await patchHandler({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.stringContaining('required') }));
  });

  it('PATCH handler writes preferences and invalidates sessions', async () => {
    vi.mocked(settingsPersistence.persistSettingsWrite).mockReturnValue({
      openConversationIds: ['c1'],
      pinnedConversationIds: [],
      archivedConversationIds: [],
      workspacePaths: [],
    });

    const router = createMockRouter();
    registerUiPreferenceRoutes(router as never, { getSettingsFile: () => settingsFile });
    const patchHandler = router.patch.mock.calls[0][1];
    const res = createMockResponse();

    await patchHandler({ body: { sessionIds: ['c1'], workspacePaths: ['/repo'] } }, res);

    expect(settingsPersistence.persistSettingsWrite).toHaveBeenCalled();
    expect(appEvents.invalidateAppTopics).toHaveBeenCalledWith('sessions');
    expect(appEvents.invalidateAppTopics).toHaveBeenCalledWith('workspace');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});
