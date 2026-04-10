import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: vi.fn(),
  },
  protocol: {
    registerSchemesAsPrivileged: vi.fn(),
    handle: vi.fn(),
  },
  session: {
    fromPartition: vi.fn(() => ({
      protocol: {
        handle: vi.fn(),
      },
    })),
  },
}));

import type { LocalBackendProcesses } from '../backend/local-backend-processes.js';
import type { LocalApiModule } from '../local-api-module.js';
import { LocalHostController } from './local-host-controller.js';

function createLocalApiModuleMock(overrides: Partial<LocalApiModule> = {}): LocalApiModule {
  return {
    invokeDesktopLocalApi: vi.fn(),
    dispatchDesktopLocalApiRequest: vi.fn(),
    readDesktopActivity: vi.fn(),
    readDesktopActivityById: vi.fn(),
    markDesktopActivityRead: vi.fn(),
    readDesktopActivityCount: vi.fn(),
    clearDesktopInbox: vi.fn(),
    startDesktopActivityConversation: vi.fn(),
    markDesktopConversationAttention: vi.fn(),
    readDesktopAlerts: vi.fn(),
    acknowledgeDesktopAlert: vi.fn(),
    dismissDesktopAlert: vi.fn(),
    snoozeDesktopAlert: vi.fn(),
    readDesktopScheduledTasks: vi.fn(),
    readDesktopScheduledTaskDetail: vi.fn(),
    readDesktopScheduledTaskLog: vi.fn(),
    createDesktopScheduledTask: vi.fn(),
    updateDesktopScheduledTask: vi.fn(),
    runDesktopScheduledTask: vi.fn(),
    readDesktopDurableRuns: vi.fn(),
    readDesktopDurableRun: vi.fn(),
    readDesktopDurableRunLog: vi.fn(),
    cancelDesktopDurableRun: vi.fn(),
    readDesktopConversationBootstrap: vi.fn(),
    renameDesktopConversation: vi.fn(),
    changeDesktopConversationCwd: vi.fn(),
    recoverDesktopConversation: vi.fn(),
    readDesktopConversationModelPreferences: vi.fn(),
    updateDesktopConversationModelPreferences: vi.fn(),
    readDesktopLiveSession: vi.fn(),
    readDesktopLiveSessionForkEntries: vi.fn(),
    readDesktopLiveSessionContext: vi.fn(),
    readDesktopSessionDetail: vi.fn(),
    readDesktopSessionBlock: vi.fn(),
    createDesktopLiveSession: vi.fn(),
    resumeDesktopLiveSession: vi.fn(),
    submitDesktopLiveSessionPrompt: vi.fn(),
    takeOverDesktopLiveSession: vi.fn(),
    restoreDesktopQueuedLiveSessionMessage: vi.fn(),
    compactDesktopLiveSession: vi.fn(),
    exportDesktopLiveSession: vi.fn(),
    reloadDesktopLiveSession: vi.fn(),
    destroyDesktopLiveSession: vi.fn(),
    branchDesktopLiveSession: vi.fn(),
    forkDesktopLiveSession: vi.fn(),
    summarizeAndForkDesktopLiveSession: vi.fn(),
    abortDesktopLiveSession: vi.fn(),
    subscribeDesktopLocalApiStream: vi.fn(),
    subscribeDesktopAppEvents: vi.fn(),
    ...overrides,
  } as LocalApiModule;
}

function createBackendMock(): LocalBackendProcesses {
  return {
    ensureStarted: vi.fn(),
    getStatus: vi.fn(),
    restart: vi.fn(),
    stop: vi.fn(),
  } as unknown as LocalBackendProcesses;
}

describe('LocalHostController', () => {
  it('routes live-session mutations through the local API module without booting the web child', async () => {
    const invokeDesktopLocalApi = vi.fn().mockResolvedValue({ ok: true, accepted: true });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      invokeDesktopLocalApi,
    }));
    const backend = createBackendMock();

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.invokeLocalApi('POST', '/api/live-sessions/live-1/prompt', {
      text: 'hello',
      surfaceId: 'surface-1',
    })).resolves.toEqual({ ok: true, accepted: true });

    expect(loadLocalApi).toHaveBeenCalledTimes(1);
    expect(invokeDesktopLocalApi).toHaveBeenCalledWith({
      method: 'POST',
      path: '/api/live-sessions/live-1/prompt',
      body: {
        text: 'hello',
        surfaceId: 'surface-1',
      },
    });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes inbox activity and alert capabilities through the local API module without loopback proxying', async () => {
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopActivity: vi.fn().mockResolvedValue([{ id: 'activity-1' }]),
      readDesktopActivityById: vi.fn().mockResolvedValue({ id: 'activity-1' }),
      markDesktopActivityRead: vi.fn().mockResolvedValue({ ok: true }),
      readDesktopActivityCount: vi.fn().mockResolvedValue({ count: 1 }),
      clearDesktopInbox: vi.fn().mockResolvedValue({ ok: true, deletedActivityIds: [], clearedConversationIds: [] }),
      startDesktopActivityConversation: vi.fn().mockResolvedValue({ id: 'conversation-1' }),
      markDesktopConversationAttention: vi.fn().mockResolvedValue({ ok: true }),
      readDesktopAlerts: vi.fn().mockResolvedValue({ entries: [], activeCount: 0 }),
      acknowledgeDesktopAlert: vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1' } }),
      dismissDesktopAlert: vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1' } }),
      snoozeDesktopAlert: vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1' }, resume: { id: 'resume-1' } }),
    }));
    const backend = createBackendMock();
    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.readActivity?.()).resolves.toEqual([{ id: 'activity-1' }]);
    await expect(controller.readActivityById?.('activity-1')).resolves.toEqual({ id: 'activity-1' });
    await expect(controller.markActivityRead?.({ activityId: 'activity-1', read: true })).resolves.toEqual({ ok: true });
    await expect(controller.readActivityCount?.()).resolves.toEqual({ count: 1 });
    await expect(controller.clearInbox?.()).resolves.toEqual({ ok: true, deletedActivityIds: [], clearedConversationIds: [] });
    await expect(controller.startActivityConversation?.('activity-1')).resolves.toEqual({ id: 'conversation-1' });
    await expect(controller.markConversationAttention?.({ conversationId: 'conversation-1', read: true })).resolves.toEqual({ ok: true });
    await expect(controller.readAlerts?.()).resolves.toEqual({ entries: [], activeCount: 0 });
    await expect(controller.acknowledgeAlert?.('alert-1')).resolves.toEqual({ ok: true, alert: { id: 'alert-1' } });
    await expect(controller.dismissAlert?.('alert-1')).resolves.toEqual({ ok: true, alert: { id: 'alert-1' } });
    await expect(controller.snoozeAlert?.({ alertId: 'alert-1', delay: '15m' })).resolves.toEqual({ ok: true, alert: { id: 'alert-1' }, resume: { id: 'resume-1' } });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes live-session event streams through the local API module without loopback proxying', async () => {
    const unsubscribe = vi.fn();
    const subscribeDesktopLocalApiStream = vi.fn().mockResolvedValue(unsubscribe);
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      subscribeDesktopLocalApiStream,
    }));
    const backend = createBackendMock();

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );
    const onEvent = vi.fn();

    await expect(controller.subscribeApiStream('/api/live-sessions/live-1/events?tailBlocks=20', onEvent)).resolves.toBe(unsubscribe);

    expect(loadLocalApi).toHaveBeenCalledTimes(1);
    expect(subscribeDesktopLocalApiStream).toHaveBeenCalledWith('/api/live-sessions/live-1/events?tailBlocks=20', onEvent);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes dedicated inbox and alert capabilities through the local API module without loopback proxying', async () => {
    const readDesktopActivity = vi.fn().mockResolvedValue([{ id: 'activity-1', read: false }]);
    const readDesktopActivityById = vi.fn().mockResolvedValue({ id: 'activity-1', read: false });
    const markDesktopActivityRead = vi.fn().mockResolvedValue({ ok: true });
    const readDesktopActivityCount = vi.fn().mockResolvedValue({ count: 1 });
    const clearDesktopInbox = vi.fn().mockResolvedValue({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: [] });
    const startDesktopActivityConversation = vi.fn().mockResolvedValue({ activityId: 'activity-1', id: 'conversation-1', sessionFile: '/tmp/conversation-1.jsonl', cwd: '/repo', relatedConversationIds: ['conversation-1'] });
    const markDesktopConversationAttention = vi.fn().mockResolvedValue({ ok: true });
    const readDesktopAlerts = vi.fn().mockResolvedValue({ entries: [{ id: 'alert-1', status: 'active' }], activeCount: 1 });
    const acknowledgeDesktopAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' } });
    const dismissDesktopAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'dismissed' } });
    const snoozeDesktopAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' }, resume: { id: 'resume-1' } });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopActivity,
      readDesktopActivityById,
      markDesktopActivityRead,
      readDesktopActivityCount,
      clearDesktopInbox,
      startDesktopActivityConversation,
      markDesktopConversationAttention,
      readDesktopAlerts,
      acknowledgeDesktopAlert,
      dismissDesktopAlert,
      snoozeDesktopAlert,
    }));
    const backend = createBackendMock();

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.readActivity?.()).resolves.toEqual([{ id: 'activity-1', read: false }]);
    await expect(controller.readActivityById?.('activity-1')).resolves.toEqual({ id: 'activity-1', read: false });
    await expect(controller.markActivityRead?.({ activityId: 'activity-1', read: false })).resolves.toEqual({ ok: true });
    await expect(controller.readActivityCount?.()).resolves.toEqual({ count: 1 });
    await expect(controller.clearInbox?.()).resolves.toEqual({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: [] });
    await expect(controller.startActivityConversation?.('activity-1')).resolves.toEqual({ activityId: 'activity-1', id: 'conversation-1', sessionFile: '/tmp/conversation-1.jsonl', cwd: '/repo', relatedConversationIds: ['conversation-1'] });
    await expect(controller.markConversationAttention?.({ conversationId: 'conversation-1', read: false })).resolves.toEqual({ ok: true });
    await expect(controller.readAlerts?.()).resolves.toEqual({ entries: [{ id: 'alert-1', status: 'active' }], activeCount: 1 });
    await expect(controller.acknowledgeAlert?.('alert-1')).resolves.toEqual({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' } });
    await expect(controller.dismissAlert?.('alert-1')).resolves.toEqual({ ok: true, alert: { id: 'alert-1', status: 'dismissed' } });
    await expect(controller.snoozeAlert?.({ alertId: 'alert-1', delay: '15m' })).resolves.toEqual({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' }, resume: { id: 'resume-1' } });

    expect(readDesktopActivity).toHaveBeenCalledTimes(1);
    expect(readDesktopActivityById).toHaveBeenCalledWith('activity-1');
    expect(markDesktopActivityRead).toHaveBeenCalledWith({ activityId: 'activity-1', read: false });
    expect(readDesktopActivityCount).toHaveBeenCalledTimes(1);
    expect(clearDesktopInbox).toHaveBeenCalledTimes(1);
    expect(startDesktopActivityConversation).toHaveBeenCalledWith('activity-1');
    expect(markDesktopConversationAttention).toHaveBeenCalledWith({ conversationId: 'conversation-1', read: false });
    expect(readDesktopAlerts).toHaveBeenCalledTimes(1);
    expect(acknowledgeDesktopAlert).toHaveBeenCalledWith('alert-1');
    expect(dismissDesktopAlert).toHaveBeenCalledWith('alert-1');
    expect(snoozeDesktopAlert).toHaveBeenCalledWith({ alertId: 'alert-1', delay: '15m' });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes dedicated inbox and alert capabilities through the local API module without loopback proxying', async () => {
    const readDesktopActivity = vi.fn().mockResolvedValue([{ id: 'activity-1', read: false }]);
    const readDesktopActivityById = vi.fn().mockResolvedValue({ id: 'activity-1', read: false });
    const markDesktopActivityRead = vi.fn().mockResolvedValue({ ok: true });
    const readDesktopActivityCount = vi.fn().mockResolvedValue({ count: 1 });
    const clearDesktopInbox = vi.fn().mockResolvedValue({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: ['conversation-1'] });
    const startDesktopActivityConversation = vi.fn().mockResolvedValue({ activityId: 'activity-1', id: 'live-1', sessionFile: '/tmp/live-1.jsonl', cwd: '/repo', relatedConversationIds: ['live-1'] });
    const markDesktopConversationAttention = vi.fn().mockResolvedValue({ ok: true });
    const readDesktopAlerts = vi.fn().mockResolvedValue({ entries: [{ id: 'alert-1' }], activeCount: 1 });
    const acknowledgeDesktopAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' } });
    const dismissDesktopAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'dismissed' } });
    const snoozeDesktopAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' }, resume: { id: 'resume-1' } });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopActivity,
      readDesktopActivityById,
      markDesktopActivityRead,
      readDesktopActivityCount,
      clearDesktopInbox,
      startDesktopActivityConversation,
      markDesktopConversationAttention,
      readDesktopAlerts,
      acknowledgeDesktopAlert,
      dismissDesktopAlert,
      snoozeDesktopAlert,
    }));
    const backend = createBackendMock();

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.readActivity?.()).resolves.toEqual([{ id: 'activity-1', read: false }]);
    await expect(controller.readActivityById?.('activity-1')).resolves.toEqual({ id: 'activity-1', read: false });
    await expect(controller.markActivityRead?.({ activityId: 'activity-1', read: true })).resolves.toEqual({ ok: true });
    await expect(controller.readActivityCount?.()).resolves.toEqual({ count: 1 });
    await expect(controller.clearInbox?.()).resolves.toEqual({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: ['conversation-1'] });
    await expect(controller.startActivityConversation?.('activity-1')).resolves.toEqual({ activityId: 'activity-1', id: 'live-1', sessionFile: '/tmp/live-1.jsonl', cwd: '/repo', relatedConversationIds: ['live-1'] });
    await expect(controller.markConversationAttention?.({ conversationId: 'conversation-1', read: false })).resolves.toEqual({ ok: true });
    await expect(controller.readAlerts?.()).resolves.toEqual({ entries: [{ id: 'alert-1' }], activeCount: 1 });
    await expect(controller.acknowledgeAlert?.('alert-1')).resolves.toEqual({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' } });
    await expect(controller.dismissAlert?.('alert-1')).resolves.toEqual({ ok: true, alert: { id: 'alert-1', status: 'dismissed' } });
    await expect(controller.snoozeAlert?.({ alertId: 'alert-1', delay: '15m' })).resolves.toEqual({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' }, resume: { id: 'resume-1' } });

    expect(readDesktopActivity).toHaveBeenCalledTimes(1);
    expect(readDesktopActivityById).toHaveBeenCalledWith('activity-1');
    expect(markDesktopActivityRead).toHaveBeenCalledWith({ activityId: 'activity-1', read: true });
    expect(readDesktopActivityCount).toHaveBeenCalledTimes(1);
    expect(clearDesktopInbox).toHaveBeenCalledTimes(1);
    expect(startDesktopActivityConversation).toHaveBeenCalledWith('activity-1');
    expect(markDesktopConversationAttention).toHaveBeenCalledWith({ conversationId: 'conversation-1', read: false });
    expect(readDesktopAlerts).toHaveBeenCalledTimes(1);
    expect(acknowledgeDesktopAlert).toHaveBeenCalledWith('alert-1');
    expect(dismissDesktopAlert).toHaveBeenCalledWith('alert-1');
    expect(snoozeDesktopAlert).toHaveBeenCalledWith({ alertId: 'alert-1', delay: '15m' });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes dedicated notification capabilities through the local API module without loopback proxying', async () => {
    const readDesktopActivity = vi.fn().mockResolvedValue([{ id: 'activity-1', read: false }]);
    const readDesktopActivityById = vi.fn().mockResolvedValue({ id: 'activity-1', read: true });
    const markDesktopActivityRead = vi.fn().mockResolvedValue({ ok: true });
    const readDesktopActivityCount = vi.fn().mockResolvedValue({ count: 1 });
    const clearDesktopInbox = vi.fn().mockResolvedValue({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: ['conversation-1'] });
    const startDesktopActivityConversation = vi.fn().mockResolvedValue({
      activityId: 'activity-1',
      id: 'conversation-1',
      sessionFile: '/tmp/conversation-1.jsonl',
      cwd: '/repo',
      relatedConversationIds: ['conversation-1'],
    });
    const markDesktopConversationAttention = vi.fn().mockResolvedValue({ ok: true });
    const readDesktopAlerts = vi.fn().mockResolvedValue({ entries: [{ id: 'alert-1' }], activeCount: 1 });
    const acknowledgeDesktopAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' } });
    const dismissDesktopAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'dismissed' } });
    const snoozeDesktopAlert = vi.fn().mockResolvedValue({
      ok: true,
      alert: { id: 'alert-1', status: 'acknowledged' },
      resume: { id: 'resume-1', dueAt: '2026-04-10T12:15:00.000Z' },
    });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopActivity,
      readDesktopActivityById,
      markDesktopActivityRead,
      readDesktopActivityCount,
      clearDesktopInbox,
      startDesktopActivityConversation,
      markDesktopConversationAttention,
      readDesktopAlerts,
      acknowledgeDesktopAlert,
      dismissDesktopAlert,
      snoozeDesktopAlert,
    }));
    const backend = createBackendMock();

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.readActivity?.()).resolves.toEqual([{ id: 'activity-1', read: false }]);
    await expect(controller.readActivityById?.('activity-1')).resolves.toEqual({ id: 'activity-1', read: true });
    await expect(controller.markActivityRead?.({ activityId: 'activity-1', read: false })).resolves.toEqual({ ok: true });
    await expect(controller.readActivityCount?.()).resolves.toEqual({ count: 1 });
    await expect(controller.clearInbox?.()).resolves.toEqual({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: ['conversation-1'] });
    await expect(controller.startActivityConversation?.('activity-1')).resolves.toEqual({
      activityId: 'activity-1',
      id: 'conversation-1',
      sessionFile: '/tmp/conversation-1.jsonl',
      cwd: '/repo',
      relatedConversationIds: ['conversation-1'],
    });
    await expect(controller.markConversationAttention?.({ conversationId: 'conversation-1', read: false })).resolves.toEqual({ ok: true });
    await expect(controller.readAlerts?.()).resolves.toEqual({ entries: [{ id: 'alert-1' }], activeCount: 1 });
    await expect(controller.acknowledgeAlert?.('alert-1')).resolves.toEqual({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' } });
    await expect(controller.dismissAlert?.('alert-1')).resolves.toEqual({ ok: true, alert: { id: 'alert-1', status: 'dismissed' } });
    await expect(controller.snoozeAlert?.({ alertId: 'alert-1', delay: '15m' })).resolves.toEqual({
      ok: true,
      alert: { id: 'alert-1', status: 'acknowledged' },
      resume: { id: 'resume-1', dueAt: '2026-04-10T12:15:00.000Z' },
    });

    expect(readDesktopActivity).toHaveBeenCalledTimes(1);
    expect(readDesktopActivityById).toHaveBeenCalledWith('activity-1');
    expect(markDesktopActivityRead).toHaveBeenCalledWith({ activityId: 'activity-1', read: false });
    expect(readDesktopActivityCount).toHaveBeenCalledTimes(1);
    expect(clearDesktopInbox).toHaveBeenCalledTimes(1);
    expect(startDesktopActivityConversation).toHaveBeenCalledWith('activity-1');
    expect(markDesktopConversationAttention).toHaveBeenCalledWith({ conversationId: 'conversation-1', read: false });
    expect(readDesktopAlerts).toHaveBeenCalledTimes(1);
    expect(acknowledgeDesktopAlert).toHaveBeenCalledWith('alert-1');
    expect(dismissDesktopAlert).toHaveBeenCalledWith('alert-1');
    expect(snoozeDesktopAlert).toHaveBeenCalledWith({ alertId: 'alert-1', delay: '15m' });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes dedicated conversation and live-session capabilities through the local API module without loopback proxying', async () => {
    const readDesktopDurableRuns = vi.fn().mockResolvedValue({ scannedAt: '2026-04-10T11:00:00.000Z', runsRoot: '/runs', summary: { total: 0, recoveryActions: {}, statuses: {} }, runs: [] });
    const readDesktopDurableRun = vi.fn().mockResolvedValue({ scannedAt: '2026-04-10T11:00:00.000Z', runsRoot: '/runs', run: { runId: 'run-1' } });
    const readDesktopDurableRunLog = vi.fn().mockResolvedValue({ path: '/runs/run-1.log', log: 'tail' });
    const cancelDesktopDurableRun = vi.fn().mockResolvedValue({ cancelled: true, runId: 'run-1' });
    const readDesktopConversationBootstrap = vi.fn().mockResolvedValue({
      conversationId: 'live-1',
      sessionDetail: null,
      liveSession: { live: true, id: 'live-1' },
    });
    const renameDesktopConversation = vi.fn().mockResolvedValue({ ok: true, title: 'Renamed conversation' });
    const recoverDesktopConversation = vi.fn().mockResolvedValue({
      conversationId: 'live-1',
      live: true,
      recovered: true,
      replayedPendingOperation: false,
      usedFallbackPrompt: true,
    });
    const readDesktopLiveSession = vi.fn().mockResolvedValue({ live: true, id: 'live-1' });
    const readDesktopLiveSessionForkEntries = vi.fn().mockResolvedValue([{ entryId: 'entry-1', text: 'fork from here' }]);
    const readDesktopLiveSessionContext = vi.fn().mockResolvedValue({ cwd: '/repo', branch: 'main', git: null });
    const readDesktopSessionDetail = vi.fn().mockResolvedValue({ meta: { id: 'live-1' }, blocks: [], blockOffset: 0, totalBlocks: 0, contextUsage: null });
    const readDesktopSessionBlock = vi.fn().mockResolvedValue({ id: 'block-1', type: 'text', text: 'hello' });
    const createDesktopLiveSession = vi.fn().mockResolvedValue({ id: 'live-1', sessionFile: '/tmp/live-1.jsonl' });
    const resumeDesktopLiveSession = vi.fn().mockResolvedValue({ id: 'live-1' });
    const submitDesktopLiveSessionPrompt = vi.fn().mockResolvedValue({
      ok: true,
      accepted: true,
      delivery: 'started',
      referencedTaskIds: [],
      referencedMemoryDocIds: [],
      referencedVaultFileIds: [],
      referencedAttachmentIds: [],
    });
    const takeOverDesktopLiveSession = vi.fn().mockResolvedValue({ controllerSurfaceId: 'surface-1' });
    const restoreDesktopQueuedLiveSessionMessage = vi.fn().mockResolvedValue({ ok: true, text: 'queued hello', images: [] });
    const compactDesktopLiveSession = vi.fn().mockResolvedValue({ ok: true, result: { compacted: true } });
    const exportDesktopLiveSession = vi.fn().mockResolvedValue({ ok: true, path: '/tmp/live-1.html' });
    const reloadDesktopLiveSession = vi.fn().mockResolvedValue({ ok: true });
    const destroyDesktopLiveSession = vi.fn().mockResolvedValue({ ok: true });
    const branchDesktopLiveSession = vi.fn().mockResolvedValue({ newSessionId: 'branch-1', sessionFile: '/tmp/branch-1.jsonl' });
    const forkDesktopLiveSession = vi.fn().mockResolvedValue({ newSessionId: 'fork-1', sessionFile: '/tmp/fork-1.jsonl' });
    const summarizeAndForkDesktopLiveSession = vi.fn().mockResolvedValue({ newSessionId: 'summary-1', sessionFile: '/tmp/summary-1.jsonl' });
    const abortDesktopLiveSession = vi.fn().mockResolvedValue({ ok: true });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopDurableRuns,
      readDesktopDurableRun,
      readDesktopDurableRunLog,
      cancelDesktopDurableRun,
      readDesktopConversationBootstrap,
      renameDesktopConversation,
      recoverDesktopConversation,
      readDesktopLiveSession,
      readDesktopLiveSessionForkEntries,
      readDesktopLiveSessionContext,
      readDesktopSessionDetail,
      readDesktopSessionBlock,
      createDesktopLiveSession,
      resumeDesktopLiveSession,
      submitDesktopLiveSessionPrompt,
      takeOverDesktopLiveSession,
      restoreDesktopQueuedLiveSessionMessage,
      compactDesktopLiveSession,
      exportDesktopLiveSession,
      reloadDesktopLiveSession,
      destroyDesktopLiveSession,
      branchDesktopLiveSession,
      forkDesktopLiveSession,
      summarizeAndForkDesktopLiveSession,
      abortDesktopLiveSession,
    }));
    const backend = createBackendMock();

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.readDurableRuns?.()).resolves.toMatchObject({ runsRoot: '/runs' });
    await expect(controller.readDurableRun?.('run-1')).resolves.toMatchObject({ runsRoot: '/runs' });
    await expect(controller.readDurableRunLog?.({ runId: 'run-1', tail: 25 })).resolves.toEqual({ path: '/runs/run-1.log', log: 'tail' });
    await expect(controller.cancelDurableRun?.('run-1')).resolves.toEqual({ cancelled: true, runId: 'run-1' });
    await expect(controller.readConversationBootstrap?.({ conversationId: 'live-1', tailBlocks: 12 })).resolves.toEqual({
      conversationId: 'live-1',
      sessionDetail: null,
      liveSession: { live: true, id: 'live-1' },
    });
    await expect(controller.renameConversation?.({ conversationId: 'live-1', name: 'Renamed conversation', surfaceId: 'surface-1' })).resolves.toEqual({
      ok: true,
      title: 'Renamed conversation',
    });
    await expect(controller.recoverConversation?.('conversation-1')).resolves.toEqual({
      conversationId: 'live-1',
      live: true,
      recovered: true,
      replayedPendingOperation: false,
      usedFallbackPrompt: true,
    });
    await expect(controller.readLiveSession?.('live-1')).resolves.toEqual({ live: true, id: 'live-1' });
    await expect(controller.readLiveSessionForkEntries?.('live-1')).resolves.toEqual([{ entryId: 'entry-1', text: 'fork from here' }]);
    await expect(controller.readLiveSessionContext?.('live-1')).resolves.toEqual({ cwd: '/repo', branch: 'main', git: null });
    await expect(controller.readSessionDetail?.({ sessionId: 'live-1', tailBlocks: 24 })).resolves.toEqual({
      meta: { id: 'live-1' },
      blocks: [],
      blockOffset: 0,
      totalBlocks: 0,
      contextUsage: null,
    });
    await expect(controller.readSessionBlock?.({ sessionId: 'live-1', blockId: 'block-1' })).resolves.toEqual({
      id: 'block-1',
      type: 'text',
      text: 'hello',
    });
    await expect(controller.createLiveSession?.({ cwd: '/repo', model: 'gpt-5.4' })).resolves.toEqual({
      id: 'live-1',
      sessionFile: '/tmp/live-1.jsonl',
    });
    await expect(controller.resumeLiveSession?.('/tmp/live-1.jsonl')).resolves.toEqual({ id: 'live-1' });
    await expect(controller.takeOverLiveSession?.({ conversationId: 'live-1', surfaceId: 'surface-1' })).resolves.toEqual({
      controllerSurfaceId: 'surface-1',
    });
    await expect(controller.submitLiveSessionPrompt?.({
      conversationId: 'live-1',
      text: 'hello',
      surfaceId: 'surface-1',
    })).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'started' }));
    await expect(controller.restoreQueuedLiveSessionMessage?.({ conversationId: 'live-1', behavior: 'followUp', index: 0 })).resolves.toEqual({ ok: true, text: 'queued hello', images: [] });
    await expect(controller.compactLiveSession?.({ conversationId: 'live-1', customInstructions: 'be shorter' })).resolves.toEqual({ ok: true, result: { compacted: true } });
    await expect(controller.exportLiveSession?.({ conversationId: 'live-1', outputPath: '/tmp/live-1.html' })).resolves.toEqual({ ok: true, path: '/tmp/live-1.html' });
    await expect(controller.reloadLiveSession?.('live-1')).resolves.toEqual({ ok: true });
    await expect(controller.destroyLiveSession?.('live-1')).resolves.toEqual({ ok: true });
    await expect(controller.branchLiveSession?.({ conversationId: 'live-1', entryId: 'entry-1' })).resolves.toEqual({ newSessionId: 'branch-1', sessionFile: '/tmp/branch-1.jsonl' });
    await expect(controller.forkLiveSession?.({ conversationId: 'live-1', entryId: 'entry-1', preserveSource: true })).resolves.toEqual({ newSessionId: 'fork-1', sessionFile: '/tmp/fork-1.jsonl' });
    await expect(controller.summarizeAndForkLiveSession?.('live-1')).resolves.toEqual({ newSessionId: 'summary-1', sessionFile: '/tmp/summary-1.jsonl' });
    await expect(controller.abortLiveSession?.('live-1')).resolves.toEqual({ ok: true });

    expect(readDesktopDurableRuns).toHaveBeenCalledTimes(1);
    expect(readDesktopDurableRun).toHaveBeenCalledWith('run-1');
    expect(readDesktopDurableRunLog).toHaveBeenCalledWith({ runId: 'run-1', tail: 25 });
    expect(cancelDesktopDurableRun).toHaveBeenCalledWith('run-1');
    expect(readDesktopConversationBootstrap).toHaveBeenCalledWith({ conversationId: 'live-1', tailBlocks: 12 });
    expect(renameDesktopConversation).toHaveBeenCalledWith({ conversationId: 'live-1', name: 'Renamed conversation', surfaceId: 'surface-1' });
    expect(recoverDesktopConversation).toHaveBeenCalledWith('conversation-1');
    expect(readDesktopLiveSession).toHaveBeenCalledWith('live-1');
    expect(readDesktopLiveSessionForkEntries).toHaveBeenCalledWith('live-1');
    expect(readDesktopLiveSessionContext).toHaveBeenCalledWith('live-1');
    expect(readDesktopSessionDetail).toHaveBeenCalledWith({ sessionId: 'live-1', tailBlocks: 24 });
    expect(readDesktopSessionBlock).toHaveBeenCalledWith({ sessionId: 'live-1', blockId: 'block-1' });
    expect(createDesktopLiveSession).toHaveBeenCalledWith({ cwd: '/repo', model: 'gpt-5.4' });
    expect(resumeDesktopLiveSession).toHaveBeenCalledWith('/tmp/live-1.jsonl');
    expect(takeOverDesktopLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', surfaceId: 'surface-1' });
    expect(submitDesktopLiveSessionPrompt).toHaveBeenCalledWith({
      conversationId: 'live-1',
      text: 'hello',
      surfaceId: 'surface-1',
    });
    expect(restoreDesktopQueuedLiveSessionMessage).toHaveBeenCalledWith({ conversationId: 'live-1', behavior: 'followUp', index: 0 });
    expect(compactDesktopLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', customInstructions: 'be shorter' });
    expect(exportDesktopLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', outputPath: '/tmp/live-1.html' });
    expect(reloadDesktopLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1' });
    expect(destroyDesktopLiveSession).toHaveBeenCalledWith('live-1');
    expect(branchDesktopLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', entryId: 'entry-1' });
    expect(forkDesktopLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', entryId: 'entry-1', preserveSource: true });
    expect(summarizeAndForkDesktopLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1' });
    expect(abortDesktopLiveSession).toHaveBeenCalledWith('live-1');
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop app events through the local API module without loopback proxying', async () => {
    const unsubscribe = vi.fn();
    const subscribeDesktopAppEvents = vi.fn().mockResolvedValue(unsubscribe);
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      subscribeDesktopAppEvents,
    }));
    const backend = createBackendMock();

    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );
    const onEvent = vi.fn();

    await expect(controller.subscribeDesktopAppEvents?.(onEvent)).resolves.toBe(unsubscribe);

    expect(loadLocalApi).toHaveBeenCalledTimes(1);
    expect(subscribeDesktopAppEvents).toHaveBeenCalledWith(onEvent);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });
});
