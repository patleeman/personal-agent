import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  cancelDurableRunMock,
  getDurableRunLogCursorMock,
  getDurableRunLogMock,
  getDurableRunMock,
  listDurableRunsMock,
  logErrorMock,
  readDurableRunLogDeltaMock,
} = vi.hoisted(() => ({
  cancelDurableRunMock: vi.fn(),
  getDurableRunLogCursorMock: vi.fn(),
  getDurableRunLogMock: vi.fn(),
  getDurableRunMock: vi.fn(),
  listDurableRunsMock: vi.fn(),
  logErrorMock: vi.fn(),
  readDurableRunLogDeltaMock: vi.fn(),
}));

vi.mock('../automation/durableRuns.js', () => ({
  cancelDurableRun: cancelDurableRunMock,
  getDurableRun: getDurableRunMock,
  getDurableRunLog: getDurableRunLogMock,
  getDurableRunLogCursor: getDurableRunLogCursorMock,
  listDurableRuns: listDurableRunsMock,
  readDurableRunLogDelta: readDurableRunLogDeltaMock,
}));

vi.mock('../middleware/index.js', () => ({
  invalidateAppTopics: vi.fn(),
  logError: logErrorMock,
}));

import { registerRunAppRoutes } from './runsApp.js';

describe('registerRunAppRoutes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    cancelDurableRunMock.mockReset();
    getDurableRunLogCursorMock.mockReset();
    getDurableRunLogCursorMock.mockReturnValue(0);
    getDurableRunLogMock.mockReset();
    getDurableRunMock.mockReset();
    listDurableRunsMock.mockReset();
    logErrorMock.mockReset();
    readDurableRunLogDeltaMock.mockReset();
    readDurableRunLogDeltaMock.mockReturnValue(undefined);
  });

  function createHarness(options?: {
    getDurableRunSnapshot?: (runId: string, tail: number) => Promise<unknown | null>;
  }) {
    const handlers: Record<string, (req: unknown, res: unknown) => Promise<void> | void> = {};
    const router = {
      get: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`GET ${path}`] = next;
      }),
      post: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`POST ${path}`] = next;
      }),
      patch: vi.fn(),
    };

    registerRunAppRoutes(router as never, {
      getDurableRunSnapshot: options?.getDurableRunSnapshot ?? (async () => null),
    });

    return {
      listHandler: handlers['GET /api/runs']!,
      detailHandler: handlers['GET /api/runs/:id']!,
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
      end: vi.fn(),
    };
  }

  it('lists durable runs and logs list failures', async () => {
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

  it('returns run details and 404s for missing runs', async () => {
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
  });

  it('returns 500 when loading run details fails', async () => {
    const { detailHandler } = createHarness();
    const res = createJsonResponse();
    getDurableRunMock.mockRejectedValue(new Error('detail failed'));

    await detailHandler({ params: { id: 'run-1' } }, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'detail failed',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: detail failed' });
  });

  it('streams run snapshots, log deltas, heartbeats, and stops after close', async () => {
    vi.useFakeTimers();
    readDurableRunLogDeltaMock.mockReturnValueOnce({
      path: '/tmp/run.log',
      delta: '\nstream chunk',
      nextCursor: 12,
      reset: false,
    });
    const getDurableRunSnapshot = vi.fn()
      .mockResolvedValueOnce({
        detail: { run: { runId: 'run-1', status: 'running' } },
        log: { path: '/tmp/run.log', log: 'initial' },
      })
      .mockResolvedValue({
        detail: { run: { runId: 'run-1', status: 'running' } },
        log: { path: '/tmp/run.log', log: 'next' },
      });
    const { eventsHandler } = createHarness({ getDurableRunSnapshot });
    const req = Object.assign(new EventEmitter(), {
      params: { id: 'run-1' },
      query: { tail: '5000' },
    });
    const res = createStreamResponse();

    await eventsHandler(req, res);

    expect(getDurableRunSnapshot).toHaveBeenCalledWith('run-1', 1000);
    expect(getDurableRunLogCursorMock).toHaveBeenCalledWith('/tmp/run.log');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.flushHeaders).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({
      type: 'snapshot',
      detail: { run: { runId: 'run-1', status: 'running' } },
      log: { path: '/tmp/run.log', log: 'initial' },
    })}\n\n`);

    await vi.advanceTimersByTimeAsync(250);
    expect(readDurableRunLogDeltaMock).toHaveBeenCalledWith('/tmp/run.log', 0);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({
      type: 'log_delta',
      path: '/tmp/run.log',
      delta: '\nstream chunk',
    })}\n\n`);

    await vi.advanceTimersByTimeAsync(750);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({
      type: 'detail',
      detail: { run: { runId: 'run-1', status: 'running' } },
    })}\n\n`);

    await vi.advanceTimersByTimeAsync(14_000);
    expect(res.write).toHaveBeenCalledWith(': heartbeat\n\n');

    const writesBeforeClose = res.write.mock.calls.length;
    req.emit('close');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(res.write.mock.calls).toHaveLength(writesBeforeClose);
  });

  it('returns 404 when the run snapshot is missing and logs snapshot startup failures', async () => {
    const missingSnapshot = vi.fn().mockResolvedValue(null);
    const { eventsHandler } = createHarness({ getDurableRunSnapshot: missingSnapshot });
    const missingRes = createStreamResponse();

    await eventsHandler({ params: { id: 'missing' }, query: { tail: '12' }, on: vi.fn() }, missingRes);

    expect(missingSnapshot).toHaveBeenCalledWith('missing', 12);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Run not found' });

    const failingSnapshot = vi.fn().mockRejectedValue(new Error('snapshot failed'));
    const failing = createHarness({ getDurableRunSnapshot: failingSnapshot });
    const failingRes = createStreamResponse();

    await failing.eventsHandler({ params: { id: 'run-1' }, query: {}, on: vi.fn() }, failingRes);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'snapshot failed',
    }));
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: snapshot failed' });
  });

  it('emits deleted events when a streamed run disappears during polling', async () => {
    vi.useFakeTimers();
    const getDurableRunSnapshot = vi.fn()
      .mockResolvedValueOnce({
        detail: { run: { runId: 'run-1', status: 'running' } },
        log: { path: '/tmp/run.log', log: 'initial' },
      })
      .mockResolvedValueOnce(null);
    const { eventsHandler } = createHarness({ getDurableRunSnapshot });
    const req = Object.assign(new EventEmitter(), {
      params: { id: 'run-1' },
      query: {},
    });
    const res = createStreamResponse();

    await eventsHandler(req, res);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(getDurableRunSnapshot).toHaveBeenLastCalledWith('run-1', 120);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'deleted', runId: 'run-1' })}\n\n`);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('reads run logs with sane tail defaults and 404s missing logs', async () => {
    const { logHandler } = createHarness();
    const res = createJsonResponse();
    getDurableRunLogMock.mockResolvedValue({ path: '/tmp/run.log', log: 'tail' });

    await logHandler({ params: { id: 'run-1' }, query: { tail: 'bogus' } }, res);

    expect(getDurableRunLogMock).toHaveBeenCalledWith('run-1', 120);
    expect(res.json).toHaveBeenCalledWith({ path: '/tmp/run.log', log: 'tail' });

    const malformedRes = createJsonResponse();
    await logHandler({ params: { id: 'run-1' }, query: { tail: '25abc' } }, malformedRes);
    expect(getDurableRunLogMock).toHaveBeenLastCalledWith('run-1', 120);

    getDurableRunLogMock.mockResolvedValue(undefined);
    const missingRes = createJsonResponse();
    await logHandler({ params: { id: 'missing' }, query: { tail: '10' } }, missingRes);

    expect(getDurableRunLogMock).toHaveBeenLastCalledWith('missing', 10);
    expect(missingRes.status).toHaveBeenCalledWith(404);
    expect(missingRes.json).toHaveBeenCalledWith({ error: 'Run not found' });
  });

  it('returns 500 when reading run logs fails', async () => {
    const { logHandler } = createHarness();
    const res = createJsonResponse();
    getDurableRunLogMock.mockRejectedValue(new Error('log failed'));

    await logHandler({ params: { id: 'run-1' }, query: {} }, res);

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'log failed',
    }));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Error: log failed' });
  });

  it('cancels durable runs, handling conflicts and errors', async () => {
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

    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'cancel failed',
    }));
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: cancel failed' });
  });
});
