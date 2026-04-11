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

  it('uses dedicated desktop capability bridges on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const readAppStatus = vi.fn().mockResolvedValue({
      profile: 'assistant',
      repoRoot: '/repo',
      activityCount: 0,
      webUiRevision: 'rev-1',
    });
    const readDaemonState = vi.fn().mockResolvedValue({
      warnings: [],
      service: { platform: 'desktop', identifier: 'daemon', manifestPath: '/tmp/daemon.plist', installed: true, running: true },
      runtime: { running: true, socketPath: '/tmp/daemon.sock', moduleCount: 3 },
      log: { lines: [] },
    });
    const readWebUiState = vi.fn().mockResolvedValue({
      warnings: [],
      service: { platform: 'desktop', identifier: 'web-ui', manifestPath: '/tmp/web-ui.plist', installed: true, running: true, url: 'personal-agent://app' },
      log: { lines: [] },
    });
    const readSessions = vi.fn().mockResolvedValue([{ id: 'conversation-1', title: 'Conversation 1' }]);
    const readSessionMeta = vi.fn().mockResolvedValue({ id: 'conversation-1', title: 'Conversation 1' });
    const readSessionSearchIndex = vi.fn().mockResolvedValue({ index: { 'conversation-1': 'hello world' } });
    const readModels = vi.fn().mockResolvedValue({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', models: [] });
    const updateModelPreferences = vi.fn().mockResolvedValue({ ok: true });
    const readModelProviders = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const saveModelProvider = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const deleteModelProvider = vi.fn().mockResolvedValue({ providers: [] });
    const saveModelProviderModel = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [{ id: 'model-a' }] }] });
    const deleteModelProviderModel = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const readProviderAuth = vi.fn().mockResolvedValue({ providers: [{ id: 'openai', authType: 'api_key' }] });
    const readCodexPlanUsage = vi.fn().mockResolvedValue({ available: true, planType: 'plus' });
    const setProviderApiKey = vi.fn().mockResolvedValue({ providers: [{ id: 'openai', authType: 'api_key' }] });
    const removeProviderCredential = vi.fn().mockResolvedValue({ providers: [] });
    const startProviderOAuthLogin = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'running' });
    const readProviderOAuthLogin = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'running' });
    const submitProviderOAuthLoginInput = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'running' });
    const cancelProviderOAuthLogin = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'cancelled' });
    const readActivity = vi.fn().mockResolvedValue([{ id: 'activity-1', createdAt: '2026-04-10T11:00:00.000Z', profile: 'assistant', kind: 'note', summary: 'Ping', read: false }]);
    const readActivityById = vi.fn().mockResolvedValue({ id: 'activity-1', createdAt: '2026-04-10T11:00:00.000Z', profile: 'assistant', kind: 'note', summary: 'Ping', read: false });
    const markActivityRead = vi.fn().mockResolvedValue({ ok: true });
    const clearInbox = vi.fn().mockResolvedValue({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: [] });
    const startActivityConversation = vi.fn().mockResolvedValue({ activityId: 'activity-1', id: 'conv-from-activity', sessionFile: '/tmp/conv.jsonl', cwd: '/repo', relatedConversationIds: ['conv-from-activity'] });
    const markConversationAttention = vi.fn().mockResolvedValue({ ok: true });
    const readAlerts = vi.fn().mockResolvedValue({ entries: [], activeCount: 0 });
    const acknowledgeAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1' } });
    const dismissAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1' } });
    const snoozeAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1' }, resume: { id: 'resume-1' } });
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
    const markDurableRunAttention = vi.fn().mockResolvedValue({ ok: true });
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
    const readLiveSessions = vi.fn().mockResolvedValue([{ id: 'live-1', cwd: '/repo', sessionFile: '/tmp/live-1.jsonl', title: 'Live 1', isStreaming: false }]);
    const readLiveSession = vi.fn().mockResolvedValue({ live: true, id: 'live-1' });
    const readLiveSessionStats = vi.fn().mockResolvedValue({ tokens: { input: 4, output: 6, total: 10 }, cost: 0.25 });
    const readLiveSessionContext = vi.fn().mockResolvedValue({ cwd: '/repo', branch: 'main', git: null });
    const readSessionDetail = vi.fn().mockResolvedValue({ meta: { id: 'live-1' }, blocks: [], blockOffset: 0, totalBlocks: 0, contextUsage: null });
    const readSessionBlock = vi.fn().mockResolvedValue({ id: 'block-1', type: 'text', text: 'hello' });
    const createLiveSession = vi.fn().mockResolvedValue({
      id: 'live-1',
      sessionFile: '/tmp/live-1.jsonl',
      bootstrap: createBootstrapState({
        conversationId: 'live-1',
        sessionDetail: {
          meta: {
            id: 'live-1',
            file: '/tmp/live-1.jsonl',
            timestamp: '2026-04-11T00:00:00.000Z',
            cwd: '/repo',
            cwdSlug: '-repo',
            model: 'gpt-5.4',
            title: 'New Conversation',
            messageCount: 0,
          },
          blocks: [],
          blockOffset: 0,
          totalBlocks: 0,
          contextUsage: null,
        },
        liveSession: {
          live: true,
          id: 'live-1',
          cwd: '/repo',
          sessionFile: '/tmp/live-1.jsonl',
          title: 'New Conversation',
          isStreaming: false,
        },
      }),
    });
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
        readAppStatus,
        readDaemonState,
        readWebUiState,
        readSessions,
        readSessionMeta,
        readSessionSearchIndex,
        readModels,
        updateModelPreferences,
        readModelProviders,
        saveModelProvider,
        deleteModelProvider,
        saveModelProviderModel,
        deleteModelProviderModel,
        readProviderAuth,
        readCodexPlanUsage,
        setProviderApiKey,
        removeProviderCredential,
        startProviderOAuthLogin,
        readProviderOAuthLogin,
        submitProviderOAuthLoginInput,
        cancelProviderOAuthLogin,
        readActivity,
        readActivityById,
        markActivityRead,
        clearInbox,
        startActivityConversation,
        markConversationAttention,
        readAlerts,
        acknowledgeAlert,
        dismissAlert,
        snoozeAlert,
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
        markDurableRunAttention,
        readConversationBootstrap,
        renameConversation,
        changeConversationCwd,
        recoverConversation,
        readConversationModelPreferences,
        updateConversationModelPreferences,
        readLiveSessions,
        readLiveSession,
        readLiveSessionStats,
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
    const daemon = await api.daemon();
    const webUiState = await api.webUiState();
    const sessions = await api.sessions();
    const sessionMeta = await api.sessionMeta('conversation-1');
    const sessionSearchIndex = await api.sessionSearchIndex(['conversation-1']);
    const models = await api.models();
    const modelPreferenceUpdate = await api.updateModelPreferences({ thinkingLevel: 'medium' });
    const modelProviders = await api.modelProviders();
    const savedModelProvider = await api.saveModelProvider('openrouter', { baseUrl: 'https://openrouter.ai/api' });
    const removedModelProvider = await api.deleteModelProvider('openrouter');
    const savedModelProviderModel = await api.saveModelProviderModel('openrouter', { modelId: 'model-a' });
    const removedModelProviderModel = await api.deleteModelProviderModel('openrouter', 'model-a');
    const providerAuth = await api.providerAuth();
    const codexPlanUsage = await api.codexPlanUsage();
    const providerApiKey = await api.setProviderApiKey('openai', 'sk-test');
    const removedProviderCredential = await api.removeProviderCredential('openai');
    const startedProviderOAuthLogin = await api.startProviderOAuthLogin('openrouter');
    const providerOAuthLogin = await api.providerOAuthLogin('login-1');
    const submittedProviderOAuthLoginInput = await api.submitProviderOAuthLoginInput('login-1', '123456');
    const cancelledProviderOAuthLogin = await api.cancelProviderOAuthLogin('login-1');
    const activity = await api.activity();
    const activityById = await api.activityById('activity-1');
    const activityMarked = await api.markActivityRead('activity-1', true);
    const alerts = await api.alerts();
    const alertAck = await api.acknowledgeAlert('alert-1');
    const alertDismiss = await api.dismissAlert('alert-1');
    const alertSnooze = await api.snoozeAlert('alert-1', { delay: '15m' });
    const inboxCleared = await api.clearInbox();
    const activityConversation = await api.startActivityConversation('activity-1');
    const attentionMarked = await api.markConversationAttentionRead('conversation-1', true);
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
    const durableRunAttention = await api.markDurableRunAttentionRead('run-1', false);
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
    const liveSessions = await api.liveSessions();
    const live = await api.liveSession('live-1');
    const liveStats = await api.liveSessionStats('live-1');
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
    expect(readAppStatus).toHaveBeenCalledTimes(1);
    expect(readDaemonState).toHaveBeenCalledTimes(1);
    expect(readWebUiState).toHaveBeenCalledTimes(1);
    expect(readSessions).toHaveBeenCalledTimes(1);
    expect(readSessionMeta).toHaveBeenCalledWith('conversation-1');
    expect(readSessionSearchIndex).toHaveBeenCalledWith(['conversation-1']);
    expect(readModels).toHaveBeenCalledTimes(1);
    expect(updateModelPreferences).toHaveBeenCalledWith({ thinkingLevel: 'medium' });
    expect(readModelProviders).toHaveBeenCalledTimes(1);
    expect(saveModelProvider).toHaveBeenCalledWith({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api' });
    expect(deleteModelProvider).toHaveBeenCalledWith('openrouter');
    expect(saveModelProviderModel).toHaveBeenCalledWith({ provider: 'openrouter', modelId: 'model-a' });
    expect(deleteModelProviderModel).toHaveBeenCalledWith({ provider: 'openrouter', modelId: 'model-a' });
    expect(readProviderAuth).toHaveBeenCalledTimes(1);
    expect(readCodexPlanUsage).toHaveBeenCalledTimes(1);
    expect(setProviderApiKey).toHaveBeenCalledWith({ provider: 'openai', apiKey: 'sk-test' });
    expect(removeProviderCredential).toHaveBeenCalledWith('openai');
    expect(startProviderOAuthLogin).toHaveBeenCalledWith('openrouter');
    expect(readProviderOAuthLogin).toHaveBeenCalledWith('login-1');
    expect(submitProviderOAuthLoginInput).toHaveBeenCalledWith({ loginId: 'login-1', value: '123456' });
    expect(cancelProviderOAuthLogin).toHaveBeenCalledWith('login-1');
    expect(readActivity).toHaveBeenCalledTimes(1);
    expect(readActivityById).toHaveBeenCalledWith('activity-1');
    expect(markActivityRead).toHaveBeenCalledWith({ activityId: 'activity-1', read: true });
    expect(readAlerts).toHaveBeenCalledTimes(1);
    expect(acknowledgeAlert).toHaveBeenCalledWith('alert-1');
    expect(dismissAlert).toHaveBeenCalledWith('alert-1');
    expect(snoozeAlert).toHaveBeenCalledWith({ alertId: 'alert-1', delay: '15m' });
    expect(clearInbox).toHaveBeenCalledTimes(1);
    expect(startActivityConversation).toHaveBeenCalledWith('activity-1');
    expect(markConversationAttention).toHaveBeenCalledWith({ conversationId: 'conversation-1', read: true });
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
    expect(markDurableRunAttention).toHaveBeenCalledWith({ runId: 'run-1', read: false });
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
    expect(readLiveSessions).toHaveBeenCalledTimes(1);
    expect(readLiveSession).toHaveBeenCalledWith('live-1');
    expect(readLiveSessionStats).toHaveBeenCalledWith('live-1');
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
    expect(status).toEqual({
      profile: 'assistant',
      repoRoot: '/repo',
      activityCount: 0,
      webUiRevision: 'rev-1',
    });
    expect(daemon).toEqual({
      warnings: [],
      service: { platform: 'desktop', identifier: 'daemon', manifestPath: '/tmp/daemon.plist', installed: true, running: true },
      runtime: { running: true, socketPath: '/tmp/daemon.sock', moduleCount: 3 },
      log: { lines: [] },
    });
    expect(webUiState).toEqual({
      warnings: [],
      service: { platform: 'desktop', identifier: 'web-ui', manifestPath: '/tmp/web-ui.plist', installed: true, running: true, url: 'personal-agent://app' },
      log: { lines: [] },
    });
    expect(sessions).toEqual([{ id: 'conversation-1', title: 'Conversation 1' }]);
    expect(sessionMeta).toEqual({ id: 'conversation-1', title: 'Conversation 1' });
    expect(sessionSearchIndex).toEqual({ index: { 'conversation-1': 'hello world' } });
    expect(models).toEqual({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', models: [] });
    expect(modelPreferenceUpdate).toEqual({ ok: true });
    expect(modelProviders).toEqual({ providers: [{ id: 'openrouter', models: [] }] });
    expect(savedModelProvider).toEqual({ providers: [{ id: 'openrouter', models: [] }] });
    expect(removedModelProvider).toEqual({ providers: [] });
    expect(savedModelProviderModel).toEqual({ providers: [{ id: 'openrouter', models: [{ id: 'model-a' }] }] });
    expect(removedModelProviderModel).toEqual({ providers: [{ id: 'openrouter', models: [] }] });
    expect(providerAuth).toEqual({ providers: [{ id: 'openai', authType: 'api_key' }] });
    expect(codexPlanUsage).toEqual({ available: true, planType: 'plus' });
    expect(providerApiKey).toEqual({ providers: [{ id: 'openai', authType: 'api_key' }] });
    expect(removedProviderCredential).toEqual({ providers: [] });
    expect(startedProviderOAuthLogin).toEqual({ id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'running' });
    expect(providerOAuthLogin).toEqual({ id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'running' });
    expect(submittedProviderOAuthLoginInput).toEqual({ id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'running' });
    expect(cancelledProviderOAuthLogin).toEqual({ id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'cancelled' });
    expect(activity).toEqual([{ id: 'activity-1', createdAt: '2026-04-10T11:00:00.000Z', profile: 'assistant', kind: 'note', summary: 'Ping', read: false }]);
    expect(activityById).toEqual({ id: 'activity-1', createdAt: '2026-04-10T11:00:00.000Z', profile: 'assistant', kind: 'note', summary: 'Ping', read: false });
    expect(activityMarked).toEqual({ ok: true });
    expect(alerts).toEqual({ entries: [], activeCount: 0 });
    expect(alertAck).toEqual({ ok: true, alert: { id: 'alert-1' } });
    expect(alertDismiss).toEqual({ ok: true, alert: { id: 'alert-1' } });
    expect(alertSnooze).toEqual({ ok: true, alert: { id: 'alert-1' }, resume: { id: 'resume-1' } });
    expect(inboxCleared).toEqual({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: [] });
    expect(activityConversation).toEqual({ activityId: 'activity-1', id: 'conv-from-activity', sessionFile: '/tmp/conv.jsonl', cwd: '/repo', relatedConversationIds: ['conv-from-activity'] });
    expect(attentionMarked).toEqual({ ok: true });
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
    expect(durableRunAttention).toEqual({ ok: true });
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
    expect(liveSessions).toEqual([{ id: 'live-1', cwd: '/repo', sessionFile: '/tmp/live-1.jsonl', title: 'Live 1', isStreaming: false }]);
    expect(live).toEqual({ live: true, id: 'live-1' });
    expect(liveStats).toEqual({ tokens: { input: 4, output: 6, total: 10 }, cost: 0.25 });
    expect(forkEntries).toEqual([{ entryId: 'entry-1', text: 'fork from here' }]);
    expect(liveContext).toEqual({ cwd: '/repo', branch: 'main', git: null });
    expect(sessionDetail).toEqual({ meta: { id: 'live-1' }, blocks: [], blockOffset: 0, totalBlocks: 0, contextUsage: null });
    expect(sessionBlock).toEqual({ id: 'block-1', type: 'text', text: 'hello' });
    expect(created).toEqual({
      id: 'live-1',
      sessionFile: '/tmp/live-1.jsonl',
      bootstrap: createBootstrapState({
        conversationId: 'live-1',
        sessionDetail: {
          meta: {
            id: 'live-1',
            file: '/tmp/live-1.jsonl',
            timestamp: '2026-04-11T00:00:00.000Z',
            cwd: '/repo',
            cwdSlug: '-repo',
            model: 'gpt-5.4',
            title: 'New Conversation',
            messageCount: 0,
          },
          blocks: [],
          blockOffset: 0,
          totalBlocks: 0,
          contextUsage: null,
        },
        liveSession: {
          live: true,
          id: 'live-1',
          cwd: '/repo',
          sessionFile: '/tmp/live-1.jsonl',
          title: 'New Conversation',
          isStreaming: false,
        },
      }),
    });
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

  it('skips the remote access session probe for the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const invokeLocalApi = vi.fn();
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
          canManageConnections: true,
        }),
        invokeLocalApi,
      },
    });

    const { api } = await import('./api');
    const authState = await api.remoteAccessSession();

    expect(invokeLocalApi).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(authState).toEqual({ required: false, session: null });
  });

  it('uses dedicated desktop conversation artifact and attachment bridges on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const readConversationArtifacts = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      artifacts: [{ id: 'artifact-1', title: 'Artifact 1', kind: 'html' }],
    });
    const readConversationArtifact = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      artifact: { id: 'artifact-1', title: 'Artifact 1', kind: 'html', content: '<p>Artifact</p>' },
    });
    const deleteConversationArtifact = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      deleted: true,
      artifactId: 'artifact-1',
      artifacts: [],
    });
    const readConversationAttachments = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    const readConversationAttachment = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
    });
    const createConversationAttachment = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    const updateConversationAttachment = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 2, latestRevision: { revision: 2 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    const deleteConversationAttachment = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      deleted: true,
      attachmentId: 'attachment-1',
      attachments: [],
    });
    const readConversationAttachmentAsset = vi.fn().mockResolvedValue({
      dataUrl: 'data:image/png;base64,cHJldmlldw==',
      mimeType: 'image/png',
      fileName: 'preview.png',
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
          canManageConnections: true,
        }),
        readConversationArtifacts,
        readConversationArtifact,
        deleteConversationArtifact,
        readConversationAttachments,
        readConversationAttachment,
        createConversationAttachment,
        updateConversationAttachment,
        deleteConversationAttachment,
        readConversationAttachmentAsset,
      },
    });

    const { api } = await import('./api');
    const artifacts = await api.conversationArtifacts('conversation-1');
    const artifact = await api.conversationArtifact('conversation-1', 'artifact-1');
    const deletedArtifact = await api.deleteConversationArtifact('conversation-1', 'artifact-1');
    const attachments = await api.conversationAttachments('conversation-1');
    const attachment = await api.conversationAttachment('conversation-1', 'attachment-1');
    const createdAttachment = await api.createConversationAttachment('conversation-1', { sourceData: 'source', previewData: 'preview' });
    const updatedAttachment = await api.updateConversationAttachment('conversation-1', 'attachment-1', { sourceData: 'source', previewData: 'preview' });
    const deletedAttachment = await api.deleteConversationAttachment('conversation-1', 'attachment-1');
    const attachmentAsset = await api.conversationAttachmentAsset('conversation-1', 'attachment-1', 'preview', 2);

    expect(readConversationArtifacts).toHaveBeenCalledWith('conversation-1');
    expect(readConversationArtifact).toHaveBeenCalledWith({ conversationId: 'conversation-1', artifactId: 'artifact-1' });
    expect(deleteConversationArtifact).toHaveBeenCalledWith({ conversationId: 'conversation-1', artifactId: 'artifact-1' });
    expect(readConversationAttachments).toHaveBeenCalledWith('conversation-1');
    expect(readConversationAttachment).toHaveBeenCalledWith({ conversationId: 'conversation-1', attachmentId: 'attachment-1' });
    expect(createConversationAttachment).toHaveBeenCalledWith({ conversationId: 'conversation-1', sourceData: 'source', previewData: 'preview' });
    expect(updateConversationAttachment).toHaveBeenCalledWith({ conversationId: 'conversation-1', attachmentId: 'attachment-1', sourceData: 'source', previewData: 'preview' });
    expect(deleteConversationAttachment).toHaveBeenCalledWith({ conversationId: 'conversation-1', attachmentId: 'attachment-1' });
    expect(readConversationAttachmentAsset).toHaveBeenCalledWith({ conversationId: 'conversation-1', attachmentId: 'attachment-1', asset: 'preview', revision: 2 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(artifacts).toEqual({ conversationId: 'conversation-1', artifacts: [{ id: 'artifact-1', title: 'Artifact 1', kind: 'html' }] });
    expect(artifact).toEqual({ conversationId: 'conversation-1', artifact: { id: 'artifact-1', title: 'Artifact 1', kind: 'html', content: '<p>Artifact</p>' } });
    expect(deletedArtifact).toEqual({ conversationId: 'conversation-1', deleted: true, artifactId: 'artifact-1', artifacts: [] });
    expect(attachments).toEqual({ conversationId: 'conversation-1', attachments: [{ id: 'attachment-1', kind: 'excalidraw' }] });
    expect(attachment).toEqual({ conversationId: 'conversation-1', attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } } });
    expect(createdAttachment).toEqual({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    expect(updatedAttachment).toEqual({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 2, latestRevision: { revision: 2 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    expect(deletedAttachment).toEqual({ conversationId: 'conversation-1', deleted: true, attachmentId: 'attachment-1', attachments: [] });
    expect(attachmentAsset).toEqual({
      dataUrl: 'data:image/png;base64,cHJldmlldw==',
      mimeType: 'image/png',
      fileName: 'preview.png',
    });
  });

  it('uses dedicated desktop conversation deferred-resume bridges on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const readConversationDeferredResumes = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      resumes: [{ id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z' }],
    });
    const scheduleConversationDeferredResume = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' },
      resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' }],
    });
    const fireConversationDeferredResume = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      resume: { id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z', prompt: 'Resume now.' },
      resumes: [],
    });
    const cancelConversationDeferredResume = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      cancelledId: 'resume-2',
      resumes: [],
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
          canManageConnections: true,
        }),
        readConversationDeferredResumes,
        scheduleConversationDeferredResume,
        fireConversationDeferredResume,
        cancelConversationDeferredResume,
      },
    });

    const { api } = await import('./api');
    const resumes = await api.deferredResumes('conversation-1');
    const scheduled = await api.scheduleDeferredResume('conversation-1', { delay: '10m', prompt: 'Resume later.' });
    const fired = await api.fireDeferredResumeNow('conversation-1', 'resume-1');
    const cancelled = await api.cancelDeferredResume('conversation-1', 'resume-2');

    expect(readConversationDeferredResumes).toHaveBeenCalledWith('conversation-1');
    expect(scheduleConversationDeferredResume).toHaveBeenCalledWith({ conversationId: 'conversation-1', delay: '10m', prompt: 'Resume later.' });
    expect(fireConversationDeferredResume).toHaveBeenCalledWith({ conversationId: 'conversation-1', resumeId: 'resume-1' });
    expect(cancelConversationDeferredResume).toHaveBeenCalledWith({ conversationId: 'conversation-1', resumeId: 'resume-2' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resumes).toEqual({
      conversationId: 'conversation-1',
      resumes: [{ id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z' }],
    });
    expect(scheduled).toEqual({
      conversationId: 'conversation-1',
      resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' },
      resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' }],
    });
    expect(fired).toEqual({
      conversationId: 'conversation-1',
      resume: { id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z', prompt: 'Resume now.' },
      resumes: [],
    });
    expect(cancelled).toEqual({
      conversationId: 'conversation-1',
      cancelledId: 'resume-2',
      resumes: [],
    });
  });

  it('uses dedicated desktop operator settings bridges on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const readProfiles = vi.fn().mockResolvedValue({ currentProfile: 'assistant', profiles: ['assistant', 'shared'] });
    const setCurrentProfile = vi.fn().mockResolvedValue({ ok: true, currentProfile: 'shared' });
    const readDefaultCwd = vi.fn().mockResolvedValue({ currentCwd: '', effectiveCwd: '/repo' });
    const updateDefaultCwd = vi.fn().mockResolvedValue({ currentCwd: './repo', effectiveCwd: '/repo' });
    const readVaultRoot = vi.fn().mockResolvedValue({ currentRoot: '', effectiveRoot: '/vault', defaultRoot: '/vault', source: 'default' });
    const readVaultFiles = vi.fn().mockResolvedValue({ root: '/vault', files: [{ id: 'notes/a.md', path: '/vault/notes/a.md' }] });
    const updateVaultRoot = vi.fn().mockResolvedValue({ currentRoot: '~/vault', effectiveRoot: '/Users/patrick/vault', defaultRoot: '/vault', source: 'config' });
    const pickFolder = vi.fn().mockResolvedValue({ path: '/picked/repo', cancelled: false });
    const readConversationTitleSettings = vi.fn().mockResolvedValue({ enabled: true, currentModel: '', effectiveModel: 'openai/gpt-5.4' });
    const updateConversationTitleSettings = vi.fn().mockResolvedValue({ enabled: false, currentModel: 'anthropic/claude-sonnet-4-6', effectiveModel: 'anthropic/claude-sonnet-4-6' });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
          canManageConnections: true,
        }),
        readProfiles,
        setCurrentProfile,
        readDefaultCwd,
        updateDefaultCwd,
        readVaultRoot,
        readVaultFiles,
        updateVaultRoot,
        pickFolder,
        readConversationTitleSettings,
        updateConversationTitleSettings,
      },
    });

    const { api } = await import('./api');
    const profiles = await api.profiles();
    const switchedProfile = await api.setCurrentProfile('shared');
    const defaultCwd = await api.defaultCwd();
    const savedDefaultCwd = await api.updateDefaultCwd('./repo');
    const vaultRoot = await api.vaultRoot();
    const savedVaultRoot = await api.updateVaultRoot('~/vault');
    const conversationTitleSettings = await api.conversationTitleSettings();
    const savedConversationTitleSettings = await api.updateConversationTitleSettings({ enabled: false, model: 'anthropic/claude-sonnet-4-6' });

    expect(readProfiles).toHaveBeenCalledTimes(1);
    expect(setCurrentProfile).toHaveBeenCalledWith('shared');
    expect(readDefaultCwd).toHaveBeenCalledTimes(1);
    expect(updateDefaultCwd).toHaveBeenCalledWith('./repo');
    expect(readVaultRoot).toHaveBeenCalledTimes(1);
    expect(updateVaultRoot).toHaveBeenCalledWith('~/vault');
    expect(readConversationTitleSettings).toHaveBeenCalledTimes(1);
    expect(updateConversationTitleSettings).toHaveBeenCalledWith({ enabled: false, model: 'anthropic/claude-sonnet-4-6' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(profiles).toEqual({ currentProfile: 'assistant', profiles: ['assistant', 'shared'] });
    expect(switchedProfile).toEqual({ ok: true, currentProfile: 'shared' });
    expect(defaultCwd).toEqual({ currentCwd: '', effectiveCwd: '/repo' });
    expect(savedDefaultCwd).toEqual({ currentCwd: './repo', effectiveCwd: '/repo' });
    expect(vaultRoot).toEqual({ currentRoot: '', effectiveRoot: '/vault', defaultRoot: '/vault', source: 'default' });
    expect(savedVaultRoot).toEqual({ currentRoot: '~/vault', effectiveRoot: '/Users/patrick/vault', defaultRoot: '/vault', source: 'config' });
    expect(conversationTitleSettings).toEqual({ enabled: true, currentModel: '', effectiveModel: 'openai/gpt-5.4' });
    expect(savedConversationTitleSettings).toEqual({ enabled: false, currentModel: 'anthropic/claude-sonnet-4-6', effectiveModel: 'anthropic/claude-sonnet-4-6' });
  });

  it('uses dedicated desktop vault-file and folder-picker bridges on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const readVaultFiles = vi.fn().mockResolvedValue({
      root: '/vault',
      files: [{ id: 'notes/a.md', name: 'a.md', path: '/vault/notes/a.md', sizeBytes: 12, updatedAt: '2026-04-18T12:00:00.000Z' }],
    });
    const pickFolder = vi.fn().mockResolvedValue({ path: '/picked/repo', cancelled: false });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
          canManageConnections: true,
        }),
        readVaultFiles,
        pickFolder,
      },
    });

    const { api } = await import('./api');
    const vaultFiles = await api.vaultFiles();
    const pickedFolder = await api.pickFolder('/repo');

    expect(readVaultFiles).toHaveBeenCalledTimes(1);
    expect(pickFolder).toHaveBeenCalledWith({ cwd: '/repo' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(vaultFiles).toEqual({
      root: '/vault',
      files: [{ id: 'notes/a.md', name: 'a.md', path: '/vault/notes/a.md', sizeBytes: 12, updatedAt: '2026-04-18T12:00:00.000Z' }],
    });
    expect(pickedFolder).toEqual({ path: '/picked/repo', cancelled: false });
  });

  it('uses the dedicated desktop shell-command bridge on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const runShellCommand = vi.fn().mockResolvedValue({
      output: '/repo\n',
      exitCode: 0,
      cwd: '/repo',
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
          canManageConnections: true,
        }),
        runShellCommand,
      },
    });

    const { api } = await import('./api');
    const result = await api.run('pwd', '/repo');

    expect(runShellCommand).toHaveBeenCalledWith({ command: 'pwd', cwd: '/repo' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ output: '/repo\n', exitCode: 0, cwd: '/repo' });
  });

  it('uses dedicated desktop automation preset bridges on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const readConversationPlanDefaults = vi.fn().mockResolvedValue({ defaultEnabled: true });
    const updateConversationPlanDefaults = vi.fn().mockResolvedValue({ defaultEnabled: false });
    const readConversationPlanLibrary = vi.fn().mockResolvedValue({
      presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
      defaultPresetIds: ['preset-1'],
    });
    const updateConversationPlanLibrary = vi.fn().mockResolvedValue({
      presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
      defaultPresetIds: [],
    });
    const readConversationPlansWorkspace = vi.fn().mockResolvedValue({
      defaultEnabled: true,
      presetLibrary: {
        presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
        defaultPresetIds: ['preset-1'],
      },
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
          canManageConnections: true,
        }),
        readConversationPlanDefaults,
        updateConversationPlanDefaults,
        readConversationPlanLibrary,
        updateConversationPlanLibrary,
        readConversationPlansWorkspace,
      },
    });

    const { api } = await import('./api');
    const defaults = await api.conversationPlanDefaults();
    const savedDefaults = await api.updateConversationPlanDefaults({ defaultEnabled: false });
    const library = await api.conversationPlanLibrary();
    const savedLibrary = await api.updateConversationPlanLibrary({ defaultPresetIds: [], presets: [] });
    const workspace = await api.conversationPlansWorkspace();

    expect(readConversationPlanDefaults).toHaveBeenCalledTimes(1);
    expect(updateConversationPlanDefaults).toHaveBeenCalledWith({ defaultEnabled: false });
    expect(readConversationPlanLibrary).toHaveBeenCalledTimes(1);
    expect(updateConversationPlanLibrary).toHaveBeenCalledWith({ defaultPresetIds: [], presets: [] });
    expect(readConversationPlansWorkspace).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(defaults).toEqual({ defaultEnabled: true });
    expect(savedDefaults).toEqual({ defaultEnabled: false });
    expect(library).toEqual({
      presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
      defaultPresetIds: ['preset-1'],
    });
    expect(savedLibrary).toEqual({
      presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
      defaultPresetIds: [],
    });
    expect(workspace).toEqual({
      defaultEnabled: true,
      presetLibrary: {
        presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
        defaultPresetIds: ['preset-1'],
      },
    });
  });

  it('uses dedicated desktop system admin bridges on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const updateWebUiConfig = vi.fn().mockResolvedValue({
      warnings: [],
      service: {
        running: true,
        platform: 'desktop',
        identifier: 'web-ui',
        tailscaleServe: false,
        resumeFallbackPrompt: 'Resume the task.',
      },
      log: { lines: [] },
    });
    const readRemoteAccessState = vi.fn().mockResolvedValue({
      pendingPairings: [],
      sessions: [{ id: 'session-1', label: 'iPhone' }],
    });
    const createRemoteAccessPairingCode = vi.fn().mockResolvedValue({
      id: 'pairing-1',
      code: '123456',
      createdAt: '2026-04-15T10:00:00.000Z',
      expiresAt: '2026-04-15T10:10:00.000Z',
    });
    const revokeRemoteAccessSession = vi.fn().mockResolvedValue({
      ok: true,
      state: { pendingPairings: [], sessions: [] },
    });
    const readOpenConversationTabs = vi.fn().mockResolvedValue({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-2'],
      archivedSessionIds: ['conversation-3'],
    });
    const updateOpenConversationTabs = vi.fn().mockResolvedValue({
      ok: true,
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
          canManageConnections: true,
        }),
        updateWebUiConfig,
        readRemoteAccessState,
        createRemoteAccessPairingCode,
        revokeRemoteAccessSession,
        readOpenConversationTabs,
        updateOpenConversationTabs,
      },
    });

    const { api } = await import('./api');
    const webUiState = await api.setWebUiConfig({ resumeFallbackPrompt: 'Resume the task.' });
    const authState = await api.remoteAccessState();
    const pairing = await api.createRemoteAccessPairingCode();
    const revoked = await api.revokeRemoteAccessSession('session-1');
    const layout = await api.openConversationTabs();
    const savedLayout = await api.setOpenConversationTabs(['conversation-4'], ['conversation-5'], ['conversation-6']);

    expect(updateWebUiConfig).toHaveBeenCalledWith({ resumeFallbackPrompt: 'Resume the task.' });
    expect(readRemoteAccessState).toHaveBeenCalledTimes(1);
    expect(createRemoteAccessPairingCode).toHaveBeenCalledTimes(1);
    expect(revokeRemoteAccessSession).toHaveBeenCalledWith('session-1');
    expect(readOpenConversationTabs).toHaveBeenCalledTimes(1);
    expect(updateOpenConversationTabs).toHaveBeenCalledWith({
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(webUiState).toEqual({
      warnings: [],
      service: {
        running: true,
        platform: 'desktop',
        identifier: 'web-ui',
        tailscaleServe: false,
        resumeFallbackPrompt: 'Resume the task.',
      },
      log: { lines: [] },
    });
    expect(authState).toEqual({ pendingPairings: [], sessions: [{ id: 'session-1', label: 'iPhone' }] });
    expect(pairing).toEqual({
      id: 'pairing-1',
      code: '123456',
      createdAt: '2026-04-15T10:00:00.000Z',
      expiresAt: '2026-04-15T10:10:00.000Z',
    });
    expect(revoked).toEqual({ ok: true, state: { pendingPairings: [], sessions: [] } });
    expect(layout).toEqual({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-2'],
      archivedSessionIds: ['conversation-3'],
    });
    expect(savedLayout).toEqual({
      ok: true,
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
    });
  });

  it('falls back to HTTP for remote-access exchange/logout even on the local Electron host', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ required: false, session: { id: 'session-1', label: 'Browser' } }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
          canManageConnections: true,
        }),
      },
    });

    const { api } = await import('./api');
    const exchanged = await api.exchangeRemoteAccessPairingCode('PAIR-1234', 'Safari');
    const loggedOut = await api.logoutRemoteAccessSession();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/remote-access/exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'PAIR-1234', deviceLabel: 'Safari' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/remote-access/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    });
    expect(exchanged).toEqual({ required: false, session: { id: 'session-1', label: 'Browser' } });
    expect(loggedOut).toEqual({ ok: true });
  });

  it('uses dedicated desktop inbox and alert bridges on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const readActivity = vi.fn().mockResolvedValue([{ id: 'activity-1', read: false }]);
    const readActivityById = vi.fn().mockResolvedValue({ id: 'activity-1', read: false });
    const markActivityRead = vi.fn().mockResolvedValue({ ok: true });
    const clearInbox = vi.fn().mockResolvedValue({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: [] });
    const startActivityConversation = vi.fn().mockResolvedValue({ activityId: 'activity-1', id: 'conversation-1', sessionFile: '/tmp/conversation-1.jsonl', cwd: '/repo', relatedConversationIds: ['conversation-1'] });
    const markConversationAttention = vi.fn().mockResolvedValue({ ok: true });
    const readAlerts = vi.fn().mockResolvedValue({ entries: [{ id: 'alert-1', status: 'active' }], activeCount: 1 });
    const acknowledgeAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' } });
    const dismissAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'dismissed' } });
    const snoozeAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' }, resume: { id: 'resume-1' } });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
          canManageConnections: true,
        }),
        readActivity,
        readActivityById,
        markActivityRead,
        clearInbox,
        startActivityConversation,
        markConversationAttention,
        readAlerts,
        acknowledgeAlert,
        dismissAlert,
        snoozeAlert,
      },
    });

    const { api } = await import('./api');
    const activity = await api.activity();
    const activityDetail = await api.activityById('activity-1');
    const activityRead = await api.markActivityRead('activity-1', false);
    const inboxCleared = await api.clearInbox();
    const startedConversation = await api.startActivityConversation('activity-1');
    const attention = await api.markConversationAttentionRead('conversation-1', false);
    const alerts = await api.alerts();
    const acknowledged = await api.acknowledgeAlert('alert-1');
    const dismissed = await api.dismissAlert('alert-1');
    const snoozed = await api.snoozeAlert('alert-1', { delay: '15m' });

    expect(readActivity).toHaveBeenCalledTimes(1);
    expect(readActivityById).toHaveBeenCalledWith('activity-1');
    expect(markActivityRead).toHaveBeenCalledWith({ activityId: 'activity-1', read: false });
    expect(clearInbox).toHaveBeenCalledTimes(1);
    expect(startActivityConversation).toHaveBeenCalledWith('activity-1');
    expect(markConversationAttention).toHaveBeenCalledWith({ conversationId: 'conversation-1', read: false });
    expect(readAlerts).toHaveBeenCalledTimes(1);
    expect(acknowledgeAlert).toHaveBeenCalledWith('alert-1');
    expect(dismissAlert).toHaveBeenCalledWith('alert-1');
    expect(snoozeAlert).toHaveBeenCalledWith({ alertId: 'alert-1', delay: '15m' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(activity).toEqual([{ id: 'activity-1', read: false }]);
    expect(activityDetail).toEqual({ id: 'activity-1', read: false });
    expect(activityRead).toEqual({ ok: true });
    expect(inboxCleared).toEqual({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: [] });
    expect(startedConversation).toEqual({ activityId: 'activity-1', id: 'conversation-1', sessionFile: '/tmp/conversation-1.jsonl', cwd: '/repo', relatedConversationIds: ['conversation-1'] });
    expect(attention).toEqual({ ok: true });
    expect(alerts).toEqual({ entries: [{ id: 'alert-1', status: 'active' }], activeCount: 1 });
    expect(acknowledged).toEqual({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' } });
    expect(dismissed).toEqual({ ok: true, alert: { id: 'alert-1', status: 'dismissed' } });
    expect(snoozed).toEqual({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' }, resume: { id: 'resume-1' } });
  });

  it('uses dedicated desktop notification capabilities on the local Electron host', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const readActivity = vi.fn().mockResolvedValue([{ id: 'activity-1', read: false }]);
    const readActivityById = vi.fn().mockResolvedValue({ id: 'activity-1', read: true });
    const markActivityRead = vi.fn().mockResolvedValue({ ok: true });
    const clearInbox = vi.fn().mockResolvedValue({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: ['conversation-1'] });
    const startActivityConversation = vi.fn().mockResolvedValue({
      activityId: 'activity-1',
      id: 'conversation-1',
      sessionFile: '/tmp/conversation-1.jsonl',
      cwd: '/repo',
      relatedConversationIds: ['conversation-1'],
    });
    const markConversationAttention = vi.fn().mockResolvedValue({ ok: true });
    const readAlerts = vi.fn().mockResolvedValue({ entries: [{ id: 'alert-1', status: 'active' }], activeCount: 1 });
    const acknowledgeAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' } });
    const dismissAlert = vi.fn().mockResolvedValue({ ok: true, alert: { id: 'alert-1', status: 'dismissed' } });
    const snoozeAlert = vi.fn().mockResolvedValue({
      ok: true,
      alert: { id: 'alert-1', status: 'acknowledged' },
      resume: { id: 'resume-1', dueAt: '2026-04-10T12:15:00.000Z' },
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
          canManageConnections: true,
        }),
        readActivity,
        readActivityById,
        markActivityRead,
        clearInbox,
        startActivityConversation,
        markConversationAttention,
        readAlerts,
        acknowledgeAlert,
        dismissAlert,
        snoozeAlert,
      },
    });

    const { api } = await import('./api');
    const activity = await api.activity();
    const activityEntry = await api.activityById('activity-1');
    const marked = await api.markActivityRead('activity-1', false);
    const cleared = await api.clearInbox();
    const started = await api.startActivityConversation('activity-1');
    const conversationAttention = await api.markConversationAttentionRead('conversation-1', false);
    const alerts = await api.alerts();
    const acknowledged = await api.acknowledgeAlert('alert-1');
    const dismissed = await api.dismissAlert('alert-1');
    const snoozed = await api.snoozeAlert('alert-1', { delay: '15m' });

    expect(readActivity).toHaveBeenCalledTimes(1);
    expect(readActivityById).toHaveBeenCalledWith('activity-1');
    expect(markActivityRead).toHaveBeenCalledWith({ activityId: 'activity-1', read: false });
    expect(clearInbox).toHaveBeenCalledTimes(1);
    expect(startActivityConversation).toHaveBeenCalledWith('activity-1');
    expect(markConversationAttention).toHaveBeenCalledWith({ conversationId: 'conversation-1', read: false });
    expect(readAlerts).toHaveBeenCalledTimes(1);
    expect(acknowledgeAlert).toHaveBeenCalledWith('alert-1');
    expect(dismissAlert).toHaveBeenCalledWith('alert-1');
    expect(snoozeAlert).toHaveBeenCalledWith({ alertId: 'alert-1', delay: '15m' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(activity).toEqual([{ id: 'activity-1', read: false }]);
    expect(activityEntry).toEqual({ id: 'activity-1', read: true });
    expect(marked).toEqual({ ok: true });
    expect(cleared).toEqual({ ok: true, deletedActivityIds: ['activity-1'], clearedConversationIds: ['conversation-1'] });
    expect(started).toEqual({
      activityId: 'activity-1',
      id: 'conversation-1',
      sessionFile: '/tmp/conversation-1.jsonl',
      cwd: '/repo',
      relatedConversationIds: ['conversation-1'],
    });
    expect(conversationAttention).toEqual({ ok: true });
    expect(alerts).toEqual({ entries: [{ id: 'alert-1', status: 'active' }], activeCount: 1 });
    expect(acknowledged).toEqual({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' } });
    expect(dismissed).toEqual({ ok: true, alert: { id: 'alert-1', status: 'dismissed' } });
    expect(snoozed).toEqual({
      ok: true,
      alert: { id: 'alert-1', status: 'acknowledged' },
      resume: { id: 'resume-1', dueAt: '2026-04-10T12:15:00.000Z' },
    });
  });

  it('falls back to HTTP for desktop notification capabilities on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse([{ id: 'activity-1', read: false }]))
      .mockResolvedValueOnce(createJsonResponse({ ok: true }))
      .mockResolvedValueOnce(createJsonResponse({ entries: [{ id: 'alert-1', status: 'active' }], activeCount: 1 }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true, alert: { id: 'alert-1', status: 'acknowledged' }, resume: { id: 'resume-1', dueAt: '2026-04-10T12:15:00.000Z' } }));
    vi.stubGlobal('fetch', fetchMock);
    const readActivity = vi.fn();
    const readAlerts = vi.fn();
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
        readActivity,
        readAlerts,
      },
    });

    const { api } = await import('./api');
    const activity = await api.activity();
    const marked = await api.markActivityRead('activity-1', false);
    const alerts = await api.alerts();
    const snoozed = await api.snoozeAlert('alert-1', { delay: '15m' });

    expect(readActivity).not.toHaveBeenCalled();
    expect(readAlerts).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/activity', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/activity/activity-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: false }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/alerts', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/alerts/alert-1/snooze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delay: '15m' }),
    });
    expect(activity).toEqual([{ id: 'activity-1', read: false }]);
    expect(marked).toEqual({ ok: true });
    expect(alerts).toEqual({ entries: [{ id: 'alert-1', status: 'active' }], activeCount: 1 });
    expect(snoozed).toEqual({
      ok: true,
      alert: { id: 'alert-1', status: 'acknowledged' },
      resume: { id: 'resume-1', dueAt: '2026-04-10T12:15:00.000Z' },
    });
  });

  it('falls back to HTTP for remote access session checks on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ required: true, session: null }));
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
    const authState = await api.remoteAccessSession();

    expect(invokeLocalApi).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/remote-access/session', { method: 'GET', cache: 'no-store' });
    expect(authState).toEqual({ required: true, session: null });
  });

  it('falls back to HTTP for desktop operator settings on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ currentProfile: 'shared', profiles: ['assistant', 'shared'] }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true, currentProfile: 'assistant' }))
      .mockResolvedValueOnce(createJsonResponse({ currentCwd: '', effectiveCwd: '/repo' }))
      .mockResolvedValueOnce(createJsonResponse({ currentCwd: './repo', effectiveCwd: '/repo' }))
      .mockResolvedValueOnce(createJsonResponse({ currentRoot: '', effectiveRoot: '/vault', defaultRoot: '/vault', source: 'default' }))
      .mockResolvedValueOnce(createJsonResponse({ currentRoot: '~/vault', effectiveRoot: '/Users/patrick/vault', defaultRoot: '/vault', source: 'config' }))
      .mockResolvedValueOnce(createJsonResponse({ enabled: true, currentModel: '', effectiveModel: 'openai/gpt-5.4' }))
      .mockResolvedValueOnce(createJsonResponse({ enabled: false, currentModel: 'anthropic/claude-sonnet-4-6', effectiveModel: 'anthropic/claude-sonnet-4-6' }));
    vi.stubGlobal('fetch', fetchMock);
    const readProfiles = vi.fn();
    const readDefaultCwd = vi.fn();
    const readVaultRoot = vi.fn();
    const readConversationTitleSettings = vi.fn();
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
        readProfiles,
        readDefaultCwd,
        readVaultRoot,
        readConversationTitleSettings,
      },
    });

    const { api } = await import('./api');
    const profiles = await api.profiles();
    const switchedProfile = await api.setCurrentProfile('assistant');
    const defaultCwd = await api.defaultCwd();
    const savedDefaultCwd = await api.updateDefaultCwd('./repo');
    const vaultRoot = await api.vaultRoot();
    const savedVaultRoot = await api.updateVaultRoot('~/vault');
    const conversationTitleSettings = await api.conversationTitleSettings();
    const savedConversationTitleSettings = await api.updateConversationTitleSettings({ enabled: false, model: 'anthropic/claude-sonnet-4-6' });

    expect(readProfiles).not.toHaveBeenCalled();
    expect(readDefaultCwd).not.toHaveBeenCalled();
    expect(readVaultRoot).not.toHaveBeenCalled();
    expect(readConversationTitleSettings).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/profiles', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/profiles/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ profile: 'assistant' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/default-cwd', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/default-cwd', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: './repo' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/vault-root', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/vault-root', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root: '~/vault' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/conversation-titles/settings', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(8, '/api/conversation-titles/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, model: 'anthropic/claude-sonnet-4-6' }),
    });
    expect(profiles).toEqual({ currentProfile: 'shared', profiles: ['assistant', 'shared'] });
    expect(switchedProfile).toEqual({ ok: true, currentProfile: 'assistant' });
    expect(defaultCwd).toEqual({ currentCwd: '', effectiveCwd: '/repo' });
    expect(savedDefaultCwd).toEqual({ currentCwd: './repo', effectiveCwd: '/repo' });
    expect(vaultRoot).toEqual({ currentRoot: '', effectiveRoot: '/vault', defaultRoot: '/vault', source: 'default' });
    expect(savedVaultRoot).toEqual({ currentRoot: '~/vault', effectiveRoot: '/Users/patrick/vault', defaultRoot: '/vault', source: 'config' });
    expect(conversationTitleSettings).toEqual({ enabled: true, currentModel: '', effectiveModel: 'openai/gpt-5.4' });
    expect(savedConversationTitleSettings).toEqual({ enabled: false, currentModel: 'anthropic/claude-sonnet-4-6', effectiveModel: 'anthropic/claude-sonnet-4-6' });
  });

  it('falls back to HTTP for desktop vault-file and folder-picker bridges on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({
        root: '/vault',
        files: [{ id: 'notes/a.md', name: 'a.md', path: '/vault/notes/a.md', sizeBytes: 12, updatedAt: '2026-04-18T12:00:00.000Z' }],
      }))
      .mockResolvedValueOnce(createJsonResponse({ path: '/picked/repo', cancelled: false }));
    vi.stubGlobal('fetch', fetchMock);
    const readVaultFiles = vi.fn();
    const pickFolder = vi.fn();
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
        readVaultFiles,
        pickFolder,
      },
    });

    const { api } = await import('./api');
    const vaultFiles = await api.vaultFiles();
    const pickedFolder = await api.pickFolder('/repo');

    expect(readVaultFiles).not.toHaveBeenCalled();
    expect(pickFolder).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/vault-files', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/folder-picker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '/repo' }),
    });
    expect(vaultFiles).toEqual({
      root: '/vault',
      files: [{ id: 'notes/a.md', name: 'a.md', path: '/vault/notes/a.md', sizeBytes: 12, updatedAt: '2026-04-18T12:00:00.000Z' }],
    });
    expect(pickedFolder).toEqual({ path: '/picked/repo', cancelled: false });
  });

  it('falls back to HTTP for the desktop shell-command bridge on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ output: '/repo\n', exitCode: 0, cwd: '/repo' }));
    vi.stubGlobal('fetch', fetchMock);
    const runShellCommand = vi.fn();
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
        runShellCommand,
      },
    });

    const { api } = await import('./api');
    const result = await api.run('pwd', '/repo');

    expect(runShellCommand).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'pwd', cwd: '/repo' }),
    });
    expect(result).toEqual({ output: '/repo\n', exitCode: 0, cwd: '/repo' });
  });

  it('falls back to HTTP for desktop automation preset bridges on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ defaultEnabled: true }))
      .mockResolvedValueOnce(createJsonResponse({ defaultEnabled: false }))
      .mockResolvedValueOnce(createJsonResponse({ presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }], defaultPresetIds: ['preset-1'] }))
      .mockResolvedValueOnce(createJsonResponse({ presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }], defaultPresetIds: [] }))
      .mockResolvedValueOnce(createJsonResponse({ defaultEnabled: true, presetLibrary: { presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }], defaultPresetIds: ['preset-1'] } }));
    vi.stubGlobal('fetch', fetchMock);
    const readConversationPlanDefaults = vi.fn();
    const readConversationPlanLibrary = vi.fn();
    const readConversationPlansWorkspace = vi.fn();
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
        readConversationPlanDefaults,
        readConversationPlanLibrary,
        readConversationPlansWorkspace,
      },
    });

    const { api } = await import('./api');
    const defaults = await api.conversationPlanDefaults();
    const savedDefaults = await api.updateConversationPlanDefaults({ defaultEnabled: false });
    const library = await api.conversationPlanLibrary();
    const savedLibrary = await api.updateConversationPlanLibrary({ defaultPresetIds: [], presets: [] });
    const workspace = await api.conversationPlansWorkspace();

    expect(readConversationPlanDefaults).not.toHaveBeenCalled();
    expect(readConversationPlanLibrary).not.toHaveBeenCalled();
    expect(readConversationPlansWorkspace).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/conversation-plans/defaults', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/conversation-plans/defaults', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultEnabled: false }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/conversation-plans/library', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/conversation-plans/library', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultPresetIds: [], presets: [] }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/conversation-plans/workspace', { method: 'GET', cache: 'no-store' });
    expect(defaults).toEqual({ defaultEnabled: true });
    expect(savedDefaults).toEqual({ defaultEnabled: false });
    expect(library).toEqual({
      presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
      defaultPresetIds: ['preset-1'],
    });
    expect(savedLibrary).toEqual({
      presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
      defaultPresetIds: [],
    });
    expect(workspace).toEqual({
      defaultEnabled: true,
      presetLibrary: {
        presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
        defaultPresetIds: ['preset-1'],
      },
    });
  });

  it('falls back to HTTP for desktop system admin bridges on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({
        warnings: [],
        service: {
          running: true,
          platform: 'desktop',
          identifier: 'web-ui',
          tailscaleServe: false,
          resumeFallbackPrompt: 'Resume the task.',
        },
        log: { lines: [] },
      }))
      .mockResolvedValueOnce(createJsonResponse({ pendingPairings: [], sessions: [{ id: 'session-1', label: 'iPhone' }] }))
      .mockResolvedValueOnce(createJsonResponse({
        id: 'pairing-1',
        code: '123456',
        createdAt: '2026-04-15T10:00:00.000Z',
        expiresAt: '2026-04-15T10:10:00.000Z',
      }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true, state: { pendingPairings: [], sessions: [] } }))
      .mockResolvedValueOnce(createJsonResponse({
        sessionIds: ['conversation-1'],
        pinnedSessionIds: ['conversation-2'],
        archivedSessionIds: ['conversation-3'],
      }))
      .mockResolvedValueOnce(createJsonResponse({
        ok: true,
        sessionIds: ['conversation-4'],
        pinnedSessionIds: ['conversation-5'],
        archivedSessionIds: ['conversation-6'],
      }));
    vi.stubGlobal('fetch', fetchMock);
    const updateWebUiConfig = vi.fn();
    const readRemoteAccessState = vi.fn();
    const createRemoteAccessPairingCode = vi.fn();
    const revokeRemoteAccessSession = vi.fn();
    const readOpenConversationTabs = vi.fn();
    const updateOpenConversationTabs = vi.fn();
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
        updateWebUiConfig,
        readRemoteAccessState,
        createRemoteAccessPairingCode,
        revokeRemoteAccessSession,
        readOpenConversationTabs,
        updateOpenConversationTabs,
      },
    });

    const { api } = await import('./api');
    const webUiState = await api.setWebUiConfig({ resumeFallbackPrompt: 'Resume the task.' });
    const authState = await api.remoteAccessState();
    const pairing = await api.createRemoteAccessPairingCode();
    const revoked = await api.revokeRemoteAccessSession('session-1');
    const layout = await api.openConversationTabs();
    const savedLayout = await api.setOpenConversationTabs(['conversation-4'], ['conversation-5'], ['conversation-6']);

    expect(updateWebUiConfig).not.toHaveBeenCalled();
    expect(readRemoteAccessState).not.toHaveBeenCalled();
    expect(createRemoteAccessPairingCode).not.toHaveBeenCalled();
    expect(revokeRemoteAccessSession).not.toHaveBeenCalled();
    expect(readOpenConversationTabs).not.toHaveBeenCalled();
    expect(updateOpenConversationTabs).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/web-ui/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resumeFallbackPrompt: 'Resume the task.' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/remote-access', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/remote-access/pairing-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/remote-access/sessions/session-1', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/web-ui/open-conversations', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/web-ui/open-conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionIds: ['conversation-4'],
        pinnedSessionIds: ['conversation-5'],
        archivedSessionIds: ['conversation-6'],
      }),
    });
    expect(webUiState).toEqual({
      warnings: [],
      service: {
        running: true,
        platform: 'desktop',
        identifier: 'web-ui',
        tailscaleServe: false,
        resumeFallbackPrompt: 'Resume the task.',
      },
      log: { lines: [] },
    });
    expect(authState).toEqual({ pendingPairings: [], sessions: [{ id: 'session-1', label: 'iPhone' }] });
    expect(pairing).toEqual({
      id: 'pairing-1',
      code: '123456',
      createdAt: '2026-04-15T10:00:00.000Z',
      expiresAt: '2026-04-15T10:10:00.000Z',
    });
    expect(revoked).toEqual({ ok: true, state: { pendingPairings: [], sessions: [] } });
    expect(layout).toEqual({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-2'],
      archivedSessionIds: ['conversation-3'],
    });
    expect(savedLayout).toEqual({
      ok: true,
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
    });
  });

  it('falls back to HTTP for desktop runtime status bridges on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ profile: 'assistant', repoRoot: '/remote-repo', activityCount: 1, webUiRevision: 'rev-2' }))
      .mockResolvedValueOnce(createJsonResponse({ warnings: [], service: { running: true }, runtime: { running: true }, log: { lines: [] } }))
      .mockResolvedValueOnce(createJsonResponse({ warnings: [], service: { running: true, url: 'https://agent.example.com' }, log: { lines: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    const readAppStatus = vi.fn();
    const readDaemonState = vi.fn();
    const readWebUiState = vi.fn();
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
        readAppStatus,
        readDaemonState,
        readWebUiState,
      },
    });

    const { api } = await import('./api');
    const status = await api.status();
    const daemon = await api.daemon();
    const webUiState = await api.webUiState();

    expect(readAppStatus).not.toHaveBeenCalled();
    expect(readDaemonState).not.toHaveBeenCalled();
    expect(readWebUiState).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/status', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/daemon', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/web-ui/state', { method: 'GET', cache: 'no-store' });
    expect(status).toEqual({ profile: 'assistant', repoRoot: '/remote-repo', activityCount: 1, webUiRevision: 'rev-2' });
    expect(daemon).toEqual({ warnings: [], service: { running: true }, runtime: { running: true }, log: { lines: [] } });
    expect(webUiState).toEqual({ warnings: [], service: { running: true, url: 'https://agent.example.com' }, log: { lines: [] } });
  });

  it('falls back to HTTP for desktop durable-run attention on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const markDurableRunAttention = vi.fn();
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
        markDurableRunAttention,
      },
    });

    const { api } = await import('./api');
    const result = await api.markDurableRunAttentionRead('run-1', false);

    expect(markDurableRunAttention).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/runs/run-1/attention', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ read: false }),
    });
    expect(result).toEqual({ ok: true });
  });

  it('falls back to HTTP for desktop model and provider settings on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ currentModel: 'remote-model', currentThinkingLevel: 'medium', models: [] }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true }))
      .mockResolvedValueOnce(createJsonResponse({ providers: [{ id: 'remote-provider', models: [] }] }))
      .mockResolvedValueOnce(createJsonResponse({ providers: [{ id: 'remote-auth', authType: 'api_key' }] }))
      .mockResolvedValueOnce(createJsonResponse({ id: 'login-1', provider: 'remote-auth', providerName: 'Remote Auth', status: 'running' }));
    vi.stubGlobal('fetch', fetchMock);
    const readModels = vi.fn();
    const readModelProviders = vi.fn();
    const readProviderAuth = vi.fn();
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
        readModels,
        readModelProviders,
        readProviderAuth,
      },
    });

    const { api } = await import('./api');
    const models = await api.models();
    const updated = await api.updateModelPreferences({ thinkingLevel: 'medium' });
    const providers = await api.modelProviders();
    const auth = await api.providerAuth();
    const submitted = await api.submitProviderOAuthLoginInput('login-1', '123456');

    expect(readModels).not.toHaveBeenCalled();
    expect(readModelProviders).not.toHaveBeenCalled();
    expect(readProviderAuth).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/models', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/models/current', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thinkingLevel: 'medium' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/model-providers', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/provider-auth', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/provider-auth/oauth/login-1/input', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '123456' }),
    });
    expect(models).toEqual({ currentModel: 'remote-model', currentThinkingLevel: 'medium', models: [] });
    expect(updated).toEqual({ ok: true });
    expect(providers).toEqual({ providers: [{ id: 'remote-provider', models: [] }] });
    expect(auth).toEqual({ providers: [{ id: 'remote-auth', authType: 'api_key' }] });
    expect(submitted).toEqual({ id: 'login-1', provider: 'remote-auth', providerName: 'Remote Auth', status: 'running' });
  });

  it('falls back to HTTP for live-session list and stats on non-local desktop hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse([
        { id: 'remote-live', cwd: '/remote', sessionFile: '/tmp/remote-live.jsonl', title: 'Remote live', isStreaming: false },
      ]))
      .mockResolvedValueOnce(createJsonResponse({ tokens: { input: 3, output: 5, total: 8 }, cost: 0.1 }));
    vi.stubGlobal('fetch', fetchMock);
    const readLiveSessions = vi.fn();
    const readLiveSessionStats = vi.fn();
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
        readLiveSessions,
        readLiveSessionStats,
      },
    });

    const { api } = await import('./api');
    const liveSessions = await api.liveSessions();
    const stats = await api.liveSessionStats('remote-live');

    expect(readLiveSessions).not.toHaveBeenCalled();
    expect(readLiveSessionStats).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/live-sessions', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/live-sessions/remote-live/stats', { method: 'GET', cache: 'no-store' });
    expect(liveSessions).toEqual([
      { id: 'remote-live', cwd: '/remote', sessionFile: '/tmp/remote-live.jsonl', title: 'Remote live', isStreaming: false },
    ]);
    expect(stats).toEqual({ tokens: { input: 3, output: 5, total: 8 }, cost: 0.1 });
  });

  it('falls back to HTTP for desktop conversation artifact and attachment bridges on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', artifacts: [{ id: 'artifact-1', title: 'Artifact 1', kind: 'html' }] }))
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', artifact: { id: 'artifact-1', title: 'Artifact 1', kind: 'html', content: '<p>Artifact</p>' } }))
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', deleted: true, artifactId: 'artifact-1', artifacts: [] }))
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', attachments: [{ id: 'attachment-1', kind: 'excalidraw' }] }))
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } } }))
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } }, attachments: [{ id: 'attachment-1', kind: 'excalidraw' }] }))
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 2, latestRevision: { revision: 2 } }, attachments: [{ id: 'attachment-1', kind: 'excalidraw' }] }))
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', deleted: true, attachmentId: 'attachment-1', attachments: [] }))
      .mockResolvedValueOnce(new Response('preview-bytes', {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': 'inline; filename="preview.png"',
        },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const readConversationArtifacts = vi.fn();
    const readConversationArtifact = vi.fn();
    const deleteConversationArtifact = vi.fn();
    const readConversationAttachments = vi.fn();
    const readConversationAttachment = vi.fn();
    const createConversationAttachment = vi.fn();
    const updateConversationAttachment = vi.fn();
    const deleteConversationAttachment = vi.fn();
    const readConversationAttachmentAsset = vi.fn();
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
        readConversationArtifacts,
        readConversationArtifact,
        deleteConversationArtifact,
        readConversationAttachments,
        readConversationAttachment,
        createConversationAttachment,
        updateConversationAttachment,
        deleteConversationAttachment,
        readConversationAttachmentAsset,
      },
    });

    const { api } = await import('./api');
    const artifacts = await api.conversationArtifacts('conversation-1');
    const artifact = await api.conversationArtifact('conversation-1', 'artifact-1');
    const deletedArtifact = await api.deleteConversationArtifact('conversation-1', 'artifact-1');
    const attachments = await api.conversationAttachments('conversation-1');
    const attachment = await api.conversationAttachment('conversation-1', 'attachment-1');
    const createdAttachment = await api.createConversationAttachment('conversation-1', { sourceData: 'source', previewData: 'preview' });
    const updatedAttachment = await api.updateConversationAttachment('conversation-1', 'attachment-1', { sourceData: 'source', previewData: 'preview' });
    const deletedAttachment = await api.deleteConversationAttachment('conversation-1', 'attachment-1');
    const attachmentAsset = await api.conversationAttachmentAsset('conversation-1', 'attachment-1', 'preview', 2);

    expect(readConversationArtifacts).not.toHaveBeenCalled();
    expect(readConversationArtifact).not.toHaveBeenCalled();
    expect(deleteConversationArtifact).not.toHaveBeenCalled();
    expect(readConversationAttachments).not.toHaveBeenCalled();
    expect(readConversationAttachment).not.toHaveBeenCalled();
    expect(createConversationAttachment).not.toHaveBeenCalled();
    expect(updateConversationAttachment).not.toHaveBeenCalled();
    expect(deleteConversationAttachment).not.toHaveBeenCalled();
    expect(readConversationAttachmentAsset).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/conversations/conversation-1/artifacts', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/conversations/conversation-1/artifacts/artifact-1', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/conversations/conversation-1/artifacts/artifact-1', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: undefined });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/conversations/conversation-1/attachments', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/conversations/conversation-1/attachments/attachment-1', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/conversations/conversation-1/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceData: 'source', previewData: 'preview' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/conversations/conversation-1/attachments/attachment-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceData: 'source', previewData: 'preview' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(8, '/api/conversations/conversation-1/attachments/attachment-1', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(9, '/api/conversations/conversation-1/attachments/attachment-1/download/preview?revision=2', {
      method: 'GET',
      cache: 'no-store',
    });
    expect(artifacts).toEqual({ conversationId: 'conversation-1', artifacts: [{ id: 'artifact-1', title: 'Artifact 1', kind: 'html' }] });
    expect(artifact).toEqual({ conversationId: 'conversation-1', artifact: { id: 'artifact-1', title: 'Artifact 1', kind: 'html', content: '<p>Artifact</p>' } });
    expect(deletedArtifact).toEqual({ conversationId: 'conversation-1', deleted: true, artifactId: 'artifact-1', artifacts: [] });
    expect(attachments).toEqual({ conversationId: 'conversation-1', attachments: [{ id: 'attachment-1', kind: 'excalidraw' }] });
    expect(attachment).toEqual({ conversationId: 'conversation-1', attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } } });
    expect(createdAttachment).toEqual({ conversationId: 'conversation-1', attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } }, attachments: [{ id: 'attachment-1', kind: 'excalidraw' }] });
    expect(updatedAttachment).toEqual({ conversationId: 'conversation-1', attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 2, latestRevision: { revision: 2 } }, attachments: [{ id: 'attachment-1', kind: 'excalidraw' }] });
    expect(deletedAttachment).toEqual({ conversationId: 'conversation-1', deleted: true, attachmentId: 'attachment-1', attachments: [] });
    expect(attachmentAsset).toEqual({
      dataUrl: 'data:image/png;base64,cHJldmlldy1ieXRlcw==',
      mimeType: 'image/png',
      fileName: 'preview.png',
    });
  });

  it('falls back to HTTP for desktop conversation deferred-resume bridges on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', resumes: [{ id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z' }] }))
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' }, resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' }] }))
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', resume: { id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z', prompt: 'Resume now.' }, resumes: [] }))
      .mockResolvedValueOnce(createJsonResponse({ conversationId: 'conversation-1', cancelledId: 'resume-2', resumes: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const readConversationDeferredResumes = vi.fn();
    const scheduleConversationDeferredResume = vi.fn();
    const fireConversationDeferredResume = vi.fn();
    const cancelConversationDeferredResume = vi.fn();
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
        readConversationDeferredResumes,
        scheduleConversationDeferredResume,
        fireConversationDeferredResume,
        cancelConversationDeferredResume,
      },
    });

    const { api } = await import('./api');
    const resumes = await api.deferredResumes('conversation-1');
    const scheduled = await api.scheduleDeferredResume('conversation-1', { delay: '10m', prompt: 'Resume later.' });
    const fired = await api.fireDeferredResumeNow('conversation-1', 'resume-1');
    const cancelled = await api.cancelDeferredResume('conversation-1', 'resume-2');

    expect(readConversationDeferredResumes).not.toHaveBeenCalled();
    expect(scheduleConversationDeferredResume).not.toHaveBeenCalled();
    expect(fireConversationDeferredResume).not.toHaveBeenCalled();
    expect(cancelConversationDeferredResume).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/conversations/conversation-1/deferred-resumes', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/conversations/conversation-1/deferred-resumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delay: '10m', prompt: 'Resume later.' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/conversations/conversation-1/deferred-resumes/resume-1/fire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/conversations/conversation-1/deferred-resumes/resume-2', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    });
    expect(resumes).toEqual({ conversationId: 'conversation-1', resumes: [{ id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z' }] });
    expect(scheduled).toEqual({ conversationId: 'conversation-1', resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' }, resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' }] });
    expect(fired).toEqual({ conversationId: 'conversation-1', resume: { id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z', prompt: 'Resume now.' }, resumes: [] });
    expect(cancelled).toEqual({ conversationId: 'conversation-1', cancelledId: 'resume-2', resumes: [] });
  });

  it('falls back to HTTP for desktop session list, meta, and search-index reads on non-local hosts', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createJsonResponse([{ id: 'conversation-1', title: 'Conversation 1' }]))
      .mockResolvedValueOnce(createJsonResponse({ id: 'conversation-1', title: 'Conversation 1' }))
      .mockResolvedValueOnce(createJsonResponse({ index: { 'conversation-1': 'hello world' } }));
    vi.stubGlobal('fetch', fetchMock);
    const readSessions = vi.fn();
    const readSessionMeta = vi.fn();
    const readSessionSearchIndex = vi.fn();
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
        readSessions,
        readSessionMeta,
        readSessionSearchIndex,
      },
    });

    const { api } = await import('./api');
    const sessions = await api.sessions();
    const sessionMeta = await api.sessionMeta('conversation-1');
    const sessionSearchIndex = await api.sessionSearchIndex(['conversation-1']);

    expect(readSessions).not.toHaveBeenCalled();
    expect(readSessionMeta).not.toHaveBeenCalled();
    expect(readSessionSearchIndex).not.toHaveBeenCalled();
    expect(invokeLocalApi).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/sessions', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/sessions/conversation-1/meta', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/sessions/search-index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionIds: ['conversation-1'] }),
    });
    expect(sessions).toEqual([{ id: 'conversation-1', title: 'Conversation 1' }]);
    expect(sessionMeta).toEqual({ id: 'conversation-1', title: 'Conversation 1' });
    expect(sessionSearchIndex).toEqual({ index: { 'conversation-1': 'hello world' } });
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
