import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  listConversationSessionsSnapshotMock,
  listDurableRunsMock,
  logErrorMock,
  logWarnMock,
  readDaemonStateMock,
  readWebUiStateMock,
  streamSnapshotEventsMock,
  subscribeAppEventsMock,
} = vi.hoisted(() => ({
  listConversationSessionsSnapshotMock: vi.fn(),
  listDurableRunsMock: vi.fn(),
  logErrorMock: vi.fn(),
  logWarnMock: vi.fn(),
  readDaemonStateMock: vi.fn(),
  readWebUiStateMock: vi.fn(),
  streamSnapshotEventsMock: vi.fn(),
  subscribeAppEventsMock: vi.fn(),
}));

vi.mock('../ui/webUi.js', () => ({
  readWebUiState: readWebUiStateMock,
}));


vi.mock('../automation/daemon.js', () => ({
  readDaemonState: readDaemonStateMock,
}));


vi.mock('../shared/appEvents.js', () => ({
  subscribeAppEvents: subscribeAppEventsMock,
}));

vi.mock('../shared/snapshotEventStreaming.js', () => ({
  streamSnapshotEvents: streamSnapshotEventsMock,
}));

vi.mock('../middleware/index.js', () => ({
  logError: logErrorMock,
  logWarn: logWarnMock,
}));

vi.mock('../conversations/conversationService.js', () => ({
  listConversationSessionsSnapshot: listConversationSessionsSnapshotMock,
}));

vi.mock('../automation/durableRuns.js', () => ({
  listDurableRuns: listDurableRunsMock,
}));

import { registerSystemRoutes } from './system.js';

const flushAsyncWork = async () => {
  for (let index = 0; index < 50; index += 1) {
    await Promise.resolve();
  }
};

describe('system routes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    listConversationSessionsSnapshotMock.mockReset();
    listDurableRunsMock.mockReset();
    logErrorMock.mockReset();
    logWarnMock.mockReset();
    readDaemonStateMock.mockReset();
    readWebUiStateMock.mockReset();
    streamSnapshotEventsMock.mockReset();
    subscribeAppEventsMock.mockReset();

    listConversationSessionsSnapshotMock.mockReturnValue([{ id: 'conversation-1' }]);
    listDurableRunsMock.mockResolvedValue({ runs: [{ runId: 'run-1' }] });
    readDaemonStateMock.mockResolvedValue({ running: true });
    readWebUiStateMock.mockReturnValue({ installed: true });
    streamSnapshotEventsMock.mockImplementation(async (topics: string[], { buildEvents, writeEvent }: {
      buildEvents: (topic: string) => Promise<unknown[]>;
      writeEvent: (event: unknown) => void;
    }) => {
      for (const topic of topics) {
        for (const event of await buildEvents(topic)) {
          writeEvent(event);
        }
      }
    });
  });

  function createDesktopHarness(options?: {
    getCurrentProfile?: () => string;
    getRepoRoot?: () => string;
    listTasksForCurrentProfile?: () => unknown[];
  }) {
    const handlers: Record<string, (req: unknown, res: unknown) => Promise<void> | void> = {};
    const router = {
      get: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`GET ${path}`] = next;
      }),
      post: vi.fn((path: string, next: (req: unknown, res: unknown) => Promise<void> | void) => {
        handlers[`POST ${path}`] = next;
      }),
    };

    registerSystemRoutes(router as never, {
      getCurrentProfile: options?.getCurrentProfile ?? (() => 'assistant'),
      getRepoRoot: options?.getRepoRoot ?? (() => '/repo'),
      listTasksForCurrentProfile: options?.listTasksForCurrentProfile ?? (() => [{ id: 'task-1' }]),
    });

    return {
      eventsHandler: handlers['GET /api/events']!,
      statusHandler: handlers['GET /api/status']!,
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

  it('returns status and logs handler failures', () => {
    const { statusHandler } = createDesktopHarness({
      getCurrentProfile: () => 'datadog',
      getRepoRoot: () => '/worktree',
    });
    const res = createJsonResponse();

    statusHandler({}, res);
    expect(res.json).toHaveBeenCalledWith({
      profile: 'datadog',
      repoRoot: '/worktree',
      webUiRevision: undefined,
    });

    const failing = createDesktopHarness({
      getRepoRoot: () => {
        throw new Error('status failed');
      },
    });
    const failingRes = createJsonResponse();
    failing.statusHandler({}, failingRes);
    expect(logErrorMock).toHaveBeenCalledWith('request handler error', expect.objectContaining({
      message: 'status failed',
    }));
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'Error: status failed' });
  });

  it('streams desktop events, snapshots, invalidations, warnings, and heartbeats', async () => {
    vi.useFakeTimers();
    const { eventsHandler } = createDesktopHarness();
    const unsubscribe = vi.fn();
    let appEventHandler: ((event: unknown) => void) | undefined;
    subscribeAppEventsMock.mockImplementation((handler: (event: unknown) => void) => {
      appEventHandler = handler;
      return unsubscribe;
    });
    streamSnapshotEventsMock.mockImplementation(async (topics: string[], { buildEvents, writeEvent }: {
      buildEvents: (topic: string) => Promise<unknown[]>;
      writeEvent: (event: unknown) => void;
    }) => {
      for (const topic of topics) {
        for (const event of await buildEvents(topic)) {
          writeEvent(event);
        }
      }
      for (const event of await buildEvents('runs')) {
        writeEvent(event);
      }
      for (const event of await buildEvents('unknown')) {
        writeEvent(event);
      }
    });

    const req = Object.assign(new EventEmitter(), { headers: {} });
    const res = createStreamResponse();

    await eventsHandler(req, res);
    await flushAsyncWork();

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache');
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive');
    expect(res.setHeader).toHaveBeenCalledWith('X-Accel-Buffering', 'no');
    expect(res.flushHeaders).toHaveBeenCalledTimes(1);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'sessions_snapshot', sessions: [{ id: 'conversation-1' }] })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'tasks_snapshot', tasks: [{ id: 'task-1' }] })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'daemon_snapshot', state: { running: true } })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'web_ui_snapshot', state: { installed: true } })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'runs_snapshot', result: { runs: [{ runId: 'run-1' }] } })}\n\n`);

    appEventHandler?.({ type: 'session_meta_changed', sessionId: 'session-1' });
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'session_meta_changed', sessionId: 'session-1' })}\n\n`);

    appEventHandler?.({ type: 'invalidate', topics: ['sessions', 'runs'] });
    await flushAsyncWork();
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'invalidate', topics: ['sessions', 'runs'] })}\n\n`);

    streamSnapshotEventsMock.mockImplementationOnce(async () => {
      throw new Error('snapshot failed');
    });
    appEventHandler?.({ type: 'invalidate', topics: ['sessions'] });
    await flushAsyncWork();
    await flushAsyncWork();
    expect(logWarnMock).toHaveBeenCalledWith('app event stream write failed', expect.objectContaining({
      message: 'snapshot failed',
    }));

    await vi.advanceTimersByTimeAsync(15_000);
    expect(res.write).toHaveBeenCalledWith(': heartbeat\n\n');

    req.emit('close');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    const writeCountBeforeClose = res.write.mock.calls.length;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(res.write.mock.calls).toHaveLength(writeCountBeforeClose);
  });
});
