import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationBootstrapState } from './types';

function createBootstrapState(overrides?: Partial<ConversationBootstrapState>): ConversationBootstrapState {
  return {
    conversationId: 'conversation-1',
    sessionDetail: null,
    liveSession: { live: false },
    ...overrides,
  };
}

function createJsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

describe('api desktop transport', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    vi.stubGlobal('window', {
      location: { pathname: '/' },
    });
  });

  it('uses the desktop local API bridge on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invokeLocalApi = vi.fn()
      .mockResolvedValueOnce({
        profile: 'assistant',
        repoRoot: '/repo',
        activityCount: 0,
        projectCount: 0,
      })
      .mockResolvedValueOnce({ ok: true });
    const readScheduledTasks = vi.fn().mockResolvedValue([{ id: 'task-1', scheduleType: 'cron', running: false, enabled: true, prompt: 'Prompt', title: 'Task 1' }]);
    const readScheduledTaskDetail = vi.fn().mockResolvedValue({ id: 'task-1', scheduleType: 'cron', running: false, enabled: true, prompt: 'Prompt body' });
    const readScheduledTaskLog = vi.fn().mockResolvedValue({ path: '/tasks/task-1.log', log: 'task tail' });
    const createScheduledTask = vi.fn().mockResolvedValue({ ok: true, task: { id: 'task-2', scheduleType: 'cron', running: false, enabled: true, prompt: 'Created task body' } });
    const updateScheduledTask = vi.fn().mockResolvedValue({ ok: true, task: { id: 'task-1', scheduleType: 'cron', running: false, enabled: false, prompt: 'Updated task body' } });
    const runScheduledTask = vi.fn().mockResolvedValue({ ok: true, accepted: true, runId: 'run-from-task' });
    const readDurableRuns = vi.fn().mockResolvedValue({ scannedAt: '2026-04-10T11:00:00.000Z', runsRoot: '/runs', summary: { total: 0, recoveryActions: {}, statuses: {} }, runs: [] });
    const readDurableRun = vi.fn().mockResolvedValue({ scannedAt: '2026-04-10T11:00:00.000Z', runsRoot: '/runs', run: { runId: 'run-1' } });
    const readDurableRunLog = vi.fn().mockResolvedValue({ path: '/runs/run-1.log', log: 'tail' });
    const cancelDurableRun = vi.fn().mockResolvedValue({ cancelled: true, runId: 'run-1' });
    const readConversationBootstrap = vi.fn().mockResolvedValue(createBootstrapState());
    const renameConversation = vi.fn().mockResolvedValue({ ok: true, title: 'Renamed conversation' });
    const changeConversationCwd = vi.fn().mockResolvedValue({ id: 'live-1', sessionFile: '/tmp/live-1.jsonl', cwd: '/next-repo', changed: true });
    const recoverConversation = vi.fn().mockResolvedValue({
      conversationId: 'live-1',
      live: true,
      recovered: true,
      replayedPendingOperation: false,
      usedFallbackPrompt: true,
    });
    const readLiveSessionForkEntries = vi.fn().mockResolvedValue([{ entryId: 'entry-1', text: 'fork from here' }]);
    const readConversationModelPreferences = vi.fn().mockResolvedValue({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high' });
    const updateConversationModelPreferences = vi.fn().mockResolvedValue({ currentModel: 'gpt-5.4', currentThinkingLevel: 'medium' });
    const readLiveSession = vi.fn().mockResolvedValue({ live: true, id: 'live-1' });
    const readLiveSessionContext = vi.fn().mockResolvedValue({ cwd: '/repo', branch: 'main', git: null });
    const readSessionDetail = vi.fn().mockResolvedValue({ meta: { id: 'live-1' }, blocks: [], blockOffset: 0, totalBlocks: 0, contextUsage: null });
    const readSessionBlock = vi.fn().mockResolvedValue({ id: 'block-1', type: 'text', text: 'hello' });
    const createLiveSession = vi.fn().mockResolvedValue({ id: 'live-1', sessionFile: '/tmp/live-1.jsonl' });
    const resumeLiveSession = vi.fn().mockResolvedValue({ id: 'live-1' });
    const takeOverLiveSession = vi.fn().mockResolvedValue({
      surfaces: [],
      controllerSurfaceId: 'surface-1',
      controllerSurfaceType: 'desktop_web',
      controllerAcquiredAt: '2026-04-04T00:00:00.000Z',
    });
    const submitLiveSessionPrompt = vi.fn().mockResolvedValue({ ok: true, accepted: true, delivery: 'started' });
    const restoreQueuedLiveSessionMessage = vi.fn().mockResolvedValue({ ok: true, text: 'queued hello', images: [] });
    const compactLiveSession = vi.fn().mockResolvedValue({ ok: true, result: { compacted: true } });
    const exportLiveSession = vi.fn().mockResolvedValue({ ok: true, path: '/tmp/live-1.html' });
    const reloadLiveSession = vi.fn().mockResolvedValue({ ok: true });
    const branchLiveSession = vi.fn().mockResolvedValue({ newSessionId: 'branch-1', sessionFile: '/tmp/branch-1.jsonl' });
    const forkLiveSession = vi.fn().mockResolvedValue({ newSessionId: 'fork-1', sessionFile: '/tmp/fork-1.jsonl' });
    const summarizeAndForkLiveSession = vi.fn().mockResolvedValue({ newSessionId: 'summary-1', sessionFile: '/tmp/summary-1.jsonl' });
    const abortLiveSession = vi.fn().mockResolvedValue({ ok: true });
    const destroyLiveSession = vi.fn().mockResolvedValue({ ok: true });
    const getEnvironment = vi.fn().mockResolvedValue({
      isElectron: true,
      activeHostId: 'local',
      activeHostLabel: 'Local',
      activeHostKind: 'local',
      activeHostSummary: 'Local backend is healthy.',
      canManageConnections: true,
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment,
        invokeLocalApi,
        readScheduledTasks,
        readScheduledTaskDetail,
        readScheduledTaskLog,
        createScheduledTask,
        updateScheduledTask,
        runScheduledTask,
        readDurableRuns,
        readDurableRun,
        readDurableRunLog,
        cancelDurableRun,
        readConversationBootstrap,
        renameConversation,
        changeConversationCwd,
        recoverConversation,
        readConversationModelPreferences,
        updateConversationModelPreferences,
        readLiveSession,
        readLiveSessionForkEntries,
        readLiveSessionContext,
        readSessionDetail,
        readSessionBlock,
        createLiveSession,
        resumeLiveSession,
        takeOverLiveSession,
        submitLiveSessionPrompt,
        restoreQueuedLiveSessionMessage,
        compactLiveSession,
        exportLiveSession,
        reloadLiveSession,
        branchLiveSession,
        forkLiveSession,
        summarizeAndForkLiveSession,
        abortLiveSession,
        destroyLiveSession,
      },
    });

    const { api } = await import('./api');
    const status = await api.status();
    const tasks = await api.tasks();
    const taskDetail = await api.taskDetail('task-1');
    const taskLog = await api.taskLog('task-1');
    const createdTask = await api.createTask({ title: 'Created task', prompt: 'Prompt body' });
    const toggledTask = await api.setTaskEnabled('task-1', false);
    const savedTask = await api.saveTask('task-1', { prompt: 'Updated task body' });
    const taskRun = await api.runTaskNow('task-1');
    const runs = await api.runs();
    const durableRun = await api.durableRun('run-1');
    const durableRunLog = await api.durableRunLog('run-1', 25);
    const cancelledRun = await api.cancelDurableRun('run-1');
    const bootstrap = await api.conversationBootstrap('conversation-1', {
      knownSessionSignature: 'sig-1',
      tailBlocks: 12,
    });
    const renamed = await api.renameConversation('conversation-1', 'Renamed conversation', 'surface-1');
    const changedCwd = await api.changeConversationCwd('live-1', '/next-repo', 'surface-1');
    const recovered = await api.recoverConversation('conversation-1');
    const modelPreferences = await api.conversationModelPreferences('live-1');
    const updatedModelPreferences = await api.updateConversationModelPreferences('live-1', { thinkingLevel: 'medium' }, 'surface-1');
    const live = await api.liveSession('live-1');
    const forkEntries = await api.forkEntries('live-1');
    const liveContext = await api.liveSessionContext('live-1');
    const sessionDetail = await api.sessionDetail('live-1', { tailBlocks: 24 });
    const sessionBlock = await api.sessionBlock('live-1', 'block-1');
    const created = await api.createLiveSession('/repo', undefined, { model: 'gpt-5.4' });
    const resumed = await api.resumeSession('/tmp/live-1.jsonl');
    const takeover = await api.takeoverLiveSession('live-1', 'surface-1');
    const prompted = await api.promptSession('live-1', 'hello', 'followUp', [], [], 'surface-1');
    const restored = await api.restoreQueuedMessage('live-1', { behavior: 'followUp', index: 0, previewId: 'queue-1' }, 'surface-1');
    const compacted = await api.compactSession('live-1', 'be shorter', 'surface-1');
    const exported = await api.exportSession('live-1', '/tmp/live-1.html');
    const reloaded = await api.reloadSession('live-1', 'surface-1');
    const branched = await api.branchSession('live-1', 'entry-1', 'surface-1');
    const forked = await api.forkSession('live-1', 'entry-1', { preserveSource: true }, 'surface-1');
    const summaryFork = await api.summarizeAndForkSession('live-1', 'surface-1');
    const aborted = await api.abortSession('live-1', 'surface-1');
    const destroyed = await api.destroySession('conversation-1', 'surface-1');

    expect(getEnvironment).toHaveBeenCalledTimes(1);
    expect(invokeLocalApi).toHaveBeenNthCalledWith(1, 'GET', '/api/status', undefined);
    expect(readScheduledTasks).toHaveBeenCalledTimes(1);
    expect(readScheduledTaskDetail).toHaveBeenCalledWith('task-1');
    expect(readScheduledTaskLog).toHaveBeenCalledWith('task-1');
    expect(createScheduledTask).toHaveBeenCalledWith({ title: 'Created task', prompt: 'Prompt body' });
    expect(updateScheduledTask).toHaveBeenCalledWith({ taskId: 'task-1', enabled: false });
    expect(updateScheduledTask).toHaveBeenCalledWith({ taskId: 'task-1', prompt: 'Updated task body' });
    expect(runScheduledTask).toHaveBeenCalledWith('task-1');
    expect(readDurableRuns).toHaveBeenCalledTimes(1);
    expect(readDurableRun).toHaveBeenCalledWith('run-1');
    expect(readDurableRunLog).toHaveBeenCalledWith({ runId: 'run-1', tail: 25 });
    expect(cancelDurableRun).toHaveBeenCalledWith('run-1');
    expect(readConversationBootstrap).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      tailBlocks: 12,
      knownSessionSignature: 'sig-1',
    });
    expect(renameConversation).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      name: 'Renamed conversation',
      surfaceId: 'surface-1',
    });
    expect(changeConversationCwd).toHaveBeenCalledWith({
      conversationId: 'live-1',
      cwd: '/next-repo',
      surfaceId: 'surface-1',
    });
    expect(recoverConversation).toHaveBeenCalledWith('conversation-1');
    expect(readConversationModelPreferences).toHaveBeenCalledWith({ conversationId: 'live-1' });
    expect(updateConversationModelPreferences).toHaveBeenCalledWith({
      conversationId: 'live-1',
      thinkingLevel: 'medium',
      surfaceId: 'surface-1',
    });
    expect(readLiveSession).toHaveBeenCalledWith('live-1');
    expect(readLiveSessionForkEntries).toHaveBeenCalledWith('live-1');
    expect(readLiveSessionContext).toHaveBeenCalledWith('live-1');
    expect(readSessionDetail).toHaveBeenCalledWith({ sessionId: 'live-1', tailBlocks: 24 });
    expect(readSessionBlock).toHaveBeenCalledWith({ sessionId: 'live-1', blockId: 'block-1' });
    expect(createLiveSession).toHaveBeenCalledWith({ cwd: '/repo', model: 'gpt-5.4' });
    expect(resumeLiveSession).toHaveBeenCalledWith('/tmp/live-1.jsonl');
    expect(takeOverLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', surfaceId: 'surface-1' });
    expect(submitLiveSessionPrompt).toHaveBeenCalledWith({
      conversationId: 'live-1',
      text: 'hello',
      behavior: 'followUp',
      surfaceId: 'surface-1',
      images: [],
      attachmentRefs: [],
    });
    expect(restoreQueuedLiveSessionMessage).toHaveBeenCalledWith({
      conversationId: 'live-1',
      behavior: 'followUp',
      index: 0,
      previewId: 'queue-1',
    });
    expect(compactLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', customInstructions: 'be shorter' });
    expect(exportLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', outputPath: '/tmp/live-1.html' });
    expect(reloadLiveSession).toHaveBeenCalledWith('live-1');
    expect(branchLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', entryId: 'entry-1' });
    expect(forkLiveSession).toHaveBeenCalledWith({ conversationId: 'live-1', entryId: 'entry-1', preserveSource: true });
    expect(summarizeAndForkLiveSession).toHaveBeenCalledWith('live-1');
    expect(abortLiveSession).toHaveBeenCalledWith('live-1');
    expect(destroyLiveSession).toHaveBeenCalledWith('conversation-1');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(status).toMatchObject({ profile: 'assistant' });
    expect(tasks).toEqual([{ id: 'task-1', scheduleType: 'cron', running: false, enabled: true, prompt: 'Prompt', title: 'Task 1' }]);
    expect(taskDetail).toEqual({ id: 'task-1', scheduleType: 'cron', running: false, enabled: true, prompt: 'Prompt body' });
    expect(taskLog).toEqual({ path: '/tasks/task-1.log', log: 'task tail' });
    expect(createdTask).toEqual({ ok: true, task: { id: 'task-2', scheduleType: 'cron', running: false, enabled: true, prompt: 'Created task body' } });
    expect(toggledTask).toEqual({ ok: true, task: { id: 'task-1', scheduleType: 'cron', running: false, enabled: false, prompt: 'Updated task body' } });
    expect(savedTask).toEqual({ ok: true, task: { id: 'task-1', scheduleType: 'cron', running: false, enabled: false, prompt: 'Updated task body' } });
    expect(taskRun).toEqual({ ok: true, accepted: true, runId: 'run-from-task' });
    expect(runs).toMatchObject({ runsRoot: '/runs' });
    expect(durableRun).toMatchObject({ runsRoot: '/runs' });
    expect(durableRunLog).toEqual({ path: '/runs/run-1.log', log: 'tail' });
    expect(cancelledRun).toEqual({ cancelled: true, runId: 'run-1' });
    expect(bootstrap).toEqual(createBootstrapState());
    expect(renamed).toEqual({ ok: true, title: 'Renamed conversation' });
    expect(changedCwd).toEqual({ id: 'live-1', sessionFile: '/tmp/live-1.jsonl', cwd: '/next-repo', changed: true });
    expect(recovered).toEqual({
      conversationId: 'live-1',
      live: true,
      recovered: true,
      replayedPendingOperation: false,
      usedFallbackPrompt: true,
    });
    expect(modelPreferences).toEqual({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high' });
    expect(updatedModelPreferences).toEqual({ currentModel: 'gpt-5.4', currentThinkingLevel: 'medium' });
    expect(live).toEqual({ live: true, id: 'live-1' });
    expect(forkEntries).toEqual([{ entryId: 'entry-1', text: 'fork from here' }]);
    expect(liveContext).toEqual({ cwd: '/repo', branch: 'main', git: null });
    expect(sessionDetail).toEqual({ meta: { id: 'live-1' }, blocks: [], blockOffset: 0, totalBlocks: 0, contextUsage: null });
    expect(sessionBlock).toEqual({ id: 'block-1', type: 'text', text: 'hello' });
    expect(created).toEqual({ id: 'live-1', sessionFile: '/tmp/live-1.jsonl' });
    expect(resumed).toEqual({ id: 'live-1' });
    expect(takeover).toMatchObject({ controllerSurfaceId: 'surface-1' });
    expect(prompted).toEqual({ ok: true, accepted: true, delivery: 'started' });
    expect(restored).toEqual({ ok: true, text: 'queued hello', images: [] });
    expect(compacted).toEqual({ ok: true, result: { compacted: true } });
    expect(exported).toEqual({ ok: true, path: '/tmp/live-1.html' });
    expect(reloaded).toEqual({ ok: true });
    expect(branched).toEqual({ newSessionId: 'branch-1', sessionFile: '/tmp/branch-1.jsonl' });
    expect(forked).toEqual({ newSessionId: 'fork-1', sessionFile: '/tmp/fork-1.jsonl' });
    expect(summaryFork).toEqual({ newSessionId: 'summary-1', sessionFile: '/tmp/summary-1.jsonl' });
    expect(aborted).toEqual({ ok: true });
    expect(destroyed).toEqual({ ok: true });
  });

  it('falls back to HTTP for non-local desktop hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse(createBootstrapState({
        conversationId: 'remote-conversation',
      })))
      .mockResolvedValueOnce(createJsonResponse({ ok: true, title: 'Remote rename' }))
      .mockResolvedValueOnce(createJsonResponse({
        conversationId: 'remote-conversation',
        live: true,
        recovered: true,
        replayedPendingOperation: false,
        usedFallbackPrompt: false,
      }))
      .mockResolvedValueOnce(createJsonResponse([{ entryId: 'entry-9', text: 'fork remote' }]))
      .mockResolvedValueOnce(createJsonResponse({ ok: true, path: '/tmp/remote-live.html' }));
    vi.stubGlobal('fetch', fetchMock);
    const invokeLocalApi = vi.fn();
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'web-1',
          activeHostLabel: 'Tailnet',
          activeHostKind: 'web',
          activeHostSummary: 'Remote host reachable.',
          canManageConnections: true,
        }),
        invokeLocalApi,
      },
    });

    const { api } = await import('./api');
    const result = await api.conversationBootstrap('remote-conversation', {
      knownSessionSignature: 'sig-2',
      tailBlocks: 5,
    });
    const renamed = await api.renameConversation('remote-conversation', 'Remote rename', 'surface-1');
    const recovered = await api.recoverConversation('remote-conversation');
    const forkEntries = await api.forkEntries('remote-live');
    const exported = await api.exportSession('remote-live', '/tmp/remote-live.html');

    expect(invokeLocalApi).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/conversations/remote-conversation/bootstrap?tailBlocks=5&knownSessionSignature=sig-2',
      { method: 'GET', cache: 'no-store' },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/conversations/remote-conversation/title',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Remote rename', surfaceId: 'surface-1' }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/conversations/remote-conversation/recover',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: undefined,
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      '/api/live-sessions/remote-live/fork-entries',
      { method: 'GET', cache: 'no-store' },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      '/api/live-sessions/remote-live/export',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputPath: '/tmp/remote-live.html' }),
      },
    );
    expect(result.conversationId).toBe('remote-conversation');
    expect(renamed).toEqual({ ok: true, title: 'Remote rename' });
    expect(recovered).toEqual({
      conversationId: 'remote-conversation',
      live: true,
      recovered: true,
      replayedPendingOperation: false,
      usedFallbackPrompt: false,
    });
    expect(forkEntries).toEqual([{ entryId: 'entry-9', text: 'fork remote' }]);
    expect(exported).toEqual({ ok: true, path: '/tmp/remote-live.html' });
  });
});
