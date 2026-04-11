import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clearInboxCapabilityMock,
  logErrorMock,
  markActivityReadCapabilityMock,
  readActivityDetailCapabilityMock,
  readActivityEntriesCapabilityMock,
} = vi.hoisted(() => ({
  clearInboxCapabilityMock: vi.fn(),
  logErrorMock: vi.fn(),
  markActivityReadCapabilityMock: vi.fn(),
  readActivityDetailCapabilityMock: vi.fn(),
  readActivityEntriesCapabilityMock: vi.fn(),
}));

vi.mock('../automation/inboxCapability.js', () => ({
  clearInboxCapability: clearInboxCapabilityMock,
  markActivityReadCapability: markActivityReadCapabilityMock,
  readActivityDetailCapability: readActivityDetailCapabilityMock,
  readActivityEntriesCapability: readActivityEntriesCapabilityMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

import { registerActivityRoutes } from './activity.js';

describe('registerActivityRoutes', () => {
  beforeEach(() => {
    clearInboxCapabilityMock.mockReset();
    logErrorMock.mockReset();
    markActivityReadCapabilityMock.mockReset();
    readActivityDetailCapabilityMock.mockReset();
    readActivityEntriesCapabilityMock.mockReset();
  });

  function createHarness(options?: {
    getCurrentProfile?: () => string;
    getSavedWebUiPreferences?: () => {
      openConversationIds: string[];
      pinnedConversationIds: string[];
      archivedConversationIds: string[];
      nodeBrowserViews: unknown[];
    };
  }) {
    type RouteHandler = (req: unknown, res: unknown) => unknown;
    const handlers: Record<string, RouteHandler> = {};
    const router = {
      get: vi.fn((path: string, next: RouteHandler) => {
        handlers[`GET ${path}`] = next;
      }),
      post: vi.fn((path: string, next: RouteHandler) => {
        handlers[`POST ${path}`] = next;
      }),
      patch: vi.fn((path: string, next: RouteHandler) => {
        handlers[`PATCH ${path}`] = next;
      }),
      delete: vi.fn(),
    };

    registerActivityRoutes(router as never, {
      getCurrentProfile: options?.getCurrentProfile ?? (() => 'assistant'),
      getSavedWebUiPreferences: options?.getSavedWebUiPreferences ?? (() => ({
        openConversationIds: ['open-1'],
        pinnedConversationIds: ['pinned-1'],
        archivedConversationIds: [],
        nodeBrowserViews: [],
      })),
    });

    return {
      clearHandler: handlers['POST /api/inbox/clear']!,
      listHandler: handlers['GET /api/activity']!,
      detailHandler: handlers['GET /api/activity/:id']!,
      patchHandler: handlers['PATCH /api/activity/:id']!,
    };
  }

  function createResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  }

  it('clears inbox activity using the saved open conversation ids', () => {
    const { clearHandler } = createHarness();
    const res = createResponse();
    clearInboxCapabilityMock.mockReturnValue({
      deletedActivityIds: ['activity-1'],
      clearedConversationIds: ['conversation-1'],
    });

    clearHandler({}, res);

    expect(clearInboxCapabilityMock).toHaveBeenCalledWith({
      profile: 'assistant',
      openConversationIds: ['open-1', 'pinned-1'],
    });
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      deletedActivityIds: ['activity-1'],
      clearedConversationIds: ['conversation-1'],
    });
  });

  it('logs and returns 500 when clearing the inbox fails', () => {
    const { clearHandler } = createHarness();
    const res = createResponse();
    clearInboxCapabilityMock.mockImplementation(() => {
      throw new Error('clear failed');
    });

    clearHandler({}, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'clear failed',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: clear failed' });
  });

  it('lists activity entries and logs failures', () => {
    const entries = [{ id: 'activity-1', read: true }];
    const { listHandler } = createHarness();
    const res = createResponse();
    readActivityEntriesCapabilityMock.mockReturnValue(entries);

    listHandler({}, res);
    expect(readActivityEntriesCapabilityMock).toHaveBeenCalledWith('assistant');
    expect(res.json).toHaveBeenCalledWith(entries);

    readActivityEntriesCapabilityMock.mockImplementation(() => {
      throw new Error('list failed');
    });
    const failingRes = createResponse();

    listHandler({}, failingRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'list failed',
    }));
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: list failed' });
  });

  it('returns activity details with read state and 404s when the record is missing', () => {
    const { detailHandler } = createHarness();
    const res = createResponse();
    readActivityDetailCapabilityMock.mockReturnValue({
      id: 'activity-1',
      title: 'Watch deploys',
      read: true,
    });

    detailHandler({ params: { id: 'activity-1' } }, res);

    expect(readActivityDetailCapabilityMock).toHaveBeenCalledWith('assistant', 'activity-1');
    expect(res.json).toHaveBeenCalledWith({
      id: 'activity-1',
      title: 'Watch deploys',
      read: true,
    });

    readActivityDetailCapabilityMock.mockReturnValue(undefined);
    const missingRes = createResponse();

    detailHandler({ params: { id: 'missing' } }, missingRes);

    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  it('logs and returns 500 when looking up activity details fails', () => {
    const { detailHandler } = createHarness();
    const res = createResponse();
    readActivityDetailCapabilityMock.mockImplementation(() => {
      throw new Error('detail failed');
    });

    detailHandler({ params: { id: 'activity-1' } }, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'detail failed',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: detail failed' });
  });

  it('marks activity read state, supports unread updates, and 404s for unknown ids', () => {
    const { patchHandler } = createHarness();
    markActivityReadCapabilityMock.mockReturnValueOnce(true).mockReturnValueOnce(true).mockReturnValueOnce(false);

    const readRes = createResponse();
    patchHandler({ params: { id: 'activity-1' }, body: {} }, readRes);
    expect(markActivityReadCapabilityMock).toHaveBeenCalledWith('assistant', 'activity-1', true);
    expect(readRes.json).toHaveBeenCalledWith({ ok: true });

    const unreadRes = createResponse();
    patchHandler({ params: { id: 'activity-1' }, body: { read: false } }, unreadRes);
    expect(markActivityReadCapabilityMock).toHaveBeenLastCalledWith('assistant', 'activity-1', false);
    expect(unreadRes.json).toHaveBeenCalledWith({ ok: true });

    const missingRes = createResponse();
    patchHandler({ params: { id: 'missing' }, body: {} }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  it('logs and returns 500 when updating activity read state fails', () => {
    const { patchHandler } = createHarness();
    const res = createResponse();
    markActivityReadCapabilityMock.mockImplementation(() => {
      throw new Error('patch failed');
    });

    patchHandler({ params: { id: 'activity-1' }, body: {} }, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'patch failed',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: patch failed' });
  });
});
