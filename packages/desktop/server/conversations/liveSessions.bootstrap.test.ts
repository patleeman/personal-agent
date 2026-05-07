import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  applyConversationModelPreferencesMock,
  appendConversationWorkspaceMetadataMock,
  authCreateMock,
  createAgentSessionMock,
  createBashToolMock,
  createRuntimeModelRegistryMock,
  defaultResourceLoaderReloadMock,
  DefaultResourceLoaderMock,
  generateConversationTitleMock,
  hasAssistantTitleSourceMessageMock,
  logWarnMock,
  publishAppEventMock,
  readConversationModelPreferenceSnapshotMock,
  readSessionBlocksByFileMock,
  readSessionMetaByFileMock,
  resolveChildProcessEnvMock,
  resolveConversationModelPreferenceStateMock,
  sessionManagerCreateMock,
  sessionManagerForkFromMock,
  sessionManagerInMemoryMock,
  sessionManagerOpenMock,
  syncWebLiveConversationRunMock,
} = vi.hoisted(() => {
  const defaultResourceLoaderReloadMock = vi.fn(async () => undefined);
  const DefaultResourceLoaderMock = vi.fn().mockImplementation(function DefaultResourceLoader(this: any, options: unknown) {
    this.options = options;
    this.reload = defaultResourceLoaderReloadMock;
    return this;
  });

  return {
    applyConversationModelPreferencesMock: vi.fn(),
    appendConversationWorkspaceMetadataMock: vi.fn(),
    authCreateMock: vi.fn(),
    createAgentSessionMock: vi.fn(),
    createBashToolMock: vi.fn(),
    createRuntimeModelRegistryMock: vi.fn(),
    defaultResourceLoaderReloadMock,
    DefaultResourceLoaderMock,
    generateConversationTitleMock: vi.fn(),
    hasAssistantTitleSourceMessageMock: vi.fn(),
    logWarnMock: vi.fn(),
    publishAppEventMock: vi.fn(),
    readConversationModelPreferenceSnapshotMock: vi.fn(),
    readSessionBlocksByFileMock: vi.fn(),
    readSessionMetaByFileMock: vi.fn(),
    resolveChildProcessEnvMock: vi.fn(),
    resolveConversationModelPreferenceStateMock: vi.fn(),
    sessionManagerCreateMock: vi.fn(),
    sessionManagerForkFromMock: vi.fn(),
    sessionManagerInMemoryMock: vi.fn(),
    sessionManagerOpenMock: vi.fn(),
    syncWebLiveConversationRunMock: vi.fn(),
  };
});

vi.mock('@personal-agent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@personal-agent/core')>();
  return {
    ...actual,
    getDurableSessionsDir: () => '/tmp/durable-sessions',
    getPiAgentRuntimeDir: () => '/tmp/agent-runtime',
    resolveChildProcessEnv: resolveChildProcessEnvMock,
  };
});

vi.mock('@earendil-works/pi-coding-agent', () => ({
  AuthStorage: {
    create: authCreateMock,
  },
  DefaultResourceLoader: DefaultResourceLoaderMock,
  SessionManager: {
    create: sessionManagerCreateMock,
    forkFrom: sessionManagerForkFromMock,
    inMemory: sessionManagerInMemoryMock,
    open: sessionManagerOpenMock,
  },
  createAgentSession: createAgentSessionMock,
  createBashTool: createBashToolMock,
  estimateTokens: () => 0,
}));

vi.mock('../shared/appEvents.js', () => ({
  publishAppEvent: publishAppEventMock,
}));

vi.mock('./conversationAutoTitle.js', () => ({
  generateConversationTitle: generateConversationTitleMock,
  hasAssistantTitleSourceMessage: hasAssistantTitleSourceMessageMock,
}));

vi.mock('./conversationModelPreferences.js', () => ({
  applyConversationModelPreferencesToLiveSession: applyConversationModelPreferencesMock,
  readConversationModelPreferenceSnapshot: readConversationModelPreferenceSnapshotMock,
  resolveConversationModelPreferenceState: resolveConversationModelPreferenceStateMock,
}));

vi.mock('./conversationRuns.js', () => ({
  syncWebLiveConversationRun: syncWebLiveConversationRunMock,
}));

vi.mock('./sessions.js', () => ({
  appendConversationWorkspaceMetadata: appendConversationWorkspaceMetadataMock,
  buildDisplayBlocksFromEntries: vi.fn(() => []),
  getAssistantErrorDisplayMessage: vi.fn(() => null),
  readSessionBlocksByFile: readSessionBlocksByFileMock,
  readSessionMetaByFile: readSessionMetaByFileMock,
}));

vi.mock('../models/modelRegistry.js', () => ({
  createRuntimeModelRegistry: createRuntimeModelRegistryMock,
}));

vi.mock('../shared/logging.js', () => ({
  logWarn: logWarnMock,
}));

import {
  branchSession,
  clearPrewarmedLiveSessionLoaders,
  createSession,
  createSessionFromExisting,
  forkSession,
  getAvailableModelObjects,
  getAvailableModels,
  inspectAvailableTools,
  prewarmLiveSessionLoader,
  registry,
  requestConversationWorkingDirectoryChange,
  resumeSession,
  summarizeAndForkSession,
} from './liveSessions.js';

type MockSessionBundle = {
  session: any;
  emit: (event: unknown) => void;
};

function createMockManager(overrides: Record<string, unknown> = {}) {
  const manager = {
    persist: true,
    sessionFile: '/tmp/session.jsonl',
    flushed: false,
    _rewriteFile: vi.fn(function rewriteFile(this: any) {
      this.flushed = true;
    }),
    appendModelChange: vi.fn(),
    createBranchedSession: vi.fn(),
    getCwd: vi.fn(() => '/tmp/workspace'),
    getEntry: vi.fn(),
    getSessionFile: vi.fn(function getSessionFile(this: any) {
      return this.sessionFile;
    }),
    ...overrides,
  };

  return manager;
}

function createMockSession(options: {
  activeToolNames?: string[];
  allTools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  cwd?: string;
  manager?: any;
  model?: { id: string; provider?: string };
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
  thinkingLevel?: string;
  tools?: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  systemPrompt?: string;
  isStreaming?: boolean;
  extensionRunner?: { emitBeforeAgentStart: (prompt: string, images: unknown[] | undefined, systemPrompt: string) => Promise<unknown> };
}): MockSessionBundle {
  const listeners = new Set<(event: any) => void>();
  const sessionManager =
    options.manager ??
    createMockManager({
      sessionFile: options.sessionFile ?? `/tmp/${options.sessionId}.jsonl`,
      getCwd: vi.fn(() => options.cwd ?? '/tmp/workspace'),
    });
  const session: any = {
    _baseToolRegistry: new Map<string, unknown>(),
    _refreshToolRegistry: vi.fn(),
    _extensionRunner: options.extensionRunner,
    agent: {},
    compact: vi.fn(async () => ({ compacted: true })),
    dispose: vi.fn(),
    exportToHtml: vi.fn(async (outputPath?: string) => outputPath ?? '/tmp/export.html'),
    followUp: vi.fn(async () => undefined),
    getActiveToolNames: vi.fn(() => options.activeToolNames ?? []),
    getAllTools: vi.fn(() => options.allTools ?? []),
    getContextUsage: vi.fn(() => null),
    getFollowUpMessages: vi.fn(() => []),
    getSessionStats: vi.fn(() => ({ tokens: { input: 0, output: 0, total: 0 }, cost: 0 })),
    getSteeringMessages: vi.fn(() => []),
    getUserMessagesForForking: vi.fn(() => []),
    isStreaming: options.isStreaming ?? false,
    messages: [],
    model: options.model,
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn(),
    },
    prompt: vi.fn(async () => undefined),
    reload: vi.fn(async () => undefined),
    sendCustomMessage: vi.fn(async () => undefined),
    sessionFile: options.sessionFile ?? sessionManager.sessionFile,
    sessionId: options.sessionId,
    sessionManager,
    sessionName: options.sessionName,
    setModel: vi.fn(async (model: unknown) => {
      session.model = model;
    }),
    setSessionName: vi.fn((name: string) => {
      session.sessionName = name;
    }),
    settingsManager: {
      getShellCommandPrefix: vi.fn(() => 'PREFIX'),
    },
    state: {
      messages: [],
      streamingMessage: null,
      tools: options.tools ?? [],
    },
    steer: vi.fn(async () => undefined),
    subscribe: vi.fn((listener: (event: any) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    systemPrompt: options.systemPrompt ?? 'Base system prompt',
    thinkingLevel: options.thinkingLevel ?? 'medium',
  };

  return {
    session,
    emit: (event: unknown) => {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

function setLiveEntry(sessionId: string, entry: { cwd: string; title: string; session: any }) {
  registry.set(sessionId, {
    sessionId,
    cwd: entry.cwd,
    listeners: new Set(),
    title: entry.title,
    autoTitleRequested: false,
    lastContextUsageJson: null,
    lastQueueStateJson: null,
    pendingHiddenTurnCustomTypes: [],
    activeHiddenTurnCustomType: null,
    pendingAutoCompactionReason: null,
    lastCompactionSummaryTitle: null,
    presenceBySurfaceId: new Map(),
    controllerSurfaceId: null,
    controllerAcquiredAt: null,
    session: entry.session,
  } as any);
}

describe('liveSessions bootstrap helpers', () => {
  beforeEach(() => {
    applyConversationModelPreferencesMock.mockReset();
    appendConversationWorkspaceMetadataMock.mockReset();
    authCreateMock.mockReset();
    createAgentSessionMock.mockReset();
    createBashToolMock.mockReset();
    createRuntimeModelRegistryMock.mockReset();
    defaultResourceLoaderReloadMock.mockReset();
    DefaultResourceLoaderMock.mockClear();
    generateConversationTitleMock.mockReset();
    hasAssistantTitleSourceMessageMock.mockReset();
    logWarnMock.mockReset();
    publishAppEventMock.mockReset();
    readConversationModelPreferenceSnapshotMock.mockReset();
    readSessionBlocksByFileMock.mockReset();
    readSessionMetaByFileMock.mockReset();
    resolveChildProcessEnvMock.mockReset();
    resolveConversationModelPreferenceStateMock.mockReset();
    registry.clear();
    clearPrewarmedLiveSessionLoaders();
    sessionManagerCreateMock.mockReset();
    sessionManagerForkFromMock.mockReset();
    sessionManagerInMemoryMock.mockReset();
    sessionManagerOpenMock.mockReset();
    syncWebLiveConversationRunMock.mockReset();

    authCreateMock.mockReturnValue({ kind: 'auth' });
    applyConversationModelPreferencesMock.mockResolvedValue({
      currentModel: 'gpt-5',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
    });
    createBashToolMock.mockReturnValue({ name: 'bash-tool' });
    createRuntimeModelRegistryMock.mockReturnValue({
      getAvailable: vi.fn(() => []),
    });
    defaultResourceLoaderReloadMock.mockResolvedValue(undefined);
    generateConversationTitleMock.mockResolvedValue('');
    hasAssistantTitleSourceMessageMock.mockReturnValue(false);
    readConversationModelPreferenceSnapshotMock.mockReturnValue({
      currentModel: '',
      currentThinkingLevel: '',
      currentServiceTier: '',
      hasExplicitModel: false,
      hasExplicitThinkingLevel: false,
      hasExplicitServiceTier: false,
    });
    readSessionBlocksByFileMock.mockReturnValue(null);
    readSessionMetaByFileMock.mockReturnValue(null);
    resolveChildProcessEnvMock.mockImplementation((overrides: Record<string, string>, baseEnv: Record<string, string>) => ({
      ...baseEnv,
      ...overrides,
      PATH: '/interactive/bin:/usr/bin',
    }));
    resolveConversationModelPreferenceStateMock.mockImplementation((_snapshot, defaults) => ({
      currentModel: defaults?.currentModel ?? '',
      currentThinkingLevel: defaults?.currentThinkingLevel ?? '',
      currentServiceTier: defaults?.currentServiceTier ?? '',
      hasExplicitServiceTier: false,
    }));
    syncWebLiveConversationRunMock.mockResolvedValue(undefined);
  });

  it('reads available runtime models and normalizes summaries', () => {
    const availableModels = [
      { id: 'gpt-5', name: 'GPT-5', contextWindow: 256_000, provider: 'openai' },
      { id: 'gpt-5.5', name: 'GPT-5.5', contextWindow: 272_000, provider: 'openai-codex' },
      { id: 'local-model' },
    ];
    createRuntimeModelRegistryMock.mockReturnValue({
      getAvailable: vi.fn(() => availableModels),
    });

    expect(getAvailableModelObjects()).toEqual(availableModels);
    expect(getAvailableModels()).toEqual([
      { id: 'gpt-5', name: 'GPT-5', context: 256_000, contextWindow: 256_000, provider: 'openai', api: undefined },
      { id: 'gpt-5.5', name: 'GPT-5.5', context: 400_000, contextWindow: 400_000, provider: 'openai-codex', api: undefined },
      { id: 'local-model', name: 'local-model', context: 128_000, contextWindow: 128_000, provider: '', api: undefined },
    ]);
  });

  it('inspects available tools for a new session and disposes the probe session afterwards', async () => {
    const inMemoryManager = createMockManager({ persist: false, sessionFile: undefined });
    const inspectionSession = createMockSession({
      sessionId: 'inspection-session',
      manager: inMemoryManager,
      activeToolNames: ['read'],
      allTools: [
        { name: 'write', description: 'Write a file', parameters: { path: 'string' } },
        { name: 'read', description: 'Read a file', parameters: { path: 'string' } },
      ],
      tools: [
        { name: 'read', description: 'Read a file', parameters: { path: 'string' } },
        { name: 'write', description: 'Write a file', parameters: { path: 'string' } },
      ],
      extensionRunner: {
        emitBeforeAgentStart: vi.fn(async () => ({
          systemPrompt: 'Patched system prompt',
          messages: [{ customType: 'referenced_context', content: 'Injected context' }],
        })),
      },
    });

    sessionManagerInMemoryMock.mockReturnValue(inMemoryManager);
    createAgentSessionMock.mockResolvedValue({ session: inspectionSession.session });

    await expect(
      inspectAvailableTools('/tmp/workspace', {
        agentDir: '/tmp/custom-agent-dir',
        additionalExtensionPaths: ['/tmp/extensions'],
      }),
    ).resolves.toEqual({
      cwd: '/tmp/workspace',
      activeTools: ['read'],
      tools: [
        { name: 'read', description: 'Read a file', parameters: { path: 'string' }, active: true },
        { name: 'write', description: 'Write a file', parameters: { path: 'string' }, active: false },
      ],
      newSessionSystemPrompt: 'Patched system prompt',
      newSessionInjectedMessages: [{ customType: 'referenced_context', content: 'Injected context' }],
      newSessionToolDefinitions: [
        { name: 'read', description: 'Read a file', parameters: { path: 'string' }, active: true },
        { name: 'write', description: 'Write a file', parameters: { path: 'string' }, active: true },
      ],
    });

    expect(DefaultResourceLoaderMock).toHaveBeenCalledWith({
      cwd: '/tmp/workspace',
      agentDir: '/tmp/custom-agent-dir',
      extensionFactories: undefined,
      additionalExtensionPaths: ['/tmp/extensions'],
      additionalSkillPaths: undefined,
      additionalPromptTemplatePaths: undefined,
      additionalThemePaths: undefined,
    });
    expect(defaultResourceLoaderReloadMock).toHaveBeenCalledTimes(1);
    expect(inspectionSession.session.dispose).toHaveBeenCalledTimes(1);
  });

  it('consumes a prewarmed loader when creating a new live session', async () => {
    const runtimeRegistry = {
      getAvailable: vi.fn(() => []),
    };
    const manager = createMockManager({
      sessionFile: '/tmp/durable-sessions/--tmp-workspace--/session-prewarmed.jsonl',
    });
    const createdSession = createMockSession({
      sessionId: 'session-prewarmed',
      cwd: '/tmp/workspace',
      manager,
      model: { id: 'gpt-5', provider: 'openai' },
      sessionFile: '/tmp/durable-sessions/--tmp-workspace--/session-prewarmed.jsonl',
      tools: [],
    });

    createRuntimeModelRegistryMock.mockReturnValue(runtimeRegistry);
    sessionManagerCreateMock.mockReturnValue(manager);
    createAgentSessionMock.mockResolvedValue({ session: createdSession.session });

    await prewarmLiveSessionLoader('/tmp/workspace', {
      additionalExtensionPaths: ['/tmp/extensions'],
    });
    expect(DefaultResourceLoaderMock).toHaveBeenCalledTimes(1);
    expect(defaultResourceLoaderReloadMock).toHaveBeenCalledTimes(1);

    await createSession('/tmp/workspace', {
      additionalExtensionPaths: ['/tmp/extensions'],
    });

    expect(DefaultResourceLoaderMock).toHaveBeenCalledTimes(2);
    expect(defaultResourceLoaderReloadMock).toHaveBeenCalledTimes(2);
  });

  it('creates a new live session, repairs provider mismatches, and applies initial model preferences', async () => {
    const runtimeRegistry = {
      getAvailable: vi.fn(() => [{ id: 'gpt-5', name: 'GPT-5', provider: 'openai' }]),
    };
    const manager = createMockManager({
      sessionFile: '/tmp/durable-sessions/--tmp-workspace--/session-created.jsonl',
    });
    const createdSession = createMockSession({
      sessionId: 'session-created',
      cwd: '/tmp/workspace',
      manager,
      model: { id: 'gpt-5', provider: 'wrong-provider' },
      sessionFile: '/tmp/workspace',
      tools: [],
    });

    createRuntimeModelRegistryMock.mockReturnValue(runtimeRegistry);
    sessionManagerCreateMock.mockReturnValue(manager);
    createAgentSessionMock.mockResolvedValue({ session: createdSession.session });

    await expect(
      createSession('/tmp/workspace', {
        initialModel: 'gpt-5',
        initialThinkingLevel: 'high',
      }),
    ).resolves.toEqual({
      id: 'session-created',
      sessionFile: '/tmp/durable-sessions/--tmp-workspace--/session-created.jsonl',
    });

    expect(sessionManagerCreateMock).toHaveBeenCalledWith('/tmp/workspace', '/tmp/durable-sessions/--tmp-workspace--');
    expect(createBashToolMock).toHaveBeenCalledWith(
      '/tmp/workspace',
      expect.objectContaining({
        commandPrefix: 'PREFIX',
        spawnHook: expect.any(Function),
      }),
    );
    const bashToolOptions = createBashToolMock.mock.calls.at(-1)?.[1] as {
      spawnHook: (context: { env: Record<string, string>; cwd: string; command: string }) => { env: Record<string, string> };
    };
    const spawned = bashToolOptions.spawnHook({
      command: 'echo hello',
      cwd: '/tmp/workspace',
      env: { PATH: '/usr/bin', BASE: '1' },
    });
    expect(resolveChildProcessEnvMock).toHaveBeenCalledWith(
      {
        PERSONAL_AGENT_SOURCE_CONVERSATION_ID: 'session-created',
        PERSONAL_AGENT_SOURCE_SESSION_FILE: '/tmp/durable-sessions/--tmp-workspace--/session-created.jsonl',
      },
      {
        PATH: '/usr/bin',
        BASE: '1',
      },
    );
    expect(spawned.env).toEqual({
      PATH: '/interactive/bin:/usr/bin',
      BASE: '1',
      PERSONAL_AGENT_SOURCE_CONVERSATION_ID: 'session-created',
      PERSONAL_AGENT_SOURCE_SESSION_FILE: '/tmp/durable-sessions/--tmp-workspace--/session-created.jsonl',
    });
    expect(createdSession.session._baseToolRegistry.get('bash')).toEqual({ name: 'bash-tool' });
    expect(createdSession.session._refreshToolRegistry).toHaveBeenCalledWith({
      activeToolNames: [],
      includeAllExtensionTools: true,
    });
    expect(manager._rewriteFile).toHaveBeenCalledTimes(1);
    expect(manager.flushed).toBe(true);
    expect(createdSession.session.setModel).toHaveBeenCalledWith({ id: 'gpt-5', name: 'GPT-5', provider: 'openai' });
    expect(manager.appendModelChange).toHaveBeenCalledWith('openai', 'gpt-5');
    expect(applyConversationModelPreferencesMock).toHaveBeenCalledWith(
      createdSession.session,
      { model: 'gpt-5', thinkingLevel: 'high' },
      { currentModel: 'gpt-5', currentThinkingLevel: 'medium', currentServiceTier: '' },
      [{ id: 'gpt-5', name: 'GPT-5', provider: 'openai' }],
    );
    expect(registry.get('session-created')?.cwd).toBe('/tmp/workspace');
  });

  it('creates sessions from existing files and resumes stored sessions into the live registry', async () => {
    const runtimeRegistry = {
      getAvailable: vi.fn(() => [{ id: 'gpt-5', provider: 'openai' }]),
    };
    const forkManager = createMockManager({
      sessionFile: '/tmp/durable-sessions/--tmp-next-workspace--/session-forked.jsonl',
    });
    const forkedSession = createMockSession({
      sessionId: 'session-forked',
      cwd: '/tmp/next-workspace',
      manager: forkManager,
      model: { id: 'gpt-5', provider: 'openai' },
      sessionFile: '/tmp/durable-sessions/--tmp-next-workspace--/session-forked.jsonl',
      tools: [],
    });
    const resumedManager = createMockManager({
      getCwd: vi.fn(() => '/tmp/resumed-workspace'),
      sessionFile: '/tmp/stored-session.jsonl',
    });
    const resumedSession = createMockSession({
      sessionId: 'session-resumed',
      cwd: '/tmp/resumed-workspace',
      manager: resumedManager,
      model: { id: 'gpt-5', provider: 'openai' },
      sessionFile: '/tmp/stored-session.jsonl',
      sessionName: 'Stored title',
      tools: [],
    });

    createRuntimeModelRegistryMock.mockReturnValue(runtimeRegistry);
    sessionManagerForkFromMock.mockReturnValue(forkManager);
    sessionManagerOpenMock.mockReturnValue(resumedManager);
    createAgentSessionMock
      .mockResolvedValueOnce({ session: forkedSession.session })
      .mockResolvedValueOnce({ session: resumedSession.session });

    await expect(createSessionFromExisting('/tmp/source-session.jsonl', '/tmp/next-workspace')).resolves.toEqual({
      id: 'session-forked',
      sessionFile: '/tmp/durable-sessions/--tmp-next-workspace--/session-forked.jsonl',
    });
    await expect(resumeSession('/tmp/stored-session.jsonl', { cwdOverride: '/tmp/override-workspace' })).resolves.toEqual({
      id: 'session-resumed',
    });

    expect(sessionManagerForkFromMock).toHaveBeenCalledWith(
      '/tmp/source-session.jsonl',
      '/tmp/next-workspace',
      '/tmp/durable-sessions/--tmp-next-workspace--',
    );
    expect(sessionManagerOpenMock).toHaveBeenCalledWith('/tmp/stored-session.jsonl', undefined, '/tmp/override-workspace');
    expect(registry.get('session-resumed')?.cwd).toBe('/tmp/override-workspace');
  });

  it('applies queued working directory changes after the current turn ends and auto-continues in the same session', async () => {
    const runtimeRegistry = {
      getAvailable: vi.fn(() => [{ id: 'gpt-5', provider: 'openai' }]),
    };
    const sourceManager = createMockManager({
      sessionFile: '/tmp/durable-sessions/--tmp-source-workspace--/session-source.jsonl',
    });
    const sourceSession = createMockSession({
      sessionId: 'session-source',
      cwd: '/tmp/source-workspace',
      manager: sourceManager,
      sessionFile: '/tmp/durable-sessions/--tmp-source-workspace--/session-source.jsonl',
      model: { id: 'gpt-5', provider: 'openai' },
      tools: [],
    });
    const nextManager = createMockManager({
      sessionFile: '/tmp/durable-sessions/--tmp-next-workspace--/session-next.jsonl',
    });
    const nextSession = createMockSession({
      sessionId: 'session-source',
      cwd: '/tmp/next-workspace',
      manager: nextManager,
      sessionFile: '/tmp/durable-sessions/--tmp-next-workspace--/session-next.jsonl',
      model: { id: 'gpt-5', provider: 'openai' },
      tools: [],
    });

    createRuntimeModelRegistryMock.mockReturnValue(runtimeRegistry);
    sessionManagerCreateMock.mockReturnValue(sourceManager);
    sessionManagerOpenMock.mockReturnValue(nextManager);
    readSessionMetaByFileMock.mockReturnValue({
      id: 'session-source',
      file: '/tmp/durable-sessions/--tmp-source-workspace--/session-source.jsonl',
      timestamp: '2026-04-25T00:00:00.000Z',
      cwd: '/tmp/source-workspace',
      workspaceCwd: null,
      cwdSlug: '--tmp-source-workspace--',
      model: 'gpt-5',
      title: 'Cwd-less chat',
      messageCount: 1,
    });
    createAgentSessionMock
      .mockResolvedValueOnce({ session: sourceSession.session })
      .mockResolvedValueOnce({ session: nextSession.session });

    const created = await createSession('/tmp/source-workspace');
    await requestConversationWorkingDirectoryChange({
      conversationId: created.id,
      cwd: '/tmp/next-workspace',
      continuePrompt: 'Continue here.',
    });

    sourceSession.emit({ type: 'turn_end' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appendConversationWorkspaceMetadataMock).toHaveBeenCalledWith({
      sessionFile: '/tmp/durable-sessions/--tmp-source-workspace--/session-source.jsonl',
      previousCwd: '/tmp/source-workspace',
      previousWorkspaceCwd: null,
      cwd: '/tmp/next-workspace',
      workspaceCwd: '/tmp/next-workspace',
      visibleMessage: true,
    });
    expect(registry.has('session-source')).toBe(true);
    expect(registry.get('session-source')?.cwd).toBe('/tmp/next-workspace');
    expect(nextSession.session.prompt).toHaveBeenCalledWith('Continue here.');
  });

  it('branches, forks, and summarizes live sessions using the mocked session manager seams', async () => {
    const runtimeRegistry = {
      getAvailable: vi.fn(() => [{ id: 'gpt-5', provider: 'openai' }]),
    };
    const branchSourceManager = createMockManager({
      getEntry: vi.fn(() => ({ id: 'entry-1' })),
      createBranchedSession: vi.fn(() => '/tmp/branch-session.jsonl'),
    });
    const branchResumeManager = createMockManager({
      getCwd: vi.fn(() => '/tmp/branch-workspace'),
      sessionFile: '/tmp/branch-session.jsonl',
    });
    const branchResumedSession = createMockSession({
      sessionId: 'session-branch-live',
      cwd: '/tmp/branch-workspace',
      manager: branchResumeManager,
      sessionFile: '/tmp/branch-session.jsonl',
      model: { id: 'gpt-5', provider: 'openai' },
      tools: [],
    });
    const forkSourceManager = createMockManager({
      getEntry: vi.fn(() => ({ id: 'entry-2', parentId: 'entry-1' })),
      createBranchedSession: vi.fn(() => '/tmp/fork-session.jsonl'),
    });
    const forkResumeManager = createMockManager({
      getCwd: vi.fn(() => '/tmp/fork-workspace'),
      sessionFile: '/tmp/fork-session.jsonl',
    });
    const forkResumedSession = createMockSession({
      sessionId: 'session-fork-live',
      cwd: '/tmp/fork-workspace',
      manager: forkResumeManager,
      sessionFile: '/tmp/fork-session.jsonl',
      model: { id: 'gpt-5', provider: 'openai' },
      tools: [],
    });
    const summaryManager = createMockManager({
      sessionFile: '/tmp/durable-sessions/--tmp-summary-workspace--/session-summary.jsonl',
    });
    const summarySession = createMockSession({
      sessionId: 'session-summary-live',
      cwd: '/tmp/summary-workspace',
      manager: summaryManager,
      sessionFile: '/tmp/durable-sessions/--tmp-summary-workspace--/session-summary.jsonl',
      model: { id: 'gpt-5', provider: 'openai' },
      tools: [],
    });

    createRuntimeModelRegistryMock.mockReturnValue(runtimeRegistry);
    sessionManagerOpenMock
      .mockReturnValueOnce(branchSourceManager)
      .mockReturnValueOnce(branchResumeManager)
      .mockReturnValueOnce(forkSourceManager)
      .mockReturnValueOnce(forkResumeManager);
    sessionManagerForkFromMock.mockReturnValue(summaryManager);
    createAgentSessionMock
      .mockResolvedValueOnce({ session: branchResumedSession.session })
      .mockResolvedValueOnce({ session: forkResumedSession.session })
      .mockResolvedValueOnce({ session: summarySession.session });

    setLiveEntry('session-branch-source', {
      cwd: '/tmp/source-workspace',
      title: 'Branch source',
      session: {
        dispose: vi.fn(),
        isStreaming: false,
        sessionFile: '/tmp/source-session.jsonl',
      },
    });
    setLiveEntry('session-fork-source', {
      cwd: '/tmp/source-workspace',
      title: 'Fork source',
      session: {
        dispose: vi.fn(),
        isStreaming: false,
        sessionFile: '/tmp/source-session.jsonl',
      },
    });
    setLiveEntry('session-summary-source', {
      cwd: '/tmp/summary-workspace',
      title: 'Summary source',
      session: {
        dispose: vi.fn(),
        isStreaming: false,
        sessionFile: '/tmp/source-session.jsonl',
      },
    });

    await expect(branchSession('session-branch-source', 'entry-1')).resolves.toEqual({
      newSessionId: 'session-branch-live',
      sessionFile: '/tmp/branch-session.jsonl',
    });
    await expect(forkSession('session-fork-source', 'entry-2', { beforeEntry: true })).resolves.toEqual({
      newSessionId: 'session-fork-live',
      sessionFile: '/tmp/fork-session.jsonl',
    });
    await expect(summarizeAndForkSession('session-summary-source')).resolves.toEqual({
      newSessionId: 'session-summary-live',
      sessionFile: '/tmp/durable-sessions/--tmp-summary-workspace--/session-summary.jsonl',
    });

    expect(branchSourceManager.getEntry).toHaveBeenCalledWith('entry-1');
    expect(forkSourceManager.getEntry).toHaveBeenCalledWith('entry-2');
    expect(forkSourceManager.createBranchedSession).toHaveBeenCalledWith('entry-1');
    expect(sessionManagerOpenMock).toHaveBeenNthCalledWith(1, '/tmp/source-session.jsonl', undefined, '/tmp/source-workspace');
    expect(sessionManagerOpenMock).toHaveBeenNthCalledWith(2, '/tmp/branch-session.jsonl', undefined, '/tmp/source-workspace');
    expect(sessionManagerOpenMock).toHaveBeenNthCalledWith(3, '/tmp/source-session.jsonl', undefined, '/tmp/source-workspace');
    expect(sessionManagerOpenMock).toHaveBeenNthCalledWith(4, '/tmp/fork-session.jsonl', undefined, '/tmp/source-workspace');
    expect(summarySession.session.compact).toHaveBeenCalledTimes(1);
    expect(registry.has('session-fork-source')).toBe(false);
  });

  it('returns the summary fork before compaction finishes', async () => {
    const runtimeRegistry = {
      getAvailable: vi.fn(() => [{ id: 'gpt-5', provider: 'openai' }]),
    };
    const summaryManager = createMockManager({
      sessionFile: '/tmp/durable-sessions/--tmp-summary-workspace--/session-summary.jsonl',
      getCwd: vi.fn(() => '/tmp/summary-workspace'),
    });
    const summarySession = createMockSession({
      sessionId: 'session-summary-live',
      cwd: '/tmp/summary-workspace',
      manager: summaryManager,
      sessionFile: '/tmp/durable-sessions/--tmp-summary-workspace--/session-summary.jsonl',
      model: { id: 'gpt-5', provider: 'openai' },
      tools: [],
    });

    summarySession.session.compact.mockImplementation(() => new Promise(() => {}));

    createRuntimeModelRegistryMock.mockReturnValue(runtimeRegistry);
    sessionManagerForkFromMock.mockReturnValue(summaryManager);
    createAgentSessionMock.mockResolvedValue({ session: summarySession.session });

    setLiveEntry('session-summary-source', {
      cwd: '/tmp/summary-workspace',
      title: 'Summary source',
      session: {
        dispose: vi.fn(),
        isStreaming: false,
        sessionFile: '/tmp/source-session.jsonl',
      },
    });

    const result = await Promise.race([
      summarizeAndForkSession('session-summary-source').then((value) => ({ kind: 'resolved' as const, value })),
      new Promise<{ kind: 'timeout' }>((resolve) => {
        setTimeout(() => resolve({ kind: 'timeout' }), 20);
      }),
    ]);

    expect(result).toEqual({
      kind: 'resolved',
      value: {
        newSessionId: 'session-summary-live',
        sessionFile: '/tmp/durable-sessions/--tmp-summary-workspace--/session-summary.jsonl',
      },
    });
    expect(summarySession.session.compact).toHaveBeenCalledTimes(1);
  });

  it('keeps the summary fork open and appends a notice when compaction fails', async () => {
    const runtimeRegistry = {
      getAvailable: vi.fn(() => [{ id: 'gpt-5', provider: 'openai' }]),
    };
    const summaryManager = createMockManager({
      sessionFile: '/tmp/durable-sessions/--tmp-summary-workspace--/session-summary.jsonl',
      getCwd: vi.fn(() => '/tmp/summary-workspace'),
    });
    const summarySession = createMockSession({
      sessionId: 'session-summary-live',
      cwd: '/tmp/summary-workspace',
      manager: summaryManager,
      sessionFile: '/tmp/durable-sessions/--tmp-summary-workspace--/session-summary.jsonl',
      model: { id: 'gpt-5', provider: 'openai' },
      tools: [],
    });

    summarySession.session.compact.mockRejectedValue(new Error('compaction exploded'));

    createRuntimeModelRegistryMock.mockReturnValue(runtimeRegistry);
    sessionManagerForkFromMock.mockReturnValue(summaryManager);
    createAgentSessionMock.mockResolvedValue({ session: summarySession.session });

    setLiveEntry('session-summary-source', {
      cwd: '/tmp/summary-workspace',
      title: 'Summary source',
      session: {
        dispose: vi.fn(),
        isStreaming: false,
        sessionFile: '/tmp/source-session.jsonl',
      },
    });

    await expect(summarizeAndForkSession('session-summary-source')).resolves.toEqual({
      newSessionId: 'session-summary-live',
      sessionFile: '/tmp/durable-sessions/--tmp-summary-workspace--/session-summary.jsonl',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(registry.has('session-summary-live')).toBe(true);
    expect(logWarnMock).toHaveBeenCalledWith(
      'summary fork compaction failed',
      expect.objectContaining({
        sourceConversationId: 'session-summary-source',
        conversationId: 'session-summary-live',
        sessionFile: '/tmp/durable-sessions/--tmp-summary-workspace--/session-summary.jsonl',
      }),
    );
    expect(summarySession.session.sendCustomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: 'system_notice',
        display: true,
        content: 'Summarize & New could not compact this copy automatically: compaction exploded',
      }),
    );
  });

  it('rewinds to a blank session when the selected entry is the first turn', async () => {
    const createdManager = createMockManager({
      sessionFile: '/tmp/rewind-root-session.jsonl',
      getCwd: vi.fn(() => '/tmp/source-workspace'),
    });
    const createdSession = createMockSession({
      sessionId: 'session-rewind-live',
      cwd: '/tmp/source-workspace',
      manager: createdManager,
      sessionFile: '/tmp/rewind-root-session.jsonl',
      model: { id: 'gpt-5', provider: 'openai' },
      thinkingLevel: 'high',
      tools: [],
    });
    const sourceManager = createMockManager({
      getEntry: vi.fn(() => ({ id: 'entry-1', parentId: null })),
      createBranchedSession: vi.fn(() => '/tmp/unused.jsonl'),
    });

    sessionManagerOpenMock.mockReturnValue(sourceManager);
    sessionManagerCreateMock.mockReturnValue(createdManager);
    createAgentSessionMock.mockResolvedValue({ session: createdSession.session });

    setLiveEntry('session-rewind-source', {
      cwd: '/tmp/source-workspace',
      title: 'Rewind source',
      session: {
        dispose: vi.fn(),
        isStreaming: false,
        sessionFile: '/tmp/source-session.jsonl',
        model: { id: 'gpt-5', provider: 'openai' },
        thinkingLevel: 'high',
      },
    });

    await expect(
      forkSession('session-rewind-source', 'entry-1', {
        beforeEntry: true,
        preserveSource: true,
      }),
    ).resolves.toEqual({
      newSessionId: 'session-rewind-live',
      sessionFile: '/tmp/rewind-root-session.jsonl',
    });

    expect(sourceManager.createBranchedSession).not.toHaveBeenCalled();
    expect(sessionManagerCreateMock).toHaveBeenCalledWith('/tmp/source-workspace', '/tmp/durable-sessions/--tmp-source-workspace--');
    expect(applyConversationModelPreferencesMock).toHaveBeenCalledWith(
      createdSession.session,
      { model: 'gpt-5', thinkingLevel: 'high' },
      { currentModel: 'gpt-5', currentThinkingLevel: 'high', currentServiceTier: '' },
      [],
    );
  });
});
