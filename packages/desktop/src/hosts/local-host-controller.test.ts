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
    readDesktopAppStatus: vi.fn(),
    readDesktopDaemonState: vi.fn(),
    readDesktopSessions: vi.fn(),
    readDesktopSessionMeta: vi.fn(),
    readDesktopSessionSearchIndex: vi.fn(),
    readDesktopModels: vi.fn(),
    updateDesktopModelPreferences: vi.fn(),
    readDesktopDefaultCwd: vi.fn(),
    updateDesktopDefaultCwd: vi.fn(),
    readDesktopVaultFiles: vi.fn(),
    pickDesktopFolder: vi.fn(),
    readDesktopConversationTitleSettings: vi.fn(),
    updateDesktopConversationTitleSettings: vi.fn(),
    readDesktopConversationPlansWorkspace: vi.fn(),
    readDesktopModelProviders: vi.fn(),
    saveDesktopModelProvider: vi.fn(),
    deleteDesktopModelProvider: vi.fn(),
    saveDesktopModelProviderModel: vi.fn(),
    deleteDesktopModelProviderModel: vi.fn(),
    readDesktopProviderAuth: vi.fn(),
    setDesktopProviderApiKey: vi.fn(),
    removeDesktopProviderCredential: vi.fn(),
    startDesktopProviderOAuthLogin: vi.fn(),
    readDesktopProviderOAuthLogin: vi.fn(),
    submitDesktopProviderOAuthLoginInput: vi.fn(),
    cancelDesktopProviderOAuthLogin: vi.fn(),
    subscribeDesktopProviderOAuthLogin: vi.fn(),
    markDesktopConversationAttention: vi.fn(),
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
    markDesktopDurableRunAttention: vi.fn(),
    readDesktopConversationBootstrap: vi.fn(),
    renameDesktopConversation: vi.fn(),
    changeDesktopConversationCwd: vi.fn(),
    readDesktopConversationDeferredResumes: vi.fn(),
    scheduleDesktopConversationDeferredResume: vi.fn(),
    cancelDesktopConversationDeferredResume: vi.fn(),
    fireDesktopConversationDeferredResume: vi.fn(),
    recoverDesktopConversation: vi.fn(),
    readDesktopConversationModelPreferences: vi.fn(),
    updateDesktopConversationModelPreferences: vi.fn(),
    readDesktopConversationArtifacts: vi.fn(),
    readDesktopConversationArtifact: vi.fn(),
    readDesktopConversationCheckpoints: vi.fn(),
    readDesktopConversationCheckpoint: vi.fn(),
    readDesktopConversationAttachments: vi.fn(),
    readDesktopConversationAttachment: vi.fn(),
    createDesktopConversationAttachment: vi.fn(),
    updateDesktopConversationAttachment: vi.fn(),
    readDesktopConversationAttachmentAsset: vi.fn(),
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
  it('reports healthy status when daemon is running', async () => {
    const backend = createBackendMock();
    backend.getStatus = vi.fn().mockResolvedValue({
      daemonHealthy: true,
    });

    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend);

    await expect(controller.getStatus()).resolves.toEqual({
      reachable: true,
      mode: 'local-app-runtime',
      summary: 'Local desktop runtime is healthy.',
      webUrl: 'personal-agent://app/',
      daemonHealthy: true,
    });
  });

  it('reports unhealthy status when daemon is not running', async () => {
    const backend = createBackendMock();
    backend.getStatus = vi.fn().mockResolvedValue({
      daemonHealthy: false,
    });

    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend);

    await expect(controller.getStatus()).resolves.toEqual({
      reachable: false,
      mode: 'local-app-runtime',
      summary: 'Local desktop runtime is starting or unavailable.',
      webUrl: 'personal-agent://app/',
      daemonHealthy: false,
    });
  });

  it('routes live-session mutations through the local API module without booting the web child', async () => {
    const invokeDesktopLocalApi = vi.fn().mockResolvedValue({ ok: true, accepted: true });
    const loadLocalApi = vi.fn().mockResolvedValue(
      createLocalApiModuleMock({
        invokeDesktopLocalApi,
      }),
    );
    const backend = createBackendMock();

    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend, loadLocalApi);

    await expect(
      controller.invokeLocalApi('POST', '/api/live-sessions/live-1/prompt', {
        text: 'hello',
        surfaceId: 'surface-1',
      }),
    ).resolves.toEqual({ ok: true, accepted: true });

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

  it('routes desktop runtime status reads through the local API module without loopback proxying', async () => {
    const readDesktopAppStatus = vi.fn().mockResolvedValue({ profile: 'assistant', repoRoot: '/repo' });
    const readDesktopDaemonState = vi.fn().mockResolvedValue({
      service: { running: true },
      runtime: { running: true },
      warnings: [],
      log: { lines: [] },
    });
    const loadLocalApi = vi.fn().mockResolvedValue(
      createLocalApiModuleMock({
        readDesktopAppStatus,
        readDesktopDaemonState,
      }),
    );
    const backend = createBackendMock();
    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend, loadLocalApi);

    await expect(controller.readAppStatus?.()).resolves.toEqual({ profile: 'assistant', repoRoot: '/repo' });
    await expect(controller.readDaemonState?.()).resolves.toEqual({
      service: { running: true },
      runtime: { running: true },
      warnings: [],
      log: { lines: [] },
    });

    expect(readDesktopAppStatus).toHaveBeenCalledTimes(1);
    expect(readDesktopDaemonState).toHaveBeenCalledTimes(1);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop layout settings through the local API module without loopback proxying', async () => {
    const readDesktopOpenConversationTabs = vi.fn().mockResolvedValue({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-2'],
      archivedSessionIds: ['conversation-3'],
      workspacePaths: ['/tmp/alpha'],
    });
    const updateDesktopOpenConversationTabs = vi.fn().mockResolvedValue({
      ok: true,
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
      workspacePaths: ['/tmp/beta'],
    });
    const loadLocalApi = vi.fn().mockResolvedValue(
      createLocalApiModuleMock({
        readDesktopOpenConversationTabs,
        updateDesktopOpenConversationTabs,
      }),
    );
    const backend = createBackendMock();
    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend, loadLocalApi);

    await expect(controller.readOpenConversationTabs?.()).resolves.toEqual({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-2'],
      archivedSessionIds: ['conversation-3'],
      workspacePaths: ['/tmp/alpha'],
    });
    await expect(
      controller.updateOpenConversationTabs?.({
        sessionIds: ['conversation-4'],
        pinnedSessionIds: ['conversation-5'],
        archivedSessionIds: ['conversation-6'],
        workspacePaths: ['/tmp/beta'],
      }),
    ).resolves.toEqual({
      ok: true,
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
      workspacePaths: ['/tmp/beta'],
    });

    expect(readDesktopOpenConversationTabs).toHaveBeenCalledTimes(1);
    expect(updateDesktopOpenConversationTabs).toHaveBeenCalledWith({
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
      workspacePaths: ['/tmp/beta'],
    });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop session snapshot reads through the local API module without loopback proxying', async () => {
    const readDesktopSessions = vi.fn().mockResolvedValue([{ id: 'conversation-1', title: 'Conversation 1' }]);
    const readDesktopSessionMeta = vi.fn().mockResolvedValue({ id: 'conversation-1', title: 'Conversation 1' });
    const readDesktopSessionSearchIndex = vi.fn().mockResolvedValue({ index: { 'conversation-1': 'hello world' } });
    const loadLocalApi = vi.fn().mockResolvedValue(
      createLocalApiModuleMock({
        readDesktopSessions,
        readDesktopSessionMeta,
        readDesktopSessionSearchIndex,
      }),
    );
    const backend = createBackendMock();
    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend, loadLocalApi);

    await expect(controller.readSessions?.()).resolves.toEqual([{ id: 'conversation-1', title: 'Conversation 1' }]);
    await expect(controller.readSessionMeta?.('conversation-1')).resolves.toEqual({ id: 'conversation-1', title: 'Conversation 1' });
    await expect(controller.readSessionSearchIndex?.(['conversation-1'])).resolves.toEqual({
      index: { 'conversation-1': 'hello world' },
    });

    expect(readDesktopSessions).toHaveBeenCalledTimes(1);
    expect(readDesktopSessionMeta).toHaveBeenCalledWith('conversation-1');
    expect(readDesktopSessionSearchIndex).toHaveBeenCalledWith(['conversation-1']);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop operator settings through the local API module without loopback proxying', async () => {
    const readDesktopDefaultCwd = vi.fn().mockResolvedValue({ currentCwd: '', effectiveCwd: '/repo' });
    const updateDesktopDefaultCwd = vi.fn().mockResolvedValue({ currentCwd: './repo', effectiveCwd: '/repo' });
    const readDesktopVaultFiles = vi.fn().mockResolvedValue({ root: '/vault', files: [{ id: 'notes/a.md' }] });
    const pickDesktopFolder = vi.fn().mockResolvedValue({ path: '/picked/repo', cancelled: false });
    const readDesktopConversationTitleSettings = vi.fn().mockResolvedValue({
      enabled: true,
      currentModel: '',
      effectiveModel: 'openai/gpt-5.4',
    });
    const updateDesktopConversationTitleSettings = vi.fn().mockResolvedValue({
      enabled: false,
      currentModel: 'anthropic/claude-sonnet-4-6',
      effectiveModel: 'anthropic/claude-sonnet-4-6',
    });
    const loadLocalApi = vi.fn().mockResolvedValue(
      createLocalApiModuleMock({
        readDesktopDefaultCwd,
        updateDesktopDefaultCwd,
        readDesktopVaultFiles,
        pickDesktopFolder,
        readDesktopConversationTitleSettings,
        updateDesktopConversationTitleSettings,
      }),
    );
    const backend = createBackendMock();
    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend, loadLocalApi);

    await expect(controller.readDefaultCwd?.()).resolves.toEqual({ currentCwd: '', effectiveCwd: '/repo' });
    await expect(controller.updateDefaultCwd?.('./repo')).resolves.toEqual({ currentCwd: './repo', effectiveCwd: '/repo' });
    await expect(controller.readVaultFiles?.()).resolves.toEqual({ root: '/vault', files: [{ id: 'notes/a.md' }] });
    await expect(controller.pickFolder?.({ cwd: '/repo' })).resolves.toEqual({ path: '/picked/repo', cancelled: false });
    await expect(controller.readConversationTitleSettings?.()).resolves.toEqual({
      enabled: true,
      currentModel: '',
      effectiveModel: 'openai/gpt-5.4',
    });
    await expect(controller.updateConversationTitleSettings?.({ enabled: false, model: 'anthropic/claude-sonnet-4-6' })).resolves.toEqual({
      enabled: false,
      currentModel: 'anthropic/claude-sonnet-4-6',
      effectiveModel: 'anthropic/claude-sonnet-4-6',
    });

    expect(readDesktopDefaultCwd).toHaveBeenCalledTimes(1);
    expect(updateDesktopDefaultCwd).toHaveBeenCalledWith('./repo');
    expect(readDesktopVaultFiles).toHaveBeenCalledTimes(1);
    expect(pickDesktopFolder).toHaveBeenCalledWith({ cwd: '/repo' });
    expect(readDesktopConversationTitleSettings).toHaveBeenCalledTimes(1);
    expect(updateDesktopConversationTitleSettings).toHaveBeenCalledWith({ enabled: false, model: 'anthropic/claude-sonnet-4-6' });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop automation preset settings through the local API module without loopback proxying', async () => {
    const readDesktopConversationPlansWorkspace = vi.fn().mockResolvedValue({
      defaultEnabled: true,
      presetLibrary: {
        presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
        defaultPresetIds: ['preset-1'],
      },
    });
    const loadLocalApi = vi.fn().mockResolvedValue(
      createLocalApiModuleMock({
        readDesktopConversationPlansWorkspace,
      }),
    );
    const backend = createBackendMock();
    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend, loadLocalApi);

    await expect(controller.readConversationPlansWorkspace?.()).resolves.toEqual({
      defaultEnabled: true,
      presetLibrary: {
        presets: [{ id: 'preset-1', name: 'Preset 1', updatedAt: '2026-04-14T12:00:00.000Z', items: [] }],
        defaultPresetIds: ['preset-1'],
      },
    });

    expect(readDesktopConversationPlansWorkspace).toHaveBeenCalledTimes(1);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop conversation artifact and attachment capabilities through the local API module without loopback proxying', async () => {
    const readDesktopConversationArtifacts = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      artifacts: [{ id: 'artifact-1', title: 'Artifact 1' }],
    });
    const readDesktopConversationArtifact = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      artifact: { id: 'artifact-1', title: 'Artifact 1', kind: 'html' },
    });
    const readDesktopConversationAttachments = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    const readDesktopConversationAttachment = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
    });
    const createDesktopConversationAttachment = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    const updateDesktopConversationAttachment = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 2, latestRevision: { revision: 2 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    const readDesktopConversationAttachmentAsset = vi.fn().mockResolvedValue({
      dataUrl: 'data:image/png;base64,cHJldmlldw==',
      mimeType: 'image/png',
      fileName: 'preview.png',
    });
    const loadLocalApi = vi.fn().mockResolvedValue(
      createLocalApiModuleMock({
        readDesktopConversationArtifacts,
        readDesktopConversationArtifact,
        readDesktopConversationAttachments,
        readDesktopConversationAttachment,
        createDesktopConversationAttachment,
        updateDesktopConversationAttachment,
        readDesktopConversationAttachmentAsset,
      }),
    );
    const backend = createBackendMock();
    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend, loadLocalApi);

    await expect(controller.readConversationArtifacts?.('conversation-1')).resolves.toEqual({
      conversationId: 'conversation-1',
      artifacts: [{ id: 'artifact-1', title: 'Artifact 1' }],
    });
    await expect(controller.readConversationArtifact?.({ conversationId: 'conversation-1', artifactId: 'artifact-1' })).resolves.toEqual({
      conversationId: 'conversation-1',
      artifact: { id: 'artifact-1', title: 'Artifact 1', kind: 'html' },
    });
    await expect(controller.readConversationAttachments?.('conversation-1')).resolves.toEqual({
      conversationId: 'conversation-1',
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    await expect(
      controller.readConversationAttachment?.({ conversationId: 'conversation-1', attachmentId: 'attachment-1' }),
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
    });
    await expect(
      controller.createConversationAttachment?.({ conversationId: 'conversation-1', sourceData: 'source', previewData: 'preview' }),
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    await expect(
      controller.updateConversationAttachment?.({
        conversationId: 'conversation-1',
        attachmentId: 'attachment-1',
        sourceData: 'source',
        previewData: 'preview',
      }),
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 2, latestRevision: { revision: 2 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    await expect(
      controller.readConversationAttachmentAsset?.({
        conversationId: 'conversation-1',
        attachmentId: 'attachment-1',
        asset: 'preview',
        revision: 2,
      }),
    ).resolves.toEqual({
      dataUrl: 'data:image/png;base64,cHJldmlldw==',
      mimeType: 'image/png',
      fileName: 'preview.png',
    });

    expect(readDesktopConversationArtifacts).toHaveBeenCalledWith('conversation-1');
    expect(readDesktopConversationArtifact).toHaveBeenCalledWith({ conversationId: 'conversation-1', artifactId: 'artifact-1' });
    expect(readDesktopConversationAttachments).toHaveBeenCalledWith('conversation-1');
    expect(readDesktopConversationAttachment).toHaveBeenCalledWith({ conversationId: 'conversation-1', attachmentId: 'attachment-1' });
    expect(createDesktopConversationAttachment).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      sourceData: 'source',
      previewData: 'preview',
    });
    expect(updateDesktopConversationAttachment).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      attachmentId: 'attachment-1',
      sourceData: 'source',
      previewData: 'preview',
    });
    expect(readDesktopConversationAttachmentAsset).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      attachmentId: 'attachment-1',
      asset: 'preview',
      revision: 2,
    });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes dedicated model and provider capabilities through the local API module without loopback proxying', async () => {
    const unsubscribeProviderOAuth = vi.fn();
    const readDesktopModels = vi.fn().mockResolvedValue({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      models: [],
    });
    const updateDesktopModelPreferences = vi.fn().mockResolvedValue({ ok: true });
    const readDesktopModelProviders = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const saveDesktopModelProvider = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const deleteDesktopModelProvider = vi.fn().mockResolvedValue({ providers: [] });
    const saveDesktopModelProviderModel = vi.fn().mockResolvedValue({
      providers: [{ id: 'openrouter', models: [{ id: 'model-a' }] }],
    });
    const deleteDesktopModelProviderModel = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const readDesktopProviderAuth = vi.fn().mockResolvedValue({ providers: [{ id: 'openai', authType: 'api_key' }] });
    const setDesktopProviderApiKey = vi.fn().mockResolvedValue({ providers: [{ id: 'openai', authType: 'api_key' }] });
    const removeDesktopProviderCredential = vi.fn().mockResolvedValue({ providers: [] });
    const startDesktopProviderOAuthLogin = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', status: 'running' });
    const readDesktopProviderOAuthLogin = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', status: 'running' });
    const submitDesktopProviderOAuthLoginInput = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', status: 'running' });
    const cancelDesktopProviderOAuthLogin = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', status: 'cancelled' });
    const subscribeDesktopProviderOAuthLogin = vi.fn().mockResolvedValue(unsubscribeProviderOAuth);
    const loadLocalApi = vi.fn().mockResolvedValue(
      createLocalApiModuleMock({
        readDesktopModels,
        updateDesktopModelPreferences,
        readDesktopModelProviders,
        saveDesktopModelProvider,
        deleteDesktopModelProvider,
        saveDesktopModelProviderModel,
        deleteDesktopModelProviderModel,
        readDesktopProviderAuth,
        setDesktopProviderApiKey,
        removeDesktopProviderCredential,
        startDesktopProviderOAuthLogin,
        readDesktopProviderOAuthLogin,
        submitDesktopProviderOAuthLoginInput,
        cancelDesktopProviderOAuthLogin,
        subscribeDesktopProviderOAuthLogin,
      }),
    );
    const backend = createBackendMock();
    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend, loadLocalApi);
    const onState = vi.fn();

    await expect(controller.readModels?.()).resolves.toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: 'high',
      currentServiceTier: '',
      models: [],
    });
    await expect(controller.updateModelPreferences?.({ model: 'gpt-5.4', thinkingLevel: 'medium' })).resolves.toEqual({ ok: true });
    await expect(controller.readModelProviders?.()).resolves.toEqual({ providers: [{ id: 'openrouter', models: [] }] });
    await expect(controller.saveModelProvider?.({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api' })).resolves.toEqual({
      providers: [{ id: 'openrouter', models: [] }],
    });
    await expect(controller.deleteModelProvider?.('openrouter')).resolves.toEqual({ providers: [] });
    await expect(controller.saveModelProviderModel?.({ provider: 'openrouter', modelId: 'model-a' })).resolves.toEqual({
      providers: [{ id: 'openrouter', models: [{ id: 'model-a' }] }],
    });
    await expect(controller.deleteModelProviderModel?.({ provider: 'openrouter', modelId: 'model-a' })).resolves.toEqual({
      providers: [{ id: 'openrouter', models: [] }],
    });
    await expect(controller.readProviderAuth?.()).resolves.toEqual({ providers: [{ id: 'openai', authType: 'api_key' }] });
    await expect(controller.setProviderApiKey?.({ provider: 'openai', apiKey: 'sk-test' })).resolves.toEqual({
      providers: [{ id: 'openai', authType: 'api_key' }],
    });
    await expect(controller.removeProviderCredential?.('openai')).resolves.toEqual({ providers: [] });
    await expect(controller.startProviderOAuthLogin?.('openrouter')).resolves.toEqual({
      id: 'login-1',
      provider: 'openrouter',
      status: 'running',
    });
    await expect(controller.readProviderOAuthLogin?.('login-1')).resolves.toEqual({
      id: 'login-1',
      provider: 'openrouter',
      status: 'running',
    });
    await expect(controller.submitProviderOAuthLoginInput?.({ loginId: 'login-1', value: '123456' })).resolves.toEqual({
      id: 'login-1',
      provider: 'openrouter',
      status: 'running',
    });
    await expect(controller.cancelProviderOAuthLogin?.('login-1')).resolves.toEqual({
      id: 'login-1',
      provider: 'openrouter',
      status: 'cancelled',
    });
    await expect(controller.subscribeProviderOAuthLogin?.('login-1', onState)).resolves.toBe(unsubscribeProviderOAuth);

    expect(readDesktopModels).toHaveBeenCalledTimes(1);
    expect(updateDesktopModelPreferences).toHaveBeenCalledWith({ model: 'gpt-5.4', thinkingLevel: 'medium' });
    expect(readDesktopModelProviders).toHaveBeenCalledTimes(1);
    expect(saveDesktopModelProvider).toHaveBeenCalledWith({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api' });
    expect(deleteDesktopModelProvider).toHaveBeenCalledWith('openrouter');
    expect(saveDesktopModelProviderModel).toHaveBeenCalledWith({ provider: 'openrouter', modelId: 'model-a' });
    expect(deleteDesktopModelProviderModel).toHaveBeenCalledWith({ provider: 'openrouter', modelId: 'model-a' });
    expect(readDesktopProviderAuth).toHaveBeenCalledTimes(1);
    expect(setDesktopProviderApiKey).toHaveBeenCalledWith({ provider: 'openai', apiKey: 'sk-test' });
    expect(removeDesktopProviderCredential).toHaveBeenCalledWith('openai');
    expect(startDesktopProviderOAuthLogin).toHaveBeenCalledWith('openrouter');
    expect(readDesktopProviderOAuthLogin).toHaveBeenCalledWith('login-1');
    expect(submitDesktopProviderOAuthLoginInput).toHaveBeenCalledWith({ loginId: 'login-1', value: '123456' });
    expect(cancelDesktopProviderOAuthLogin).toHaveBeenCalledWith('login-1');
    expect(subscribeDesktopProviderOAuthLogin).toHaveBeenCalledWith('login-1', onState);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes live-session event streams through the local API module without loopback proxying', async () => {
    const unsubscribe = vi.fn();
    const subscribeDesktopLocalApiStream = vi.fn().mockResolvedValue(unsubscribe);
    const loadLocalApi = vi.fn().mockResolvedValue(
      createLocalApiModuleMock({
        subscribeDesktopLocalApiStream,
      }),
    );
    const backend = createBackendMock();

    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend, loadLocalApi);
    const onEvent = vi.fn();

    await expect(controller.subscribeApiStream('/api/live-sessions/live-1/events?tailBlocks=20', onEvent)).resolves.toBe(unsubscribe);

    expect(loadLocalApi).toHaveBeenCalledTimes(1);
    expect(subscribeDesktopLocalApiStream).toHaveBeenCalledWith('/api/live-sessions/live-1/events?tailBlocks=20', onEvent);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes dedicated conversation and live-session capabilities through the local API module without loopback proxying', async () => {
    const readDesktopDurableRuns = vi.fn().mockResolvedValue({
      scannedAt: '2026-04-10T11:00:00.000Z',
      runsRoot: '/runs',
      summary: { total: 0, recoveryActions: {}, statuses: {} },
      runs: [],
    });
    const readDesktopDurableRun = vi.fn().mockResolvedValue({
      scannedAt: '2026-04-10T11:00:00.000Z',
      runsRoot: '/runs',
      run: { runId: 'run-1' },
    });
    const readDesktopDurableRunLog = vi.fn().mockResolvedValue({ path: '/runs/run-1.log', log: 'tail' });
    const cancelDesktopDurableRun = vi.fn().mockResolvedValue({ cancelled: true, runId: 'run-1' });
    const markDesktopDurableRunAttention = vi.fn().mockResolvedValue({ ok: true });
    const readDesktopConversationBootstrap = vi.fn().mockResolvedValue({
      conversationId: 'live-1',
      sessionDetail: null,
      liveSession: { live: true, id: 'live-1' },
    });
    const renameDesktopConversation = vi.fn().mockResolvedValue({ ok: true, title: 'Renamed conversation' });
    const readDesktopConversationDeferredResumes = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      resumes: [{ id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z' }],
    });
    const scheduleDesktopConversationDeferredResume = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' },
      resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' }],
    });
    const cancelDesktopConversationDeferredResume = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      cancelledId: 'resume-2',
      resumes: [],
    });
    const fireDesktopConversationDeferredResume = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      resume: { id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z', prompt: 'Resume now.' },
      resumes: [],
    });
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
    const readDesktopSessionDetail = vi.fn().mockResolvedValue({
      meta: { id: 'live-1' },
      blocks: [],
      blockOffset: 0,
      totalBlocks: 0,
      contextUsage: null,
    });
    const readDesktopSessionBlock = vi.fn().mockResolvedValue({ id: 'block-1', type: 'text', text: 'hello' });
    const createDesktopLiveSession = vi.fn().mockResolvedValue({
      id: 'live-1',
      sessionFile: '/tmp/live-1.jsonl',
      bootstrap: {
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
      },
    });
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
    const abortDesktopLiveSession = vi.fn().mockResolvedValue({ ok: true });
    const loadLocalApi = vi.fn().mockResolvedValue(
      createLocalApiModuleMock({
        readDesktopDurableRuns,
        readDesktopDurableRun,
        readDesktopDurableRunLog,
        cancelDesktopDurableRun,
        markDesktopDurableRunAttention,
        readDesktopConversationBootstrap,
        renameDesktopConversation,
        readDesktopConversationDeferredResumes,
        scheduleDesktopConversationDeferredResume,
        cancelDesktopConversationDeferredResume,
        fireDesktopConversationDeferredResume,
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
        abortDesktopLiveSession,
      }),
    );
    const backend = createBackendMock();

    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend, loadLocalApi);

    await expect(controller.readDurableRuns?.()).resolves.toMatchObject({ runsRoot: '/runs' });
    await expect(controller.readDurableRun?.('run-1')).resolves.toMatchObject({ runsRoot: '/runs' });
    await expect(controller.readDurableRunLog?.({ runId: 'run-1', tail: 25 })).resolves.toEqual({
      path: '/runs/run-1.log',
      log: 'tail',
    });
    await expect(controller.cancelDurableRun?.('run-1')).resolves.toEqual({ cancelled: true, runId: 'run-1' });
    await expect(controller.markDurableRunAttention?.({ runId: 'run-1', read: false })).resolves.toEqual({ ok: true });
    await expect(controller.readConversationBootstrap?.({ conversationId: 'live-1', tailBlocks: 12 })).resolves.toEqual({
      conversationId: 'live-1',
      sessionDetail: null,
      liveSession: { live: true, id: 'live-1' },
    });
    await expect(
      controller.renameConversation?.({ conversationId: 'live-1', name: 'Renamed conversation', surfaceId: 'surface-1' }),
    ).resolves.toEqual({
      ok: true,
      title: 'Renamed conversation',
    });
    await expect(controller.readConversationDeferredResumes?.('conversation-1')).resolves.toEqual({
      conversationId: 'conversation-1',
      resumes: [{ id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z' }],
    });
    await expect(
      controller.scheduleConversationDeferredResume?.({
        conversationId: 'conversation-1',
        delay: '10m',
        prompt: 'Resume later.',
        behavior: 'followUp',
      }),
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' },
      resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z', behavior: 'followUp' }],
    });
    await expect(
      controller.cancelConversationDeferredResume?.({ conversationId: 'conversation-1', resumeId: 'resume-2' }),
    ).resolves.toEqual({
      conversationId: 'conversation-1',
      cancelledId: 'resume-2',
      resumes: [],
    });
    await expect(controller.fireConversationDeferredResume?.({ conversationId: 'conversation-1', resumeId: 'resume-1' })).resolves.toEqual({
      conversationId: 'conversation-1',
      resume: { id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z', prompt: 'Resume now.' },
      resumes: [],
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
      bootstrap: {
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
      },
    });
    await expect(controller.resumeLiveSession?.({ sessionFile: '/tmp/live-1.jsonl', cwd: '/repo' })).resolves.toEqual({
      id: 'live-1',
    });
    await expect(controller.takeOverLiveSession?.({ conversationId: 'live-1', surfaceId: 'surface-1' })).resolves.toEqual({
      controllerSurfaceId: 'surface-1',
    });
    await expect(
      controller.submitLiveSessionPrompt?.({
        conversationId: 'live-1',
        text: 'hello',
        surfaceId: 'surface-1',
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'started' }));
    await expect(
      controller.restoreQueuedLiveSessionMessage?.({ conversationId: 'live-1', behavior: 'followUp', index: 0 }),
    ).resolves.toEqual({ ok: true, text: 'queued hello', images: [] });
    await expect(controller.compactLiveSession?.({ conversationId: 'live-1', customInstructions: 'be shorter' })).resolves.toEqual({
      ok: true,
      result: { compacted: true },
    });
    await expect(controller.exportLiveSession?.({ conversationId: 'live-1', outputPath: '/tmp/live-1.html' })).resolves.toEqual({
      ok: true,
      path: '/tmp/live-1.html',
    });
    await expect(controller.reloadLiveSession?.('live-1')).resolves.toEqual({ ok: true });
    await expect(controller.destroyLiveSession?.('live-1')).resolves.toEqual({ ok: true });
    await expect(controller.branchLiveSession?.({ conversationId: 'live-1', entryId: 'entry-1' })).resolves.toEqual({
      newSessionId: 'branch-1',
      sessionFile: '/tmp/branch-1.jsonl',
    });
    await expect(
      controller.forkLiveSession?.({ conversationId: 'live-1', entryId: 'entry-1', preserveSource: true, beforeEntry: true }),
    ).resolves.toEqual({ newSessionId: 'fork-1', sessionFile: '/tmp/fork-1.jsonl' });
    await expect(controller.abortLiveSession?.('live-1')).resolves.toEqual({ ok: true });

    expect(readDesktopDurableRuns).toHaveBeenCalledTimes(1);
    expect(readDesktopDurableRun).toHaveBeenCalledWith('run-1');
    expect(readDesktopDurableRunLog).toHaveBeenCalledWith({ runId: 'run-1', tail: 25 });
    expect(cancelDesktopDurableRun).toHaveBeenCalledWith('run-1');
    expect(markDesktopDurableRunAttention).toHaveBeenCalledWith({ runId: 'run-1', read: false });
    expect(readDesktopConversationBootstrap).toHaveBeenCalledWith({ conversationId: 'live-1', tailBlocks: 12 });
    expect(renameDesktopConversation).toHaveBeenCalledWith({
      conversationId: 'live-1',
      name: 'Renamed conversation',
      surfaceId: 'surface-1',
    });
    expect(readDesktopConversationDeferredResumes).toHaveBeenCalledWith('conversation-1');
    expect(scheduleDesktopConversationDeferredResume).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      delay: '10m',
      prompt: 'Resume later.',
      behavior: 'followUp',
    });
    expect(cancelDesktopConversationDeferredResume).toHaveBeenCalledWith({ conversationId: 'conversation-1', resumeId: 'resume-2' });
    expect(fireDesktopConversationDeferredResume).toHaveBeenCalledWith({ conversationId: 'conversation-1', resumeId: 'resume-1' });
    expect(recoverDesktopConversation).toHaveBeenCalledWith('conversation-1');
    expect(readDesktopLiveSession).toHaveBeenCalledWith('live-1');
    expect(readDesktopLiveSessionForkEntries).toHaveBeenCalledWith('live-1');
    expect(readDesktopLiveSessionContext).toHaveBeenCalledWith('live-1');
    expect(readDesktopSessionDetail).toHaveBeenCalledWith({ sessionId: 'live-1', tailBlocks: 24 });
    expect(readDesktopSessionBlock).toHaveBeenCalledWith({ sessionId: 'live-1', blockId: 'block-1' });
    expect(createDesktopLiveSession).toHaveBeenCalledWith({ cwd: '/repo', model: 'gpt-5.4' });
    expect(resumeDesktopLiveSession).toHaveBeenCalledWith({ sessionFile: '/tmp/live-1.jsonl', cwd: '/repo' });
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
    expect(forkDesktopLiveSession).toHaveBeenCalledWith({
      conversationId: 'live-1',
      entryId: 'entry-1',
      preserveSource: true,
      beforeEntry: true,
    });
    expect(abortDesktopLiveSession).toHaveBeenCalledWith('live-1');
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop app events through the local API module without loopback proxying', async () => {
    const unsubscribe = vi.fn();
    const subscribeDesktopAppEvents = vi.fn().mockResolvedValue(unsubscribe);
    const loadLocalApi = vi.fn().mockResolvedValue(
      createLocalApiModuleMock({
        subscribeDesktopAppEvents,
      }),
    );
    const backend = createBackendMock();

    const controller = new LocalHostController({ id: 'local', label: 'Local', kind: 'local' }, backend, loadLocalApi);
    const onEvent = vi.fn();

    await expect(controller.subscribeDesktopAppEvents?.(onEvent)).resolves.toBe(unsubscribe);

    expect(loadLocalApi).toHaveBeenCalledTimes(1);
    expect(subscribeDesktopAppEvents).toHaveBeenCalledWith(onEvent);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });
});
