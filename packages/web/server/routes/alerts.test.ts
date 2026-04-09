import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  acknowledgeAlertForProfileMock,
  dismissAlertForProfileMock,
  getAlertForProfileMock,
  getAlertSnapshotForProfileMock,
  invalidateAppTopicsMock,
  logErrorMock,
  snoozeAlertForProfileMock,
} = vi.hoisted(() => ({
  acknowledgeAlertForProfileMock: vi.fn(),
  dismissAlertForProfileMock: vi.fn(),
  getAlertForProfileMock: vi.fn(),
  getAlertSnapshotForProfileMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  logErrorMock: vi.fn(),
  snoozeAlertForProfileMock: vi.fn(),
}));

vi.mock('../automation/alerts.js', () => ({
  acknowledgeAlertForProfile: acknowledgeAlertForProfileMock,
  dismissAlertForProfile: dismissAlertForProfileMock,
  getAlertForProfile: getAlertForProfileMock,
  getAlertSnapshotForProfile: getAlertSnapshotForProfileMock,
  snoozeAlertForProfile: snoozeAlertForProfileMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
}));

import { registerAlertRoutes } from './alerts.js';

describe('registerAlertRoutes', () => {
  beforeEach(() => {
    acknowledgeAlertForProfileMock.mockReset();
    dismissAlertForProfileMock.mockReset();
    getAlertForProfileMock.mockReset();
    getAlertSnapshotForProfileMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    logErrorMock.mockReset();
    snoozeAlertForProfileMock.mockReset();
  });

  function createHarness(getCurrentProfile: () => string = () => 'assistant') {
    const handlers: Record<string, (req: any, res: any) => unknown> = {};
    const router = {
      get: vi.fn((path: string, next: (req: any, res: any) => unknown) => {
        handlers[`GET ${path}`] = next;
      }),
      post: vi.fn((path: string, next: (req: any, res: any) => unknown) => {
        handlers[`POST ${path}`] = next;
      }),
    };

    registerAlertRoutes(router as never, { getCurrentProfile });

    return {
      listHandler: handlers['GET /api/alerts']!,
      detailHandler: handlers['GET /api/alerts/:id']!,
      acknowledgeHandler: handlers['POST /api/alerts/:id/ack']!,
      dismissHandler: handlers['POST /api/alerts/:id/dismiss']!,
      snoozeHandler: handlers['POST /api/alerts/:id/snooze']!,
    };
  }

  function createResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  }

  it('returns the alert snapshot for the current profile', () => {
    const { listHandler } = createHarness(() => 'datadog');
    const res = createResponse();
    getAlertSnapshotForProfileMock.mockReturnValue({
      entries: [{ id: 'alert-1' }],
      activeCount: 1,
    });

    listHandler({}, res);

    expect(getAlertSnapshotForProfileMock).toHaveBeenCalledWith('datadog');
    expect(res.json).toHaveBeenCalledWith({
      entries: [{ id: 'alert-1' }],
      activeCount: 1,
    });
  });

  it('logs and returns 500 when listing alerts fails', () => {
    const { listHandler } = createHarness();
    const res = createResponse();
    getAlertSnapshotForProfileMock.mockImplementation(() => {
      throw new Error('snapshot failed');
    });

    listHandler({}, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'snapshot failed',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: snapshot failed' });
  });

  it('returns a specific alert and 404s when it is missing', () => {
    const { detailHandler } = createHarness();
    const res = createResponse();
    getAlertForProfileMock.mockReturnValue({ id: 'alert-1', title: 'Wake up' });

    detailHandler({ params: { id: 'alert-1' } }, res);

    expect(getAlertForProfileMock).toHaveBeenCalledWith('assistant', 'alert-1');
    expect(res.json).toHaveBeenCalledWith({ id: 'alert-1', title: 'Wake up' });

    getAlertForProfileMock.mockReturnValue(undefined);
    const missingRes = createResponse();

    detailHandler({ params: { id: 'missing' } }, missingRes);

    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  it('logs and returns 500 when loading a specific alert fails', () => {
    const { detailHandler } = createHarness();
    const res = createResponse();
    getAlertForProfileMock.mockImplementation(() => {
      throw new Error('detail failed');
    });

    detailHandler({ params: { id: 'alert-1' } }, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'detail failed',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: detail failed' });
  });

  it('acknowledges alerts and invalidates alert snapshots', () => {
    const { acknowledgeHandler } = createHarness();
    const res = createResponse();
    acknowledgeAlertForProfileMock.mockReturnValue({ id: 'alert-1', status: 'acknowledged' });

    acknowledgeHandler({ params: { id: 'alert-1' } }, res);

    expect(acknowledgeAlertForProfileMock).toHaveBeenCalledWith('assistant', 'alert-1');
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('alerts');
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      alert: { id: 'alert-1', status: 'acknowledged' },
    });
  });

  it('dismisses alerts, returning 404s for missing ids', () => {
    const { dismissHandler } = createHarness();
    const res = createResponse();
    dismissAlertForProfileMock.mockReturnValue({ id: 'alert-1', status: 'dismissed' });

    dismissHandler({ params: { id: 'alert-1' } }, res);

    expect(dismissAlertForProfileMock).toHaveBeenCalledWith('assistant', 'alert-1');
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('alerts');
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      alert: { id: 'alert-1', status: 'dismissed' },
    });

    dismissAlertForProfileMock.mockReturnValue(undefined);
    const missingRes = createResponse();

    dismissHandler({ params: { id: 'missing' } }, missingRes);

    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Not found' });
  });

  it('logs and returns 500 when alert acknowledgements or dismissals fail', () => {
    const { acknowledgeHandler, dismissHandler } = createHarness();

    acknowledgeAlertForProfileMock.mockImplementation(() => {
      throw new Error('ack failed');
    });
    const ackRes = createResponse();
    acknowledgeHandler({ params: { id: 'alert-1' } }, ackRes);
    expect(ackRes.status).toHaveBeenCalledWith(500);
    expect(ackRes.json).toHaveBeenCalledWith({ error: 'Error: ack failed' });

    dismissAlertForProfileMock.mockImplementation(() => {
      throw new Error('dismiss failed');
    });
    const dismissRes = createResponse();
    dismissHandler({ params: { id: 'alert-1' } }, dismissRes);
    expect(dismissRes.status).toHaveBeenCalledWith(500);
    expect(dismissRes.json).toHaveBeenCalledWith({ error: 'Error: dismiss failed' });

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'ack failed',
    }));
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'dismiss failed',
    }));
  });

  it('snoozes alerts and invalidates alerts, sessions, and runs', async () => {
    const { snoozeHandler } = createHarness();
    const res = createResponse();
    snoozeAlertForProfileMock.mockResolvedValue({
      alert: { id: 'alert-1', status: 'acknowledged' },
      resume: { id: 'resume-1', dueAt: '2026-04-09T15:00:00.000Z' },
    });

    await snoozeHandler({
      params: { id: 'alert-1' },
      body: { delay: '15m', at: undefined },
    }, res);

    expect(snoozeAlertForProfileMock).toHaveBeenCalledWith('assistant', 'alert-1', {
      delay: '15m',
      at: undefined,
    });
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('alerts', 'sessions', 'runs');
    expect(res.json).toHaveBeenCalledWith({
      ok: true,
      alert: { id: 'alert-1', status: 'acknowledged' },
      resume: { id: 'resume-1', dueAt: '2026-04-09T15:00:00.000Z' },
    });
  });

  it('returns 404 when snoozing a missing alert and 400 for invalid snoozes', async () => {
    const { snoozeHandler } = createHarness();

    snoozeAlertForProfileMock.mockResolvedValue(undefined);
    const missingRes = createResponse();
    await snoozeHandler({ params: { id: 'missing' }, body: { delay: '5m' } }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Not found' });

    snoozeAlertForProfileMock.mockRejectedValue(new Error('Invalid delay'));
    const invalidRes = createResponse();
    await snoozeHandler({ params: { id: 'alert-1' }, body: { delay: 'bogus' } }, invalidRes);
    expect(invalidRes.status).toHaveBeenCalledWith(400);
    expect(invalidRes.json).toHaveBeenCalledWith({ error: 'Invalid delay' });
  });
});
