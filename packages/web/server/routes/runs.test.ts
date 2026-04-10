import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cancelDurableRunMock,
  getDurableRunLogMock,
  getDurableRunMock,
  invalidateAppTopicsMock,
  listDurableRunsMock,
  logErrorMock,
} = vi.hoisted(() => ({
  cancelDurableRunMock: vi.fn(),
  getDurableRunLogMock: vi.fn(),
  getDurableRunMock: vi.fn(),
  invalidateAppTopicsMock: vi.fn(),
  listDurableRunsMock: vi.fn(),
  logErrorMock: vi.fn(),
}));

vi.mock('../automation/durableRuns.js', () => ({
  cancelDurableRun: cancelDurableRunMock,
  getDurableRun: getDurableRunMock,
  getDurableRunLog: getDurableRunLogMock,
  listDurableRuns: listDurableRunsMock,
}));

vi.mock('../middleware/index.js', () => ({
  invalidateAppTopics: invalidateAppTopicsMock,
  logError: logErrorMock,
}));

import { registerRunRoutes } from './runs.js';

describe('registerRunRoutes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    cancelDurableRunMock.mockReset();
    getDurableRunLogMock.mockReset();
    getDurableRunMock.mockReset();
    invalidateAppTopicsMock.mockReset();
    listDurableRunsMock.mockReset();
    logErrorMock.mockReset();
  });

  function createHarness() {
    const handlers: Record<string, (req: unknown, res: unknown) => Promise<void> | void> = {};
    const router = {
      get: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`GET ${path}`] = next;
      }),
      post: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`POST ${path}`] = next;
      }),
      patch: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`PATCH ${path}`] = next;
      }),
    };

    registerRunRoutes(router as never);

    return {
      listHandler: handlers['GET /api/runs']!,
      detailHandler: handlers['GET /api/runs/:id']!,
      attentionHandler: handlers['PATCH /api/runs/:id/attention']!,
      eventsHandler: handlers['GET /api/runs/:id/events']!,
      logHandler: handlers['GET /api/runs/:id/log']!,
      cancelHandler: handlers['POST /api/runs/:id/cancel']!,
    };
  }

  function createJsonResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
  }

  function createStreamResponse() {
    return {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
    };
  }

  it('lists runs and logs list failures', async () => {
    const { listHandler } = createHarness();
    const res = createJsonResponse();
    listDurableRunsMock.mockResolvedValue({ runs: [{ runId: 'run-1' }] });

    await listHandler({}, res);
    expect(res.json).toHaveBeenCalledWith({ runs: [{ runId: 'run-1' }] });

    listDurableRunsMock.mockRejectedValue(new Error('list failed'));
    const failingRes = createJsonResponse();
    await listHandler({}, failingRes);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'list failed',
    }));
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: list failed' });
  });

  it('returns run details, 404s missing runs, and logs detail failures', async () => {
    const { detailHandler } = createHarness();
    const res = createJsonResponse();
    getDurableRunMock.mockResolvedValue({ run: { runId: 'run-1' } });

    await detailHandler({ params: { id: 'run-1' } }, res);
    expect(getDurableRunMock).toHaveBeenCalledWith('run-1');
    expect(res.json).toHaveBeenCalledWith({ run: { runId: 'run-1' } });

    getDurableRunMock.mockResolvedValue(undefined);
    const missingRes = createJsonResponse();
    await detailHandler({ params: { id: 'missing' } }, missingRes);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Run not found' });

    getDurableRunMock.mockRejectedValue(new Error('detail failed'));
    const failingRes = createJsonResponse();
    await detailHandler({ params: { id: 'run-1' } }, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: detail failed' });
  });

  it('updates attention state, invalidating runs only for unread requests and surfacing handler failures', async () => {
    const { attentionHandler } = createHarness();

    const readRes = createJsonResponse();
    await attentionHandler({ params: { id: 'run-1' }, body: {} }, readRes);
    expect(invalidateAppTopicsMock).not.toHaveBeenCalled();
    expect(readRes.json).toHaveBeenCalledWith({ ok: true });

    const unreadRes = createJsonResponse();
    await attentionHandler({ params: { id: 'run-1' }, body: { read: false } }, unreadRes);
    expect(invalidateAppTopicsMock).toHaveBeenCalledWith('runs');
    expect(unreadRes.json).toHaveBeenCalledWith({ ok: true });

    invalidateAppTopicsMock.mockImplementation(() => {
      throw new Error('invalidate failed');
    });
    const failingRes = createJsonResponse();
    await attentionHandler({ params: { id: 'run-1' }, body: { read: false } }, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: invalidate failed' });
  });

  it('streams run snapshots, heartbeats, and stops after close while ignoring missing or failing polls', async () => {
    vi.useFakeTimers();
    const { eventsHandler } = createHarness();
    getDurableRunMock
      .mockResolvedValueOnce({ run: { runId: 'run-1', status: 'running' } })
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('poll failed'))
      .mockResolvedValue(undefined);
    const req = Object.assign(new EventEmitter(), {
      params: { id: 'run-1' },
    });
    const res = createStreamResponse();

    await eventsHandler(req, res);
    await Promise.resolve();

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(res.flushHeaders).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ run: { runId: 'run-1', status: 'running' } })}\n\n`);

    const writesAfterInitialSnapshot = res.write.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    expect(res.write.mock.calls).toHaveLength(writesAfterInitialSnapshot);

    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    expect(res.write.mock.calls).toHaveLength(writesAfterInitialSnapshot);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(res.write).toHaveBeenCalledWith(': heartbeat\n\n');

    const writesBeforeClose = res.write.mock.calls.length;
    req.emit('close');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(res.write.mock.calls).toHaveLength(writesBeforeClose);
  });

  it('reads run logs with parsed tails, 404s missing logs, and logs failures', async () => {
    const { logHandler } = createHarness();
    const res = createJsonResponse();
    getDurableRunLogMock.mockResolvedValue({ path: '/tmp/run.log', log: 'tail' });

    await logHandler({ params: { id: 'run-1' }, query: { tail: '25' } }, res);
    expect(getDurableRunLogMock).toHaveBeenCalledWith('run-1', 25);
    expect(res.json).toHaveBeenCalledWith({ path: '/tmp/run.log', log: 'tail' });

    const invalidTailRes = createJsonResponse();
    await logHandler({ params: { id: 'run-1' }, query: { tail: ['not-a-string'] } }, invalidTailRes);
    expect(getDurableRunLogMock).toHaveBeenLastCalledWith('run-1', undefined);

    getDurableRunLogMock.mockResolvedValue(undefined);
    const missingRes = createJsonResponse();
    await logHandler({ params: { id: 'missing' }, query: { tail: '-1' } }, missingRes);
    expect(getDurableRunLogMock).toHaveBeenLastCalledWith('missing', undefined);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Run not found' });

    getDurableRunLogMock.mockRejectedValue(new Error('log failed'));
    const failingRes = createJsonResponse();
    await logHandler({ params: { id: 'run-1' }, query: {} }, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: log failed' });
  });

  it('cancels runs, handling conflicts and failures', async () => {
    const { cancelHandler } = createHarness();
    const res = createJsonResponse();
    cancelDurableRunMock.mockResolvedValue({ cancelled: true, reason: null });

    await cancelHandler({ params: { id: 'run-1' } }, res);
    expect(cancelDurableRunMock).toHaveBeenCalledWith('run-1');
    expect(res.json).toHaveBeenCalledWith({ cancelled: true, reason: null });

    cancelDurableRunMock.mockResolvedValue({ cancelled: false, reason: 'already finished' });
    const conflictRes = createJsonResponse();
    await cancelHandler({ params: { id: 'run-1' } }, conflictRes);
    expect(conflictRes.status).toHaveBeenCalledWith(409);
    expect(conflictRes.json).toHaveBeenCalledWith({ error: 'already finished' });

    cancelDurableRunMock.mockRejectedValue(new Error('cancel failed'));
    const failingRes = createJsonResponse();
    await cancelHandler({ params: { id: 'run-1' } }, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: cancel failed' });
  });
});
