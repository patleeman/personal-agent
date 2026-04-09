import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  clearInboxForCurrentProfileMock,
  findActivityRecordMock,
  invalidateAppTopicsMock,
  listConversationSessionsSnapshotMock,
  logErrorMock,
  markActivityReadStateMock,
} = vi.hoisted(() => ({
  clearInboxForCurrentProfileMock: vi.fn(),
  findActivityRecordMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  listConversationSessionsSnapshotMock: vi.fn(),
  logErrorMock: vi.fn(),
  markActivityReadStateMock: vi.fn(),
}));

vi.mock('../automation/inboxService.js', () => ({
  clearInboxForCurrentProfile: clearInboxForCurrentProfileMock,
  findActivityRecord: findActivityRecordMock,
  markActivityReadState: markActivityReadStateMock,
}));

vi.mock('../conversations/conversationService.js', () => ({
  listConversationSessionsSnapshot: listConversationSessionsSnapshotMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

import { registerActivityRoutes } from './activity.js';

describe('registerActivityRoutes', () => {
  beforeEach(() => {
    clearInboxForCurrentProfileMock.mockReset();
    findActivityRecordMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    listConversationSessionsSnapshotMock.mockReset();
    logErrorMock.mockReset();
    markActivityReadStateMock.mockReset();
  });

  function createHarness(options?: {
    getCurrentProfile?: () => string;
    getSavedWebUiPreferences?: () => {
      openConversationIds: string[];
      pinnedConversationIds: string[];
      archivedConversationIds: string[];
      nodeBrowserViews: unknown[];
    };
    listActivityForCurrentProfile?: () => Array<{ id?: string; read?: boolean }>;
  }) {
    const handlers: Record<string, (req: any, res: any) => unknown> = {};
    const router = {
      get: vi.fn((path: string, next: (req: any, res: any) => unknown) => {
        handlers[`GET ${path}`] = next;
      }),
      post: vi.fn((path: string, next: (req: any, res: any) => unknown) => {
        handlers[`POST ${path}`] = next;
      }),
      patch: vi.fn((path: string, next: (req: any, res: any) => unknown) => {
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
      listActivityForCurrentProfile: options?.listActivityForCurrentProfile ?? (() => []),
    });

    return {
      countHandler: handlers['GET /api/activity/count']!,
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

  it('counts unread activity entries and falls back to zero on errors', () => {
    const { countHandler } = createHarness({
      listActivityForCurrentProfile: () => [
        { id: 'a', read: false },
        { id: 'b', read: true },
        { id: 'c' },
      ],
    });
    const res = createResponse();

    countHandler({}, res);
    expect(res.json).toHaveBeenCalledWith({ count: 2 });

    const failing = createHarness({
      listActivityForCurrentProfile: () => {
        throw new Error('count failed');
      },
    });
    const fallbackRes = createResponse();

    failing.countHandler({}, fallbackRes);
    expect(fallbackRes.json).toHaveBeenCalledWith({ count: 0 });
  });

  it('clears inbox activity and invalidates app topics when anything changes', () => {
    const { clearHandler } = createHarness();
    const res = createResponse();
    listConversationSessionsSnapshotMock.mockReturnValue([
      { id: 'conversation-1', messageCount: 3 },
    ]);
    clearInboxForCurrentProfileMock.mockReturnValue({
      deletedActivityIds: ['activity-1'],
      clearedConversationIds: ['conversation-1'],
    });

    clearHandler({}, res);

    expect(clearInboxForCurrentProfileMock).toHaveBeenCalledWith({
      profile: 'assistant',
      sessions: [{ id: 'conversation-1', messageCount: 3 }],
      openConversationIds: ['open-1', 'pinned-1'],
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('activity', 'sessions');
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      deletedActivityIds: ['activity-1'],
      clearedConversationIds: ['conversation-1'],
    });
  });

  it('does not invalidate topics when clearing the inbox makes no changes', () => {
    const { clearHandler } = createHarness();
    const res = createResponse();
    listConversationSessionsSnapshotMock.mockReturnValue([]);
    clearInboxForCurrentProfileMock.mockReturnValue({
      deletedActivityIds: [],
      clearedConversationIds: [],
    });

    clearHandler({}, res);

    expect(invalidateAppTopicsMock).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      deletedActivityIds: [],
      clearedConversationIds: [],
    });
  });

  it('logs and returns 500 when clearing the inbox fails', () => {
    const { clearHandler } = createHarness();
    const res = createResponse();
    clearInboxForCurrentProfileMock.mockImplementation(() => {
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
    const { listHandler } = createHarness({
      listActivityForCurrentProfile: () => entries,
    });
    const res = createResponse();

    listHandler({}, res);
    expect(res.json).toHaveBeenCalledWith(entries);

    const failing = createHarness({
      listActivityForCurrentProfile: () => {
        throw new Error('list failed');
      },
    });
    const failingRes = createResponse();

    failing.listHandler({}, failingRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'list failed',
    }));
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: list failed' });
  });

  it('returns activity details with read state and 404s when the record is missing', () => {
    const { detailHandler } = createHarness();
    const res = createResponse();
    findActivityRecordMock.mockReturnValue({
      entry: { id: 'activity-1', title: 'Watch deploys' },
      read: true,
    });

    detailHandler({ params: { id: 'activity-1' } }, res);

    expect(findActivityRecordMock).toHaveBeenCalledWith('assistant', 'activity-1');
    expect(res.json).toHaveBeenCalledWith({
      id: 'activity-1',
      title: 'Watch deploys',
      read: true,
    });

    findActivityRecordMock.mockReturnValue(undefined);
    const missingRes = createResponse();

    detailHandler({ params: { id: 'missing' } }, missingRes);

    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  it('logs and returns 500 when looking up activity details fails', () => {
    const { detailHandler } = createHarness();
    const res = createResponse();
    findActivityRecordMock.mockImplementation(() => {
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
    markActivityReadStateMock.mockReturnValue(true);

    const readRes = createResponse();
    patchHandler({ params: { id: 'activity-1' }, body: {} }, readRes);
    expect(markActivityReadStateMock).toHaveBeenCalledWith('assistant', 'activity-1', true);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('activity', 'sessions');
    expect(readRes.json).toHaveBeenCalledWith({ ok: true });

    const unreadRes = createResponse();
    patchHandler({ params: { id: 'activity-1' }, body: { read: false } }, unreadRes);
    expect(markActivityReadStateMock).toHaveBeenLastCalledWith('assistant', 'activity-1', false);
    expect(unreadRes.json).toHaveBeenCalledWith({ ok: true });

    markActivityReadStateMock.mockReturnValue(false);
    const missingRes = createResponse();
    patchHandler({ params: { id: 'missing' }, body: {} }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  it('logs and returns 500 when updating activity read state fails', () => {
    const { patchHandler } = createHarness();
    const res = createResponse();
    markActivityReadStateMock.mockImplementation(() => {
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
