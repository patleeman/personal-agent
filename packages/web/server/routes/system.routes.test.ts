import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getAlertSnapshotForProfileMock,
  listConversationSessionsSnapshotMock,
  listDurableRunsMock,
  logErrorMock,
  logWarnMock,
  readCompanionSessionMock,
  readDaemonStateMock,
  readWebUiStateMock,
  requestApplicationRestartMock,
  requestApplicationUpdateMock,
  streamSnapshotEventsMock,
  subscribeAppEventsMock,
  suppressMonitoredServiceAttentionMock,
} = vi.hoisted(() => ({
  getAlertSnapshotForProfileMock: vi.fn(),
  listConversationSessionsSnapshotMock: vi.fn(),
  listDurableRunsMock: vi.fn(),
  logErrorMock: vi.fn(),
  logWarnMock: vi.fn(),
  readCompanionSessionMock: vi.fn(),
  readDaemonStateMock: vi.fn(),
  readWebUiStateMock: vi.fn(),
  requestApplicationRestartMock: vi.fn(),
  requestApplicationUpdateMock: vi.fn(),
  streamSnapshotEventsMock: vi.fn(),
  subscribeAppEventsMock: vi.fn(),
  suppressMonitoredServiceAttentionMock: vi.fn(),
}));

vi.mock('../ui/applicationRestart.js', () => ({
  requestApplicationRestart: requestApplicationRestartMock,
  requestApplicationUpdate: requestApplicationUpdateMock,
}));

vi.mock('../ui/webUi.js', () => ({
  readWebUiState: readWebUiStateMock,
}));

vi.mock('../ui/companionAuth.js', () => ({
  readCompanionSession: readCompanionSessionMock,
}));

vi.mock('../automation/daemon.js', () => ({
  readDaemonState: readDaemonStateMock,
}));

vi.mock('../automation/alerts.js', () => ({
  getAlertSnapshotForProfile: getAlertSnapshotForProfileMock,
}));

vi.mock('../shared/appEvents.js', () => ({
  subscribeAppEvents: subscribeAppEventsMock,
}));

vi.mock('../shared/snapshotEventStreaming.js', () => ({
  streamSnapshotEvents: streamSnapshotEventsMock,
}));

vi.mock('../shared/internalAttention.js', () => ({
  suppressMonitoredServiceAttention: suppressMonitoredServiceAttentionMock,
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

import { registerCompanionSystemRoutes, registerSystemRoutes } from './system.js';

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
    getAlertSnapshotForProfileMock.mockReset();
    listConversationSessionsSnapshotMock.mockReset();
    listDurableRunsMock.mockReset();
    logErrorMock.mockReset();
    logWarnMock.mockReset();
    readCompanionSessionMock.mockReset();
    readDaemonStateMock.mockReset();
    readWebUiStateMock.mockReset();
    requestApplicationRestartMock.mockReset();
    requestApplicationUpdateMock.mockReset();
    streamSnapshotEventsMock.mockReset();
    subscribeAppEventsMock.mockReset();
    suppressMonitoredServiceAttentionMock.mockReset();

    getAlertSnapshotForProfileMock.mockReturnValue({ entries: [{ id: 'alert-1' }], activeCount: 1 });
    listConversationSessionsSnapshotMock.mockReturnValue([{ id: 'conversation-1' }]);
    listDurableRunsMock.mockResolvedValue({ runs: [{ runId: 'run-1' }] });
    readDaemonStateMock.mockResolvedValue({ running: true });
    readWebUiStateMock.mockReturnValue({ installed: true });
    streamSnapshotEventsMock.mockImplementation(async (topics: string[], { buildEvents, writeEvent }: {
      buildEvents: (topic: any) => Promise<unknown[]>;
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
    listActivityForCurrentProfile?: () => Array<{ read?: boolean }>;
    listTasksForCurrentProfile?: () => unknown[];
  }) {
    const handlers: Record<string, (req: any, res: any) => Promise<void> | void> = {};
    const router = {
      get: vi.fn((path: string, next: (req: any, res: any) => Promise<void> | void) => {
        handlers[`GET ${path}`] = next;
      }),
      post: vi.fn((path: string, next: (req: any, res: any) => Promise<void> | void) => {
        handlers[`POST ${path}`] = next;
      }),
    };

    registerSystemRoutes(router as never, {
      getCurrentProfile: options?.getCurrentProfile ?? (() => 'assistant'),
      getRepoRoot: options?.getRepoRoot ?? (() => '/repo'),
      listActivityForCurrentProfile: options?.listActivityForCurrentProfile ?? (() => [{ read: false }, { read: true }]),
      listTasksForCurrentProfile: options?.listTasksForCurrentProfile ?? (() => [{ id: 'task-1' }]),
    });

    return {
      eventsHandler: handlers['GET /api/events']!,
      statusHandler: handlers['GET /api/status']!,
      restartHandler: handlers['POST /api/application/restart']!,
      updateHandler: handlers['POST /api/application/update']!,
    };
  }

  function createCompanionHarness(options?: {
    getCurrentProfile?: () => string;
    getRepoRoot?: () => string;
    listActivityForCurrentProfile?: () => Array<{ read?: boolean }>;
    listTasksForCurrentProfile?: () => unknown[];
  }) {
    const handlers: Record<string, (req: any, res: any) => Promise<void> | void> = {};
    const router = {
      get: vi.fn((path: string, next: (req: any, res: any) => Promise<void> | void) => {
        handlers[`GET ${path}`] = next;
      }),
      post: vi.fn((path: string, next: (req: any, res: any) => Promise<void> | void) => {
        handlers[`POST ${path}`] = next;
      }),
    };

    registerCompanionSystemRoutes(router as never, {
      getCurrentProfile: options?.getCurrentProfile ?? (() => 'assistant'),
      getRepoRoot: options?.getRepoRoot ?? (() => '/repo'),
      listActivityForCurrentProfile: options?.listActivityForCurrentProfile ?? (() => [{ read: false }, { read: true }]),
      listTasksForCurrentProfile: options?.listTasksForCurrentProfile ?? (() => [{ id: 'task-1' }]),
    });

    return {
      eventsHandler: handlers['GET /api/events']!,
      restartHandler: handlers['POST /api/application/restart']!,
      updateHandler: handlers['POST /api/application/update']!,
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
      listActivityForCurrentProfile: () => [{ read: false }, { read: true }, {}],
    });
    const res = createJsonResponse();

    statusHandler({}, res);
    expect(res.json).toHaveBeenCalledWith({
      profile: 'datadog',
      repoRoot: '/worktree',
      activityCount: 3,
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

  it('restarts and updates the application with mapped error statuses', () => {
    const { restartHandler, updateHandler } = createDesktopHarness();
    requestApplicationRestartMock.mockReturnValue({ ok: true, kind: 'restart' });
    requestApplicationUpdateMock.mockReturnValue({ ok: true, kind: 'update' });

    const restartRes = createJsonResponse();
    restartHandler({}, restartRes);
    expect(suppressMonitoredServiceAttentionMock).toHaveBeenCalledWith('daemon', 10 * 60_000);
    expect(requestApplicationRestartMock).toHaveBeenCalledWith({ repoRoot: '/repo', profile: 'assistant' });
    expect(restartRes.status).toHaveBeenCalledWith(202);
    expect(restartRes.json).toHaveBeenCalledWith({ ok: true, kind: 'restart' });

    const updateRes = createJsonResponse();
    updateHandler({}, updateRes);
    expect(suppressMonitoredServiceAttentionMock).toHaveBeenCalledWith('daemon', 15 * 60_000);
    expect(requestApplicationUpdateMock).toHaveBeenCalledWith({ repoRoot: '/repo', profile: 'assistant' });
    expect(updateRes.status).toHaveBeenCalledWith(202);
    expect(updateRes.json).toHaveBeenCalledWith({ ok: true, kind: 'update' });

    requestApplicationRestartMock.mockImplementationOnce(() => {
      throw new Error('Application restart already in progress');
    });
    const conflictRes = createJsonResponse();
    restartHandler({}, conflictRes);
    expect(conflictRes.status).toHaveBeenCalledWith(409);
    expect(conflictRes.json).toHaveBeenCalledWith({ error: 'Application restart already in progress' });

    requestApplicationUpdateMock.mockImplementationOnce(() => {
      throw new Error('Managed web UI service is not installed');
    });
    const missingServiceRes = createJsonResponse();
    updateHandler({}, missingServiceRes);
    expect(missingServiceRes.status).toHaveBeenCalledWith(400);
    expect(missingServiceRes.json).toHaveBeenCalledWith({ error: 'Managed web UI service is not installed' });

    requestApplicationUpdateMock.mockImplementationOnce(() => {
      throw new Error('update failed');
    });
    const failingRes = createJsonResponse();
    updateHandler({}, failingRes);
    expect(failingRes.status).toHaveBeenCalledWith(500);
    expect(failingRes.json).toHaveBeenCalledWith({ error: 'update failed' });
  });

  it('streams desktop events, snapshots, invalidations, warnings, and heartbeats', async () => {
    vi.useFakeTimers();
    const { eventsHandler } = createDesktopHarness();
    const unsubscribe = vi.fn();
    let appEventHandler: ((event: any) => void) | undefined;
    subscribeAppEventsMock.mockImplementation((handler: (event: any) => void) => {
      appEventHandler = handler;
      return unsubscribe;
    });
    streamSnapshotEventsMock.mockImplementation(async (topics: string[], { buildEvents, writeEvent }: {
      buildEvents: (topic: any) => Promise<unknown[]>;
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
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'activity_snapshot', entries: [{ read: false }, { read: true }], unreadCount: 1 })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'alerts_snapshot', entries: [{ id: 'alert-1' }], activeCount: 1 })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'sessions_snapshot', sessions: [{ id: 'conversation-1' }] })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'tasks_snapshot', tasks: [{ id: 'task-1' }] })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'daemon_snapshot', state: { running: true } })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'web_ui_snapshot', state: { installed: true } })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'runs_snapshot', result: { runs: [{ runId: 'run-1' }] } })}\n\n`);

    appEventHandler?.({ type: 'session_meta_changed', sessionId: 'session-1' });
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'session_meta_changed', sessionId: 'session-1' })}\n\n`);

    appEventHandler?.({ type: 'invalidate', topics: ['activity', 'runs'] });
    await flushAsyncWork();
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'invalidate', topics: ['activity', 'runs'] })}\n\n`);

    streamSnapshotEventsMock.mockImplementationOnce(async () => {
      throw new Error('snapshot failed');
    });
    appEventHandler?.({ type: 'invalidate', topics: ['alerts'] });
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

  it('streams companion events, filters unsupported topics, checks the session cookie, and ends when auth expires', async () => {
    vi.useFakeTimers();
    const { eventsHandler } = createCompanionHarness();
    const unsubscribe = vi.fn();
    let appEventHandler: ((event: any) => void) | undefined;
    subscribeAppEventsMock.mockImplementation((handler: (event: any) => void) => {
      appEventHandler = handler;
      return unsubscribe;
    });
    readCompanionSessionMock.mockReturnValueOnce(true).mockReturnValueOnce(false);

    const req = Object.assign(new EventEmitter(), {
      headers: { cookie: 'foo=bar; pa_companion=session%3Dtoken' },
    });
    const res = createStreamResponse();

    await eventsHandler(req, res);
    await flushAsyncWork();

    appEventHandler?.({ type: 'invalidate', topics: ['runs'] });
    await flushAsyncWork();

    appEventHandler?.({ type: 'invalidate', topics: ['daemon', 'runs'] });
    await flushAsyncWork();
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'invalidate', topics: ['daemon'] })}\n\n`);

    appEventHandler?.({ type: 'live_title', sessionId: 'session-1', title: 'New title' });
    appEventHandler?.({ type: 'session_meta_changed', sessionId: 'session-1' });
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'live_title', sessionId: 'session-1', title: 'New title' })}\n\n`);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify({ type: 'session_meta_changed', sessionId: 'session-1' })}\n\n`);

    streamSnapshotEventsMock.mockImplementationOnce(async () => {
      throw new Error('companion snapshot failed');
    });
    appEventHandler?.({ type: 'invalidate', topics: ['alerts'] });
    await flushAsyncWork();
    expect(logWarnMock).toHaveBeenCalledWith('companion event stream write failed', expect.objectContaining({
      message: 'companion snapshot failed',
    }));

    await vi.advanceTimersByTimeAsync(15_000);
    expect(readCompanionSessionMock).toHaveBeenCalledWith('session=token', { surface: 'companion', touch: false });
    expect(res.write).toHaveBeenCalledWith(': heartbeat\n\n');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(res.end).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('treats a missing companion cookie as an empty session token', async () => {
    vi.useFakeTimers();
    const { eventsHandler } = createCompanionHarness();
    subscribeAppEventsMock.mockReturnValue(vi.fn());
    readCompanionSessionMock.mockReturnValue(false);

    const req = Object.assign(new EventEmitter(), { headers: {} });
    const res = createStreamResponse();

    await eventsHandler(req, res);
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(15_000);

    expect(readCompanionSessionMock).toHaveBeenCalledWith('', { surface: 'companion', touch: false });
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});
