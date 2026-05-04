import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConversationBootstrapState } from '../shared/types';

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

  it('falls back to app-protocol API routes when the local desktop bridge omits memory and tools readers', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          agentsMd: [],
          skills: [
            {
              source: 'global',
              name: 'checkpoint',
              description: "Commit and push the agent's current work.",
              path: '/vault/skills/checkpoint/SKILL.md',
            },
          ],
          memoryDocs: [],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          cwd: '/repo',
          activeTools: [],
          tools: [],
          newSessionSystemPrompt: '',
          newSessionInjectedMessages: [],
          newSessionToolDefinitions: [],
          dependentCliTools: [],
          mcp: { servers: [], missingCli: [] },
          packageInstall: { available: false, managers: [] },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const getEnvironment = vi.fn().mockResolvedValue({
      isElectron: true,
      activeHostId: 'local',
      activeHostLabel: 'Local',
      activeHostKind: 'local',
      activeHostSummary: 'Local backend is healthy.',
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment,
      },
    });

    const { api } = await import('./api');
    const memory = await api.memory();
    const tools = await api.tools();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/memory');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/tools');
    expect(memory.skills[0]?.name).toBe('checkpoint');
    expect(tools.cwd).toBe('/repo');
  });

  it('uses dedicated desktop capability bridges on the local Electron host', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(createJsonResponse({})));
    vi.stubGlobal('fetch', fetchMock);
    const readAppStatus = vi.fn().mockResolvedValue({
      repoRoot: '/repo',
      appRevision: 'rev-1',
    });
    const readDaemonState = vi.fn().mockResolvedValue({
      warnings: [],
      service: { platform: 'desktop', identifier: 'daemon', manifestPath: '/tmp/daemon.plist', installed: true, running: true },
      runtime: { running: true, socketPath: '/tmp/daemon.sock', moduleCount: 3 },
      log: { lines: [] },
    });
    const readSessions = vi.fn().mockResolvedValue([{ id: 'conversation-1', title: 'Conversation 1' }]);
    const readSessionMeta = vi.fn().mockResolvedValue({ id: 'conversation-1', title: 'Conversation 1' });
    const readSessionSearchIndex = vi.fn().mockResolvedValue({ index: { 'conversation-1': 'hello world' } });
    const readModels = vi.fn().mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      models: [{ id: 'gpt-5.4', provider: 'openai-codex', name: 'GPT-5.4', context: 272_000 }],
    });
    const updateModelPreferences = vi.fn().mockResolvedValue({ ok: true });
    const readModelProviders = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const saveModelProvider = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const deleteModelProvider = vi.fn().mockResolvedValue({ providers: [] });
    const saveModelProviderModel = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [{ id: 'model-a' }] }] });
    const deleteModelProviderModel = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const readProviderAuth = vi.fn().mockResolvedValue({ providers: [{ id: 'openai', authType: 'api_key' }] });
    const setProviderApiKey = vi.fn().mockResolvedValue({ providers: [{ id: 'openai', authType: 'api_key' }] });
    const removeProviderCredential = vi.fn().mockResolvedValue({ providers: [] });
    const startProviderOAuthLogin = vi.fn().mockResolvedValue({
      id: 'login-1',
      provider: 'openrouter',
      providerName: 'OpenRouter',
      status: 'running',
    });
    const readProviderOAuthLogin = vi.fn().mockResolvedValue({
      id: 'login-1',
      provider: 'openrouter',
      providerName: 'OpenRouter',
      status: 'running',
    });
    const submitProviderOAuthLoginInput = vi.fn().mockResolvedValue({
      id: 'login-1',
      provider: 'openrouter',
      providerName: 'OpenRouter',
      status: 'running',
    });
    const cancelProviderOAuthLogin = vi.fn().mockResolvedValue({
      id: 'login-1',
      provider: 'openrouter',
      providerName: 'OpenRouter',
      status: 'cancelled',
    });
    const markConversationAttention = vi.fn().mockResolvedValue({ ok: true });
    const readScheduledTasks = vi.fn().mockResolvedValue([
      {
        id: 'task-1',
        scheduleType: 'cron',
        running: false,
        enabled: true,
        prompt: 'Prompt',
        title: 'Task 1',
      },
    ]);
    const readScheduledTaskDetail = vi.fn().mockResolvedValue({
      id: 'task-1',
      scheduleType: 'cron',
      running: false,
      enabled: true,
      prompt: 'Prompt body',
      threadMode: 'dedicated',
    });
    const readScheduledTaskLog = vi.fn().mockResolvedValue({ path: '/tasks/task-1.log', log: 'task tail' });
    const createScheduledTask = vi.fn().mockResolvedValue({
      ok: true,
      task: { id: 'task-2', scheduleType: 'cron', running: false, enabled: true, prompt: 'Created task body', threadMode: 'dedicated' },
    });
    const updateScheduledTask = vi.fn().mockResolvedValue({
      ok: true,
      task: { id: 'task-1', scheduleType: 'cron', running: false, enabled: false, prompt: 'Updated task body', threadMode: 'dedicated' },
    });
    const runScheduledTask = vi.fn().mockResolvedValue({ ok: true, accepted: true, runId: 'run-from-task' });
    const readDurableRuns = vi.fn().mockResolvedValue({
      scannedAt: '2026-04-10T11:00:00.000Z',
      runsRoot: '/runs',
      summary: { total: 0, recoveryActions: {}, statuses: {} },
      runs: [],
    });
    const readDurableRun = vi.fn().mockResolvedValue({
      scannedAt: '2026-04-10T11:00:00.000Z',
      runsRoot: '/runs',
      run: { runId: 'run-1' },
    });
    const readDurableRunLog = vi.fn().mockResolvedValue({ path: '/runs/run-1.log', log: 'tail' });
    const cancelDurableRun = vi.fn().mockResolvedValue({ cancelled: true, runId: 'run-1' });
    const markDurableRunAttention = vi.fn().mockResolvedValue({ ok: true });
    const readConversationBootstrap = vi.fn().mockResolvedValue(createBootstrapState());
    const renameConversation = vi.fn().mockResolvedValue({ ok: true, title: 'Renamed conversation' });
    const changeConversationCwd = vi.fn().mockResolvedValue({
      id: 'live-1',
      sessionFile: '/tmp/live-1.jsonl',
      cwd: '/next-repo',
      changed: true,
    });
    const recoverConversation = vi.fn().mockResolvedValue({
      conversationId: 'live-1',
      live: true,
      recovered: true,
      replayedPendingOperation: false,
      usedFallbackPrompt: true,
    });
    const readLiveSessionForkEntries = vi.fn().mockResolvedValue([{ entryId: 'entry-1', text: 'fork from here' }]);
    const readConversationModelPreferences = vi.fn().mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });
    const updateConversationModelPreferences = vi.fn().mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'medium',
      currentServiceTier: 'priority',
      hasExplicitServiceTier: true,
    });
    const readLiveSession = vi.fn().mockResolvedValue({ live: true, id: 'live-1' });
    const readLiveSessionContext = vi.fn().mockResolvedValue({ cwd: '/repo', branch: 'main', git: null });
    const readSessionDetail = vi.fn().mockResolvedValue({
      meta: { id: 'live-1' },
      blocks: [],
      blockOffset: 0,
      totalBlocks: 0,
      contextUsage: null,
    });
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
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment,
        readAppStatus,
        readDaemonState,
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
        setProviderApiKey,
        removeProviderCredential,
        startProviderOAuthLogin,
        readProviderOAuthLogin,
        submitProviderOAuthLoginInput,
        cancelProviderOAuthLogin,
        markConversationAttention,
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
    const daemon = await api.daemon();
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
    const providerApiKey = await api.setProviderApiKey('openai', 'sk-test');
    const removedProviderCredential = await api.removeProviderCredential('openai');
    const startedProviderOAuthLogin = await api.startProviderOAuthLogin('openrouter');
    const providerOAuthLogin = await api.providerOAuthLogin('login-1');
    const submittedProviderOAuthLoginInput = await api.submitProviderOAuthLoginInput('login-1', '123456');
    const cancelledProviderOAuthLogin = await api.cancelProviderOAuthLogin('login-1');
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
    const live = await api.liveSession('live-1');
    const forkEntries = await api.forkEntries('live-1');
    const liveContext = await api.liveSessionContext('live-1');
    const sessionDetail = await api.sessionDetail('live-1', { tailBlocks: 24 });
    const sessionBlock = await api.sessionBlock('live-1', 'block-1');
    const created = await api.createLiveSession('/repo', undefined, { model: 'gpt-5.4' });
    const resumed = await api.resumeSession('/tmp/live-1.jsonl', '/repo');
    const takeover = await api.takeoverLiveSession('live-1', 'surface-1');
    const prompted = await api.promptSession('live-1', 'hello', 'followUp', [], [], 'surface-1');
    const restored = await api.restoreQueuedMessage('live-1', { behavior: 'followUp', index: 0, previewId: 'queue-1' }, 'surface-1');
    const compacted = await api.compactSession('live-1', 'be shorter', 'surface-1');
    const exported = await api.exportSession('live-1', '/tmp/live-1.html');
    const reloaded = await api.reloadSession('live-1', 'surface-1');
    const branched = await api.branchSession('live-1', 'entry-1', 'surface-1');
    const forked = await api.forkSession('live-1', 'entry-1', { preserveSource: true, beforeEntry: true }, 'surface-1');
    const summaryFork = await api.summarizeAndForkSession('live-1', 'surface-1');
    const aborted = await api.abortSession('live-1', 'surface-1');
    const destroyed = await api.destroySession('conversation-1', 'surface-1');

    expect(getEnvironment).toHaveBeenCalledTimes(1);
    expect(readAppStatus).toHaveBeenCalledTimes(1);
    expect(readDaemonState).toHaveBeenCalledTimes(1);
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
    expect(setProviderApiKey).toHaveBeenCalledWith({ provider: 'openai', apiKey: 'sk-test' });
    expect(removeProviderCredential).toHaveBeenCalledWith('openai');
    expect(startProviderOAuthLogin).toHaveBeenCalledWith('openrouter');
    expect(readProviderOAuthLogin).toHaveBeenCalledWith('login-1');
    expect(submitProviderOAuthLoginInput).toHaveBeenCalledWith({ loginId: 'login-1', value: '123456' });
    expect(cancelProviderOAuthLogin).toHaveBeenCalledWith('login-1');
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
    expect(readLiveSession).toHaveBeenCalledWith('live-1');
    expect(readLiveSessionForkEntries).toHaveBeenCalledWith('live-1');
    expect(readLiveSessionContext).toHaveBeenCalledWith('live-1');
    expect(readSessionDetail).toHaveBeenCalledWith({ sessionId: 'live-1', tailBlocks: 24 });
    expect(readSessionBlock).toHaveBeenCalledWith({ sessionId: 'live-1', blockId: 'block-1' });
    expect(createLiveSession).toHaveBeenCalledWith({ cwd: '/repo', model: 'gpt-5.4' });
    expect(resumeLiveSession).toHaveBeenCalledWith({ sessionFile: '/tmp/live-1.jsonl', cwd: '/repo' });
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
    expect(forkLiveSession).toHaveBeenCalledWith({
      conversationId: 'live-1',
      entryId: 'entry-1',
      preserveSource: true,
      beforeEntry: true,
    });
    expect(summarizeAndForkLiveSession).toHaveBeenCalledWith('live-1');
    expect(abortLiveSession).toHaveBeenCalledWith('live-1');
    expect(destroyLiveSession).toHaveBeenCalledWith('conversation-1');
    expect(status).toEqual({
      repoRoot: '/repo',
      appRevision: 'rev-1',
    });
    expect(daemon).toEqual({
      warnings: [],
      service: { platform: 'desktop', identifier: 'daemon', manifestPath: '/tmp/daemon.plist', installed: true, running: true },
      runtime: { running: true, socketPath: '/tmp/daemon.sock', moduleCount: 3 },
      log: { lines: [] },
    });
    expect(sessions).toEqual([{ id: 'conversation-1', title: 'Conversation 1' }]);
    expect(sessionMeta).toEqual({ id: 'conversation-1', title: 'Conversation 1' });
    expect(sessionSearchIndex).toEqual({ index: { 'conversation-1': 'hello world' } });
    expect(models).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      models: [{ id: 'gpt-5.4', provider: 'openai-codex', name: 'GPT-5.4', context: 272_000 }],
    });
    expect(modelPreferenceUpdate).toEqual({ ok: true });
    expect(modelProviders).toEqual({ providers: [{ id: 'openrouter', models: [] }] });
    expect(savedModelProvider).toEqual({ providers: [{ id: 'openrouter', models: [] }] });
    expect(removedModelProvider).toEqual({ providers: [] });
    expect(savedModelProviderModel).toEqual({ providers: [{ id: 'openrouter', models: [{ id: 'model-a' }] }] });
    expect(removedModelProviderModel).toEqual({ providers: [{ id: 'openrouter', models: [] }] });
    expect(providerAuth).toEqual({ providers: [{ id: 'openai', authType: 'api_key' }] });
    expect(providerApiKey).toEqual({ providers: [{ id: 'openai', authType: 'api_key' }] });
    expect(removedProviderCredential).toEqual({ providers: [] });
    expect(startedProviderOAuthLogin).toEqual({ id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'running' });
    expect(providerOAuthLogin).toEqual({ id: 'login-1', provider: 'openrouter', providerName: 'OpenRouter', status: 'running' });
    expect(submittedProviderOAuthLoginInput).toEqual({
      id: 'login-1',
      provider: 'openrouter',
      providerName: 'OpenRouter',
      status: 'running',
    });
    expect(cancelledProviderOAuthLogin).toEqual({
      id: 'login-1',
      provider: 'openrouter',
      providerName: 'OpenRouter',
      status: 'cancelled',
    });
    expect(attentionMarked).toEqual({ ok: true });
    expect(tasks).toEqual([{ id: 'task-1', scheduleType: 'cron', running: false, enabled: true, prompt: 'Prompt', title: 'Task 1' }]);
    expect(taskDetail).toEqual({
      id: 'task-1',
      scheduleType: 'cron',
      running: false,
      enabled: true,
      prompt: 'Prompt body',
      threadMode: 'dedicated',
    });
    expect(taskLog).toEqual({ path: '/tasks/task-1.log', log: 'task tail' });
    expect(createdTask).toEqual({
      ok: true,
      task: { id: 'task-2', scheduleType: 'cron', running: false, enabled: true, prompt: 'Created task body', threadMode: 'dedicated' },
    });
    expect(toggledTask).toEqual({
      ok: true,
      task: { id: 'task-1', scheduleType: 'cron', running: false, enabled: false, prompt: 'Updated task body', threadMode: 'dedicated' },
    });
    expect(savedTask).toEqual({
      ok: true,
      task: { id: 'task-1', scheduleType: 'cron', running: false, enabled: false, prompt: 'Updated task body', threadMode: 'dedicated' },
    });
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
    expect(modelPreferences).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });
    expect(updatedModelPreferences).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'medium',
      currentServiceTier: 'priority',
      hasExplicitServiceTier: true,
    });
    expect(live).toEqual({ live: true, id: 'live-1' });
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

  it('uses dedicated desktop conversation artifact and attachment bridges on the local Electron host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const readConversationArtifacts = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      artifacts: [{ id: 'artifact-1', title: 'Artifact 1', kind: 'html' }],
    });
    const readConversationArtifact = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      artifact: { id: 'artifact-1', title: 'Artifact 1', kind: 'html', content: '<p>Artifact</p>' },
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
        }),
        readConversationArtifacts,
        readConversationArtifact,
        readConversationAttachments,
        readConversationAttachment,
        createConversationAttachment,
        updateConversationAttachment,
        readConversationAttachmentAsset,
      },
    });

    const { api } = await import('./api');
    const artifacts = await api.conversationArtifacts('conversation-1');
    const artifact = await api.conversationArtifact('conversation-1', 'artifact-1');
    const attachments = await api.conversationAttachments('conversation-1');
    const attachment = await api.conversationAttachment('conversation-1', 'attachment-1');
    const createdAttachment = await api.createConversationAttachment('conversation-1', { sourceData: 'source', previewData: 'preview' });
    const updatedAttachment = await api.updateConversationAttachment('conversation-1', 'attachment-1', {
      sourceData: 'source',
      previewData: 'preview',
    });
    const attachmentAsset = await api.conversationAttachmentAsset('conversation-1', 'attachment-1', 'preview', 2);

    expect(readConversationArtifacts).toHaveBeenCalledWith('conversation-1');
    expect(readConversationArtifact).toHaveBeenCalledWith({ conversationId: 'conversation-1', artifactId: 'artifact-1' });
    expect(readConversationAttachments).toHaveBeenCalledWith('conversation-1');
    expect(readConversationAttachment).toHaveBeenCalledWith({ conversationId: 'conversation-1', attachmentId: 'attachment-1' });
    expect(createConversationAttachment).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      sourceData: 'source',
      previewData: 'preview',
    });
    expect(updateConversationAttachment).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      attachmentId: 'attachment-1',
      sourceData: 'source',
      previewData: 'preview',
    });
    expect(readConversationAttachmentAsset).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      attachmentId: 'attachment-1',
      asset: 'preview',
      revision: 2,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(artifacts).toEqual({
      conversationId: 'conversation-1',
      artifacts: [{ id: 'artifact-1', title: 'Artifact 1', kind: 'html' }],
    });
    expect(artifact).toEqual({
      conversationId: 'conversation-1',
      artifact: { id: 'artifact-1', title: 'Artifact 1', kind: 'html', content: '<p>Artifact</p>' },
    });
    expect(attachments).toEqual({ conversationId: 'conversation-1', attachments: [{ id: 'attachment-1', kind: 'excalidraw' }] });
    expect(attachment).toEqual({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
    });
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
    expect(attachmentAsset).toEqual({
      dataUrl: 'data:image/png;base64,cHJldmlldw==',
      mimeType: 'image/png',
      fileName: 'preview.png',
    });
  });

  it('uses dedicated desktop conversation deferred-resume bridges on the local Electron host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const readConversationDeferredResumes = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      resumes: [{ id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z' }],
    });
    const scheduleConversationDeferredResume = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' },
      resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' }],
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
        }),
        readConversationDeferredResumes,
        scheduleConversationDeferredResume,
        fireConversationDeferredResume,
        cancelConversationDeferredResume,
      },
    });

    const { api } = await import('./api');
    const resumes = await api.deferredResumes('conversation-1');
    const scheduled = await api.scheduleDeferredResume('conversation-1', { delay: '10m', prompt: 'Resume later.', behavior: 'followUp' });
    const fired = await api.fireDeferredResumeNow('conversation-1', 'resume-1');
    const cancelled = await api.cancelDeferredResume('conversation-1', 'resume-2');

    expect(readConversationDeferredResumes).toHaveBeenCalledWith('conversation-1');
    expect(scheduleConversationDeferredResume).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      delay: '10m',
      prompt: 'Resume later.',
      behavior: 'followUp',
    });
    expect(fireConversationDeferredResume).toHaveBeenCalledWith({ conversationId: 'conversation-1', resumeId: 'resume-1' });
    expect(cancelConversationDeferredResume).toHaveBeenCalledWith({ conversationId: 'conversation-1', resumeId: 'resume-2' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(resumes).toEqual({
      conversationId: 'conversation-1',
      resumes: [{ id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z' }],
    });
    expect(scheduled).toEqual({
      conversationId: 'conversation-1',
      resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' },
      resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' }],
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
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const readDefaultCwd = vi.fn().mockResolvedValue({ currentCwd: '', effectiveCwd: '/repo' });
    const updateDefaultCwd = vi.fn().mockResolvedValue({ currentCwd: './repo', effectiveCwd: '/repo' });
    const pickFolder = vi.fn().mockResolvedValue({ path: '/picked/repo', cancelled: false });
    const readConversationTitleSettings = vi.fn().mockResolvedValue({
      enabled: true,
      currentModel: '',
      effectiveModel: 'openai/gpt-5.4',
    });
    const updateConversationTitleSettings = vi.fn().mockResolvedValue({
      enabled: false,
      currentModel: 'anthropic/claude-sonnet-4-6',
      effectiveModel: 'anthropic/claude-sonnet-4-6',
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
        }),
        readDefaultCwd,
        updateDefaultCwd,
        pickFolder,
        readConversationTitleSettings,
        updateConversationTitleSettings,
      },
    });

    const { api } = await import('./api');
    const defaultCwd = await api.defaultCwd();
    const savedDefaultCwd = await api.updateDefaultCwd('./repo');
    const conversationTitleSettings = await api.conversationTitleSettings();
    const savedConversationTitleSettings = await api.updateConversationTitleSettings({
      enabled: false,
      model: 'anthropic/claude-sonnet-4-6',
    });

    expect(readDefaultCwd).toHaveBeenCalledTimes(1);
    expect(updateDefaultCwd).toHaveBeenCalledWith('./repo');
    expect(readConversationTitleSettings).toHaveBeenCalledTimes(1);
    expect(updateConversationTitleSettings).toHaveBeenCalledWith({ enabled: false, model: 'anthropic/claude-sonnet-4-6' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(defaultCwd).toEqual({ currentCwd: '', effectiveCwd: '/repo' });
    expect(savedDefaultCwd).toEqual({ currentCwd: './repo', effectiveCwd: '/repo' });
    expect(conversationTitleSettings).toEqual({ enabled: true, currentModel: '', effectiveModel: 'openai/gpt-5.4' });
    expect(savedConversationTitleSettings).toEqual({
      enabled: false,
      currentModel: 'anthropic/claude-sonnet-4-6',
      effectiveModel: 'anthropic/claude-sonnet-4-6',
    });
  });

  it('uses HTTP for vault files and the desktop bridge for folder picking on the local Electron host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createJsonResponse({
        root: '/vault',
        files: [
          {
            id: 'notes/a.md',
            kind: 'file',
            name: 'a.md',
            path: '/vault/notes/a.md',
            sizeBytes: 12,
            updatedAt: '2026-04-18T12:00:00.000Z',
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const readVaultFiles = vi.fn();
    const pickFolder = vi.fn().mockResolvedValue({ path: '/picked/repo', cancelled: false });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
        }),
        readVaultFiles,
        pickFolder,
      },
    });

    const { api } = await import('./api');
    const vaultFiles = await api.vaultFiles();
    const pickedFolder = await api.pickFolder('/repo');

    expect(readVaultFiles).not.toHaveBeenCalled();
    expect(pickFolder).toHaveBeenCalledWith({ cwd: '/repo' });
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/vault-files', { method: 'GET', cache: 'no-store' });
    expect(vaultFiles).toEqual({
      root: '/vault',
      files: [
        {
          id: 'notes/a.md',
          kind: 'file',
          name: 'a.md',
          path: '/vault/notes/a.md',
          sizeBytes: 12,
          updatedAt: '2026-04-18T12:00:00.000Z',
        },
      ],
    });
    expect(pickedFolder).toEqual({ path: '/picked/repo', cancelled: false });
  });

  it('passes custom folder picker prompts through the local desktop bridge', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const pickFolder = vi.fn().mockResolvedValue({ path: '/picked/vault', cancelled: false });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
        }),
        pickFolder,
      },
    });

    const { api } = await import('./api');
    const pickedFolder = await api.pickFolder({ cwd: '/repo', prompt: 'Choose folder' });

    expect(pickFolder).toHaveBeenCalledWith({ cwd: '/repo', prompt: 'Choose folder' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pickedFolder).toEqual({ path: '/picked/vault', cancelled: false });
  });

  it('uses the dedicated desktop automation workspace bridge on the local Electron host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
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
        }),
        readConversationPlansWorkspace,
      },
    });

    const { api } = await import('./api');
    const workspace = await api.conversationPlansWorkspace();

    expect(readConversationPlansWorkspace).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(workspace).toEqual({
      defaultEnabled: true,
      presetLibrary: {
        presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
        defaultPresetIds: ['preset-1'],
      },
    });
  });

  it('uses dedicated desktop open-conversation bridges on the local Electron host', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const readOpenConversationTabs = vi.fn().mockResolvedValue({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-2'],
      archivedSessionIds: ['conversation-3'],
      workspacePaths: ['/tmp/alpha'],
    });
    const updateOpenConversationTabs = vi.fn().mockResolvedValue({
      ok: true,
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
      workspacePaths: ['/tmp/beta'],
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
        }),
        readOpenConversationTabs,
        updateOpenConversationTabs,
      },
    });

    const { api } = await import('./api');
    const layout = await api.openConversationTabs();
    const savedLayout = await api.setOpenConversationTabs(['conversation-4'], ['conversation-5'], ['conversation-6']);

    expect(readOpenConversationTabs).toHaveBeenCalledTimes(1);
    expect(updateOpenConversationTabs).toHaveBeenCalledWith({
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(layout).toEqual({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-2'],
      archivedSessionIds: ['conversation-3'],
      workspacePaths: ['/tmp/alpha'],
    });
    expect(savedLayout).toEqual({
      ok: true,
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
      workspacePaths: ['/tmp/beta'],
    });
  });

  it('falls back to HTTP for desktop operator settings on non-local hosts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ currentCwd: '', effectiveCwd: '/repo' }))
      .mockResolvedValueOnce(createJsonResponse({ currentCwd: './repo', effectiveCwd: '/repo' }))
      .mockResolvedValueOnce(createJsonResponse({ enabled: true, currentModel: '', effectiveModel: 'openai/gpt-5.4' }))
      .mockResolvedValueOnce(
        createJsonResponse({
          enabled: false,
          currentModel: 'anthropic/claude-sonnet-4-6',
          effectiveModel: 'anthropic/claude-sonnet-4-6',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const readDefaultCwd = vi.fn();
    const readConversationTitleSettings = vi.fn();
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'web-1',
          activeHostLabel: 'Tailnet',
          activeHostKind: 'web',
          activeHostSummary: 'Remote host reachable.',
        }),
        readDefaultCwd,
        readConversationTitleSettings,
      },
    });

    const { api } = await import('./api');
    const defaultCwd = await api.defaultCwd();
    const savedDefaultCwd = await api.updateDefaultCwd('./repo');
    const conversationTitleSettings = await api.conversationTitleSettings();
    const savedConversationTitleSettings = await api.updateConversationTitleSettings({
      enabled: false,
      model: 'anthropic/claude-sonnet-4-6',
    });

    expect(readDefaultCwd).not.toHaveBeenCalled();
    expect(readConversationTitleSettings).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/default-cwd', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/default-cwd', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: './repo' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/conversation-titles/settings', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/conversation-titles/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, model: 'anthropic/claude-sonnet-4-6' }),
    });
    expect(defaultCwd).toEqual({ currentCwd: '', effectiveCwd: '/repo' });
    expect(savedDefaultCwd).toEqual({ currentCwd: './repo', effectiveCwd: '/repo' });
    expect(conversationTitleSettings).toEqual({ enabled: true, currentModel: '', effectiveModel: 'openai/gpt-5.4' });
    expect(savedConversationTitleSettings).toEqual({
      enabled: false,
      currentModel: 'anthropic/claude-sonnet-4-6',
      effectiveModel: 'anthropic/claude-sonnet-4-6',
    });
  });

  it('falls back to HTTP for desktop vault-file and folder-picker bridges on non-local hosts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          root: '/vault',
          files: [
            {
              id: 'notes/a.md',
              kind: 'file',
              name: 'a.md',
              path: '/vault/notes/a.md',
              sizeBytes: 12,
              updatedAt: '2026-04-18T12:00:00.000Z',
            },
          ],
        }),
      )
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
        }),
        readVaultFiles,
        pickFolder,
      },
    });

    const { api } = await import('./api');
    const vaultFiles = await api.vaultFiles();
    const pickedFolder = await api.pickFolder({ cwd: '/repo', prompt: 'Choose folder' });

    expect(readVaultFiles).not.toHaveBeenCalled();
    expect(pickFolder).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/vault-files', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/folder-picker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '/repo', prompt: 'Choose folder' }),
    });
    expect(vaultFiles).toEqual({
      root: '/vault',
      files: [
        {
          id: 'notes/a.md',
          kind: 'file',
          name: 'a.md',
          path: '/vault/notes/a.md',
          sizeBytes: 12,
          updatedAt: '2026-04-18T12:00:00.000Z',
        },
      ],
    });
    expect(pickedFolder).toEqual({ path: '/picked/repo', cancelled: false });
  });

  it('falls back to HTTP for the automation workspace bridge on non-local hosts', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createJsonResponse({
        defaultEnabled: true,
        presetLibrary: {
          presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
          defaultPresetIds: ['preset-1'],
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const readConversationPlansWorkspace = vi.fn();
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'web-1',
          activeHostLabel: 'Tailnet',
          activeHostKind: 'web',
          activeHostSummary: 'Remote host reachable.',
        }),
        readConversationPlansWorkspace,
      },
    });

    const { api } = await import('./api');
    const workspace = await api.conversationPlansWorkspace();

    expect(readConversationPlansWorkspace).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/conversation-plans/workspace', { method: 'GET', cache: 'no-store' });
    expect(workspace).toEqual({
      defaultEnabled: true,
      presetLibrary: {
        presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
        defaultPresetIds: ['preset-1'],
      },
    });
  });

  it('falls back to HTTP for desktop system admin bridges on non-local hosts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({
          sessionIds: ['conversation-1'],
          pinnedSessionIds: ['conversation-2'],
          archivedSessionIds: ['conversation-3'],
          workspacePaths: ['/tmp/alpha'],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          ok: true,
          sessionIds: ['conversation-4'],
          pinnedSessionIds: ['conversation-5'],
          archivedSessionIds: ['conversation-6'],
          workspacePaths: ['/tmp/beta'],
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
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
        }),
        readOpenConversationTabs,
        updateOpenConversationTabs,
      },
    });

    const { api } = await import('./api');
    const layout = await api.openConversationTabs();
    const savedLayout = await api.setOpenConversationTabs(['conversation-4'], ['conversation-5'], ['conversation-6']);

    expect(readOpenConversationTabs).not.toHaveBeenCalled();
    expect(updateOpenConversationTabs).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/ui/open-conversations', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/ui/open-conversations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionIds: ['conversation-4'],
        pinnedSessionIds: ['conversation-5'],
        archivedSessionIds: ['conversation-6'],
      }),
    });
    expect(layout).toEqual({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-2'],
      archivedSessionIds: ['conversation-3'],
      workspacePaths: ['/tmp/alpha'],
    });
    expect(savedLayout).toEqual({
      ok: true,
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
      workspacePaths: ['/tmp/beta'],
    });
  });

  it('falls back to HTTP for desktop runtime status bridges on non-local hosts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ repoRoot: '/remote-repo', appRevision: 'rev-2' }))
      .mockResolvedValueOnce(
        createJsonResponse({ warnings: [], service: { running: true }, runtime: { running: true }, log: { lines: [] } }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const readAppStatus = vi.fn();
    const readDaemonState = vi.fn();
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'web-1',
          activeHostLabel: 'Tailnet',
          activeHostKind: 'web',
          activeHostSummary: 'Remote host reachable.',
        }),
        readAppStatus,
        readDaemonState,
      },
    });

    const { api } = await import('./api');
    const status = await api.status();
    const daemon = await api.daemon();

    expect(readAppStatus).not.toHaveBeenCalled();
    expect(readDaemonState).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/status', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/daemon', { method: 'GET', cache: 'no-store' });
    expect(status).toEqual({ repoRoot: '/remote-repo', appRevision: 'rev-2' });
    expect(daemon).toEqual({ warnings: [], service: { running: true }, runtime: { running: true }, log: { lines: [] } });
  });

  it('falls back to HTTP for desktop durable-run attention on non-local hosts', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createJsonResponse({ ok: true }));
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

  it('falls back to HTTP when the local desktop bridge model read fails', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createJsonResponse({
        currentModel: 'http-model',
        currentThinkingLevel: 'medium',
        currentServiceTier: '',
        models: [{ id: 'http-model', provider: 'openai-codex', name: 'HTTP Model', context: 128_000 }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const readModels = vi.fn().mockRejectedValue(new Error('ipc failed'));
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
        }),
        readModels,
      },
    });

    const { api } = await import('./api');
    const models = await api.models();

    expect(readModels).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/models', { method: 'GET', cache: 'no-store' });
    expect(models).toEqual({
      currentModel: 'http-model',
      currentThinkingLevel: 'medium',
      currentServiceTier: '',
      models: [{ id: 'http-model', provider: 'openai-codex', name: 'HTTP Model', context: 128_000 }],
    });
  });

  it('falls back to HTTP when the local desktop bridge returns an empty model list', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      createJsonResponse({
        currentModel: 'http-model',
        currentThinkingLevel: 'medium',
        currentServiceTier: '',
        models: [{ id: 'http-model', provider: 'openai-codex', name: 'HTTP Model', context: 128_000 }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const readModels = vi.fn().mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      models: [],
    });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
        }),
        readModels,
      },
    });

    const { api } = await import('./api');
    const models = await api.models();

    expect(readModels).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/models', { method: 'GET', cache: 'no-store' });
    expect(models).toEqual({
      currentModel: 'http-model',
      currentThinkingLevel: 'medium',
      currentServiceTier: '',
      models: [{ id: 'http-model', provider: 'openai-codex', name: 'HTTP Model', context: 128_000 }],
    });
  });

  it('falls back to HTTP for desktop model and provider settings on non-local hosts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({ currentModel: 'remote-model', currentThinkingLevel: 'medium', currentServiceTier: '', models: [] }),
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true }))
      .mockResolvedValueOnce(createJsonResponse({ providers: [{ id: 'remote-provider', models: [] }] }))
      .mockResolvedValueOnce(createJsonResponse({ providers: [{ id: 'remote-auth', authType: 'api_key' }] }))
      .mockResolvedValueOnce(
        createJsonResponse({ id: 'login-1', provider: 'remote-auth', providerName: 'Remote Auth', status: 'running' }),
      );
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
    expect(models).toEqual({ currentModel: 'remote-model', currentThinkingLevel: 'medium', currentServiceTier: '', models: [] });
    expect(updated).toEqual({ ok: true });
    expect(providers).toEqual({ providers: [{ id: 'remote-provider', models: [] }] });
    expect(auth).toEqual({ providers: [{ id: 'remote-auth', authType: 'api_key' }] });
    expect(submitted).toEqual({ id: 'login-1', provider: 'remote-auth', providerName: 'Remote Auth', status: 'running' });
  });

  it('falls back to HTTP for desktop conversation artifact and attachment bridges on non-local hosts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({ conversationId: 'conversation-1', artifacts: [{ id: 'artifact-1', title: 'Artifact 1', kind: 'html' }] }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          conversationId: 'conversation-1',
          artifact: { id: 'artifact-1', title: 'Artifact 1', kind: 'html', content: '<p>Artifact</p>' },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({ conversationId: 'conversation-1', attachments: [{ id: 'attachment-1', kind: 'excalidraw' }] }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          conversationId: 'conversation-1',
          attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          conversationId: 'conversation-1',
          attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
          attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          conversationId: 'conversation-1',
          attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 2, latestRevision: { revision: 2 } },
          attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
        }),
      )
      .mockResolvedValueOnce(
        new Response('preview-bytes', {
          status: 200,
          headers: {
            'Content-Type': 'image/png',
            'Content-Disposition': 'inline; filename="preview.png"',
          },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const readConversationArtifacts = vi.fn();
    const readConversationArtifact = vi.fn();
    const readConversationAttachments = vi.fn();
    const readConversationAttachment = vi.fn();
    const createConversationAttachment = vi.fn();
    const updateConversationAttachment = vi.fn();
    const readConversationAttachmentAsset = vi.fn();
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'web-1',
          activeHostLabel: 'Tailnet',
          activeHostKind: 'web',
          activeHostSummary: 'Remote host reachable.',
        }),
        readConversationArtifacts,
        readConversationArtifact,
        readConversationAttachments,
        readConversationAttachment,
        createConversationAttachment,
        updateConversationAttachment,
        readConversationAttachmentAsset,
      },
    });

    const { api } = await import('./api');
    const artifacts = await api.conversationArtifacts('conversation-1');
    const artifact = await api.conversationArtifact('conversation-1', 'artifact-1');
    const attachments = await api.conversationAttachments('conversation-1');
    const attachment = await api.conversationAttachment('conversation-1', 'attachment-1');
    const createdAttachment = await api.createConversationAttachment('conversation-1', { sourceData: 'source', previewData: 'preview' });
    const updatedAttachment = await api.updateConversationAttachment('conversation-1', 'attachment-1', {
      sourceData: 'source',
      previewData: 'preview',
    });
    const attachmentAsset = await api.conversationAttachmentAsset('conversation-1', 'attachment-1', 'preview', 2);

    expect(readConversationArtifacts).not.toHaveBeenCalled();
    expect(readConversationArtifact).not.toHaveBeenCalled();
    expect(readConversationAttachments).not.toHaveBeenCalled();
    expect(readConversationAttachment).not.toHaveBeenCalled();
    expect(createConversationAttachment).not.toHaveBeenCalled();
    expect(updateConversationAttachment).not.toHaveBeenCalled();
    expect(readConversationAttachmentAsset).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/conversations/conversation-1/artifacts', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/conversations/conversation-1/artifacts/artifact-1', {
      method: 'GET',
      cache: 'no-store',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/conversations/conversation-1/attachments', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/conversations/conversation-1/attachments/attachment-1', {
      method: 'GET',
      cache: 'no-store',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/conversations/conversation-1/attachments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceData: 'source', previewData: 'preview' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(6, '/api/conversations/conversation-1/attachments/attachment-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceData: 'source', previewData: 'preview' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(7, '/api/conversations/conversation-1/attachments/attachment-1/download/preview?revision=2', {
      method: 'GET',
      cache: 'no-store',
    });
    expect(artifacts).toEqual({
      conversationId: 'conversation-1',
      artifacts: [{ id: 'artifact-1', title: 'Artifact 1', kind: 'html' }],
    });
    expect(artifact).toEqual({
      conversationId: 'conversation-1',
      artifact: { id: 'artifact-1', title: 'Artifact 1', kind: 'html', content: '<p>Artifact</p>' },
    });
    expect(attachments).toEqual({ conversationId: 'conversation-1', attachments: [{ id: 'attachment-1', kind: 'excalidraw' }] });
    expect(attachment).toEqual({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
    });
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
    expect(attachmentAsset).toEqual({
      dataUrl: 'data:image/png;base64,cHJldmlldy1ieXRlcw==',
      mimeType: 'image/png',
      fileName: 'preview.png',
    });
  });

  it('omits unsafe conversation attachment asset revisions from HTTP requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('preview-bytes', {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Disposition': 'inline; filename="preview.png"',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'web-1',
          activeHostKind: 'web',
        }),
      },
    });

    const { api } = await import('./api');
    await api.conversationAttachmentAsset('conversation-1', 'attachment-1', 'preview', Number.MAX_SAFE_INTEGER + 1);

    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/conversation-1/attachments/attachment-1/download/preview', {
      method: 'GET',
      cache: 'no-store',
    });
  });

  it('omits unsafe session detail numeric query params from HTTP requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ id: 'session-1', blocks: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api');
    await api.sessionDetail('session-1', {
      tailBlocks: Number.MAX_SAFE_INTEGER + 1,
      knownBlockOffset: Number.MAX_SAFE_INTEGER + 1,
      knownTotalBlocks: Number.MAX_SAFE_INTEGER + 1,
      knownSessionSignature: ' sig-1 ',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1?knownSessionSignature=sig-1', {
      method: 'GET',
      cache: 'no-store',
    });
  });

  it('caps expensive session detail tail block query params in HTTP requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse({ id: 'session-1', blocks: [] }));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api');
    await api.sessionDetail('session-1', { tailBlocks: 5000 });

    expect(fetchMock).toHaveBeenCalledWith('/api/sessions/session-1?tailBlocks=1000', {
      method: 'GET',
      cache: 'no-store',
    });
  });

  it('omits unsafe bootstrap numeric query params from HTTP requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(createBootstrapState({ conversationId: 'conversation-1' })));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api');
    await api.conversationBootstrap('conversation-1', {
      tailBlocks: Number.MAX_SAFE_INTEGER + 1,
      knownBlockOffset: Number.MAX_SAFE_INTEGER + 1,
      knownTotalBlocks: Number.MAX_SAFE_INTEGER + 1,
      knownSessionSignature: ' sig-1 ',
    });

    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/conversation-1/bootstrap?knownSessionSignature=sig-1', {
      method: 'GET',
      cache: 'no-store',
    });
  });

  it('caps expensive bootstrap tail block query params in HTTP requests', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createJsonResponse(createBootstrapState({ conversationId: 'conversation-1' })));
    vi.stubGlobal('fetch', fetchMock);

    const { api } = await import('./api');
    await api.conversationBootstrap('conversation-1', { tailBlocks: 5000 });

    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/conversation-1/bootstrap?tailBlocks=1000', {
      method: 'GET',
      cache: 'no-store',
    });
  });

  it('falls back to HTTP for desktop conversation deferred-resume bridges on non-local hosts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse({ conversationId: 'conversation-1', resumes: [{ id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z' }] }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          conversationId: 'conversation-1',
          resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' },
          resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' }],
        }),
      )
      .mockResolvedValueOnce(
        createJsonResponse({
          conversationId: 'conversation-1',
          resume: { id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z', prompt: 'Resume now.' },
          resumes: [],
        }),
      )
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
        }),
        readConversationDeferredResumes,
        scheduleConversationDeferredResume,
        fireConversationDeferredResume,
        cancelConversationDeferredResume,
      },
    });

    const { api } = await import('./api');
    const resumes = await api.deferredResumes('conversation-1');
    const scheduled = await api.scheduleDeferredResume('conversation-1', { delay: '10m', prompt: 'Resume later.', behavior: 'followUp' });
    const fired = await api.fireDeferredResumeNow('conversation-1', 'resume-1');
    const cancelled = await api.cancelDeferredResume('conversation-1', 'resume-2');

    expect(readConversationDeferredResumes).not.toHaveBeenCalled();
    expect(scheduleConversationDeferredResume).not.toHaveBeenCalled();
    expect(fireConversationDeferredResume).not.toHaveBeenCalled();
    expect(cancelConversationDeferredResume).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/conversations/conversation-1/deferred-resumes', {
      method: 'GET',
      cache: 'no-store',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/conversations/conversation-1/deferred-resumes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delay: '10m', prompt: 'Resume later.', behavior: 'followUp' }),
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
    expect(scheduled).toEqual({
      conversationId: 'conversation-1',
      resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' },
      resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' }],
    });
    expect(fired).toEqual({
      conversationId: 'conversation-1',
      resume: { id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z', prompt: 'Resume now.' },
      resumes: [],
    });
    expect(cancelled).toEqual({ conversationId: 'conversation-1', cancelledId: 'resume-2', resumes: [] });
  });

  it('falls back to HTTP for desktop session list, meta, and search-index reads on non-local hosts', async () => {
    const fetchMock = vi
      .fn()
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

  it('falls back to HTTP for conversations marked with any remote identity', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createJsonResponse({ id: 'conversation-1', title: 'Remote partial', remoteHostId: 'bender' }))
      .mockResolvedValueOnce(createJsonResponse({ ok: true, cwd: '/tmp/remote' }));
    vi.stubGlobal('fetch', fetchMock);
    const changeConversationCwd = vi.fn().mockResolvedValue({ ok: true, cwd: '/tmp/local' });
    Object.assign(window as { personalAgentDesktop?: unknown }, {
      personalAgentDesktop: {
        getEnvironment: vi.fn().mockResolvedValue({
          isElectron: true,
          activeHostId: 'local',
          activeHostLabel: 'Local',
          activeHostKind: 'local',
          activeHostSummary: 'Local backend is healthy.',
        }),
        changeConversationCwd,
      },
    });

    const { api } = await import('./api');
    const result = await api.changeConversationCwd('conversation-1', '/tmp/remote');

    expect(changeConversationCwd).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/sessions/conversation-1/meta', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/conversations/conversation-1/cwd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd: '/tmp/remote' }),
    });
    expect(result).toEqual({ ok: true, cwd: '/tmp/remote' });
  });

  it('falls back to HTTP for non-local desktop hosts', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        createJsonResponse(
          createBootstrapState({
            conversationId: 'remote-conversation',
          }),
        ),
      )
      .mockResolvedValueOnce(createJsonResponse({ ok: true, title: 'Remote rename' }))
      .mockResolvedValueOnce(
        createJsonResponse({
          conversationId: 'remote-conversation',
          live: true,
          recovered: true,
          replayedPendingOperation: false,
          usedFallbackPrompt: false,
        }),
      )
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
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/conversations/remote-conversation/title', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Remote rename', surfaceId: 'surface-1' }),
    });
    expect(fetchMock).toHaveBeenNthCalledWith(3, '/api/conversations/remote-conversation/recover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: undefined,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(4, '/api/live-sessions/remote-live/fork-entries', { method: 'GET', cache: 'no-store' });
    expect(fetchMock).toHaveBeenNthCalledWith(5, '/api/live-sessions/remote-live/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputPath: '/tmp/remote-live.html' }),
    });
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
