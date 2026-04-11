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
    readDesktopWebUiState: vi.fn(),
    updateDesktopWebUiConfig: vi.fn(),
    readDesktopRemoteAccessState: vi.fn(),
    createDesktopRemoteAccessPairingCode: vi.fn(),
    revokeDesktopRemoteAccessSession: vi.fn(),
    readDesktopSessions: vi.fn(),
    readDesktopSessionMeta: vi.fn(),
    readDesktopSessionSearchIndex: vi.fn(),
    readDesktopProfiles: vi.fn(),
    setDesktopCurrentProfile: vi.fn(),
    readDesktopModels: vi.fn(),
    updateDesktopModelPreferences: vi.fn(),
    readDesktopDefaultCwd: vi.fn(),
    updateDesktopDefaultCwd: vi.fn(),
    readDesktopVaultRoot: vi.fn(),
    readDesktopVaultFiles: vi.fn(),
    updateDesktopVaultRoot: vi.fn(),
    pickDesktopFolder: vi.fn(),
    runDesktopShellCommand: vi.fn(),
    readDesktopConversationTitleSettings: vi.fn(),
    updateDesktopConversationTitleSettings: vi.fn(),
    readDesktopConversationPlansWorkspace: vi.fn(),
    readDesktopModelProviders: vi.fn(),
    saveDesktopModelProvider: vi.fn(),
    deleteDesktopModelProvider: vi.fn(),
    saveDesktopModelProviderModel: vi.fn(),
    deleteDesktopModelProviderModel: vi.fn(),
    readDesktopProviderAuth: vi.fn(),
    readDesktopCodexPlanUsage: vi.fn(),
    setDesktopProviderApiKey: vi.fn(),
    removeDesktopProviderCredential: vi.fn(),
    startDesktopProviderOAuthLogin: vi.fn(),
    readDesktopProviderOAuthLogin: vi.fn(),
    submitDesktopProviderOAuthLoginInput: vi.fn(),
    cancelDesktopProviderOAuthLogin: vi.fn(),
    subscribeDesktopProviderOAuthLogin: vi.fn(),
    readDesktopActivity: vi.fn(),
    readDesktopActivityById: vi.fn(),
    markDesktopActivityRead: vi.fn(),
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
    deleteDesktopConversationArtifact: vi.fn(),
    readDesktopConversationAttachments: vi.fn(),
    readDesktopConversationAttachment: vi.fn(),
    createDesktopConversationAttachment: vi.fn(),
    updateDesktopConversationAttachment: vi.fn(),
    deleteDesktopConversationAttachment: vi.fn(),
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

  it('routes desktop runtime status reads through the local API module without loopback proxying', async () => {
    const readDesktopAppStatus = vi.fn().mockResolvedValue({ profile: 'assistant', repoRoot: '/repo', activityCount: 2 });
    const readDesktopDaemonState = vi.fn().mockResolvedValue({ service: { running: true }, runtime: { running: true }, warnings: [], log: { lines: [] } });
    const readDesktopWebUiState = vi.fn().mockResolvedValue({ service: { running: true, platform: 'desktop' }, warnings: [], log: { lines: [] } });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopAppStatus,
      readDesktopDaemonState,
      readDesktopWebUiState,
    }));
    const backend = createBackendMock();
    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.readAppStatus?.()).resolves.toEqual({ profile: 'assistant', repoRoot: '/repo', activityCount: 2 });
    await expect(controller.readDaemonState?.()).resolves.toEqual({ service: { running: true }, runtime: { running: true }, warnings: [], log: { lines: [] } });
    await expect(controller.readWebUiState?.()).resolves.toEqual({ service: { running: true, platform: 'desktop' }, warnings: [], log: { lines: [] } });

    expect(readDesktopAppStatus).toHaveBeenCalledTimes(1);
    expect(readDesktopDaemonState).toHaveBeenCalledTimes(1);
    expect(readDesktopWebUiState).toHaveBeenCalledTimes(1);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop system admin settings through the local API module without loopback proxying', async () => {
    const updateDesktopWebUiConfig = vi.fn().mockResolvedValue({
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
    const readDesktopRemoteAccessState = vi.fn().mockResolvedValue({
      pendingPairings: [],
      sessions: [{ id: 'session-1', label: 'iPhone' }],
    });
    const createDesktopRemoteAccessPairingCode = vi.fn().mockResolvedValue({
      id: 'pairing-1',
      code: '123456',
      createdAt: '2026-04-15T10:00:00.000Z',
      expiresAt: '2026-04-15T10:10:00.000Z',
    });
    const revokeDesktopRemoteAccessSession = vi.fn().mockResolvedValue({
      ok: true,
      state: { pendingPairings: [], sessions: [] },
    });
    const readDesktopOpenConversationTabs = vi.fn().mockResolvedValue({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-2'],
      archivedSessionIds: ['conversation-3'],
    });
    const updateDesktopOpenConversationTabs = vi.fn().mockResolvedValue({
      ok: true,
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
    });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      updateDesktopWebUiConfig,
      readDesktopRemoteAccessState,
      createDesktopRemoteAccessPairingCode,
      revokeDesktopRemoteAccessSession,
      readDesktopOpenConversationTabs,
      updateDesktopOpenConversationTabs,
    }));
    const backend = createBackendMock();
    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.updateWebUiConfig?.({ resumeFallbackPrompt: 'Resume the task.' })).resolves.toEqual({
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
    await expect(controller.readRemoteAccessState?.()).resolves.toEqual({
      pendingPairings: [],
      sessions: [{ id: 'session-1', label: 'iPhone' }],
    });
    await expect(controller.createRemoteAccessPairingCode?.()).resolves.toEqual({
      id: 'pairing-1',
      code: '123456',
      createdAt: '2026-04-15T10:00:00.000Z',
      expiresAt: '2026-04-15T10:10:00.000Z',
    });
    await expect(controller.revokeRemoteAccessSession?.('session-1')).resolves.toEqual({
      ok: true,
      state: { pendingPairings: [], sessions: [] },
    });
    await expect(controller.readOpenConversationTabs?.()).resolves.toEqual({
      sessionIds: ['conversation-1'],
      pinnedSessionIds: ['conversation-2'],
      archivedSessionIds: ['conversation-3'],
    });
    await expect(controller.updateOpenConversationTabs?.({ sessionIds: ['conversation-4'], pinnedSessionIds: ['conversation-5'], archivedSessionIds: ['conversation-6'] })).resolves.toEqual({
      ok: true,
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
    });

    expect(updateDesktopWebUiConfig).toHaveBeenCalledWith({ resumeFallbackPrompt: 'Resume the task.' });
    expect(readDesktopRemoteAccessState).toHaveBeenCalledTimes(1);
    expect(createDesktopRemoteAccessPairingCode).toHaveBeenCalledTimes(1);
    expect(revokeDesktopRemoteAccessSession).toHaveBeenCalledWith('session-1');
    expect(readDesktopOpenConversationTabs).toHaveBeenCalledTimes(1);
    expect(updateDesktopOpenConversationTabs).toHaveBeenCalledWith({
      sessionIds: ['conversation-4'],
      pinnedSessionIds: ['conversation-5'],
      archivedSessionIds: ['conversation-6'],
    });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop session snapshot reads through the local API module without loopback proxying', async () => {
    const readDesktopSessions = vi.fn().mockResolvedValue([{ id: 'conversation-1', title: 'Conversation 1' }]);
    const readDesktopSessionMeta = vi.fn().mockResolvedValue({ id: 'conversation-1', title: 'Conversation 1' });
    const readDesktopSessionSearchIndex = vi.fn().mockResolvedValue({ index: { 'conversation-1': 'hello world' } });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopSessions,
      readDesktopSessionMeta,
      readDesktopSessionSearchIndex,
    }));
    const backend = createBackendMock();
    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.readSessions?.()).resolves.toEqual([{ id: 'conversation-1', title: 'Conversation 1' }]);
    await expect(controller.readSessionMeta?.('conversation-1')).resolves.toEqual({ id: 'conversation-1', title: 'Conversation 1' });
    await expect(controller.readSessionSearchIndex?.(['conversation-1'])).resolves.toEqual({ index: { 'conversation-1': 'hello world' } });

    expect(readDesktopSessions).toHaveBeenCalledTimes(1);
    expect(readDesktopSessionMeta).toHaveBeenCalledWith('conversation-1');
    expect(readDesktopSessionSearchIndex).toHaveBeenCalledWith(['conversation-1']);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop operator settings through the local API module without loopback proxying', async () => {
    const readDesktopProfiles = vi.fn().mockResolvedValue({ currentProfile: 'assistant', profiles: ['assistant', 'shared'] });
    const setDesktopCurrentProfile = vi.fn().mockResolvedValue({ ok: true, currentProfile: 'shared' });
    const readDesktopDefaultCwd = vi.fn().mockResolvedValue({ currentCwd: '', effectiveCwd: '/repo' });
    const updateDesktopDefaultCwd = vi.fn().mockResolvedValue({ currentCwd: './repo', effectiveCwd: '/repo' });
    const readDesktopVaultRoot = vi.fn().mockResolvedValue({ currentRoot: '', effectiveRoot: '/vault', defaultRoot: '/vault', source: 'default' });
    const readDesktopVaultFiles = vi.fn().mockResolvedValue({ root: '/vault', files: [{ id: 'notes/a.md' }] });
    const updateDesktopVaultRoot = vi.fn().mockResolvedValue({ currentRoot: '~/vault', effectiveRoot: '/Users/patrick/vault', defaultRoot: '/vault', source: 'config' });
    const pickDesktopFolder = vi.fn().mockResolvedValue({ path: '/picked/repo', cancelled: false });
    const readDesktopConversationTitleSettings = vi.fn().mockResolvedValue({ enabled: true, currentModel: '', effectiveModel: 'openai/gpt-5.4' });
    const updateDesktopConversationTitleSettings = vi.fn().mockResolvedValue({ enabled: false, currentModel: 'anthropic/claude-sonnet-4-6', effectiveModel: 'anthropic/claude-sonnet-4-6' });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopProfiles,
      setDesktopCurrentProfile,
      readDesktopDefaultCwd,
      updateDesktopDefaultCwd,
      readDesktopVaultRoot,
      readDesktopVaultFiles,
      updateDesktopVaultRoot,
      pickDesktopFolder,
      readDesktopConversationTitleSettings,
      updateDesktopConversationTitleSettings,
    }));
    const backend = createBackendMock();
    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.readProfiles?.()).resolves.toEqual({ currentProfile: 'assistant', profiles: ['assistant', 'shared'] });
    await expect(controller.setCurrentProfile?.('shared')).resolves.toEqual({ ok: true, currentProfile: 'shared' });
    await expect(controller.readDefaultCwd?.()).resolves.toEqual({ currentCwd: '', effectiveCwd: '/repo' });
    await expect(controller.updateDefaultCwd?.('./repo')).resolves.toEqual({ currentCwd: './repo', effectiveCwd: '/repo' });
    await expect(controller.readVaultRoot?.()).resolves.toEqual({ currentRoot: '', effectiveRoot: '/vault', defaultRoot: '/vault', source: 'default' });
    await expect(controller.readVaultFiles?.()).resolves.toEqual({ root: '/vault', files: [{ id: 'notes/a.md' }] });
    await expect(controller.updateVaultRoot?.('~/vault')).resolves.toEqual({ currentRoot: '~/vault', effectiveRoot: '/Users/patrick/vault', defaultRoot: '/vault', source: 'config' });
    await expect(controller.pickFolder?.({ cwd: '/repo' })).resolves.toEqual({ path: '/picked/repo', cancelled: false });
    await expect(controller.readConversationTitleSettings?.()).resolves.toEqual({ enabled: true, currentModel: '', effectiveModel: 'openai/gpt-5.4' });
    await expect(controller.updateConversationTitleSettings?.({ enabled: false, model: 'anthropic/claude-sonnet-4-6' })).resolves.toEqual({ enabled: false, currentModel: 'anthropic/claude-sonnet-4-6', effectiveModel: 'anthropic/claude-sonnet-4-6' });

    expect(readDesktopProfiles).toHaveBeenCalledTimes(1);
    expect(setDesktopCurrentProfile).toHaveBeenCalledWith('shared');
    expect(readDesktopDefaultCwd).toHaveBeenCalledTimes(1);
    expect(updateDesktopDefaultCwd).toHaveBeenCalledWith('./repo');
    expect(readDesktopVaultRoot).toHaveBeenCalledTimes(1);
    expect(readDesktopVaultFiles).toHaveBeenCalledTimes(1);
    expect(updateDesktopVaultRoot).toHaveBeenCalledWith('~/vault');
    expect(pickDesktopFolder).toHaveBeenCalledWith({ cwd: '/repo' });
    expect(readDesktopConversationTitleSettings).toHaveBeenCalledTimes(1);
    expect(updateDesktopConversationTitleSettings).toHaveBeenCalledWith({ enabled: false, model: 'anthropic/claude-sonnet-4-6' });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes desktop shell commands through the local API module without loopback proxying', async () => {
    const runDesktopShellCommand = vi.fn().mockResolvedValue({
      output: '/workspace/repo\n',
      exitCode: 0,
      cwd: '/workspace/repo',
    });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      runDesktopShellCommand,
    }));
    const backend = createBackendMock();
    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.runShellCommand?.({ command: 'pwd', cwd: '/workspace/repo' })).resolves.toEqual({
      output: '/workspace/repo\n',
      exitCode: 0,
      cwd: '/workspace/repo',
    });

    expect(runDesktopShellCommand).toHaveBeenCalledWith({ command: 'pwd', cwd: '/workspace/repo' });
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
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopConversationPlansWorkspace,
    }));
    const backend = createBackendMock();
    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

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
    const deleteDesktopConversationArtifact = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      deleted: true,
      artifactId: 'artifact-1',
      artifacts: [],
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
    const deleteDesktopConversationAttachment = vi.fn().mockResolvedValue({
      conversationId: 'conversation-1',
      deleted: true,
      attachmentId: 'attachment-1',
      attachments: [],
    });
    const readDesktopConversationAttachmentAsset = vi.fn().mockResolvedValue({
      dataUrl: 'data:image/png;base64,cHJldmlldw==',
      mimeType: 'image/png',
      fileName: 'preview.png',
    });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopConversationArtifacts,
      readDesktopConversationArtifact,
      deleteDesktopConversationArtifact,
      readDesktopConversationAttachments,
      readDesktopConversationAttachment,
      createDesktopConversationAttachment,
      updateDesktopConversationAttachment,
      deleteDesktopConversationAttachment,
      readDesktopConversationAttachmentAsset,
    }));
    const backend = createBackendMock();
    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );

    await expect(controller.readConversationArtifacts?.('conversation-1')).resolves.toEqual({
      conversationId: 'conversation-1',
      artifacts: [{ id: 'artifact-1', title: 'Artifact 1' }],
    });
    await expect(controller.readConversationArtifact?.({ conversationId: 'conversation-1', artifactId: 'artifact-1' })).resolves.toEqual({
      conversationId: 'conversation-1',
      artifact: { id: 'artifact-1', title: 'Artifact 1', kind: 'html' },
    });
    await expect(controller.deleteConversationArtifact?.({ conversationId: 'conversation-1', artifactId: 'artifact-1' })).resolves.toEqual({
      conversationId: 'conversation-1',
      deleted: true,
      artifactId: 'artifact-1',
      artifacts: [],
    });
    await expect(controller.readConversationAttachments?.('conversation-1')).resolves.toEqual({
      conversationId: 'conversation-1',
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    await expect(controller.readConversationAttachment?.({ conversationId: 'conversation-1', attachmentId: 'attachment-1' })).resolves.toEqual({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
    });
    await expect(controller.createConversationAttachment?.({ conversationId: 'conversation-1', sourceData: 'source', previewData: 'preview' })).resolves.toEqual({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 1, latestRevision: { revision: 1 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    await expect(controller.updateConversationAttachment?.({ conversationId: 'conversation-1', attachmentId: 'attachment-1', sourceData: 'source', previewData: 'preview' })).resolves.toEqual({
      conversationId: 'conversation-1',
      attachment: { id: 'attachment-1', kind: 'excalidraw', currentRevision: 2, latestRevision: { revision: 2 } },
      attachments: [{ id: 'attachment-1', kind: 'excalidraw' }],
    });
    await expect(controller.deleteConversationAttachment?.({ conversationId: 'conversation-1', attachmentId: 'attachment-1' })).resolves.toEqual({
      conversationId: 'conversation-1',
      deleted: true,
      attachmentId: 'attachment-1',
      attachments: [],
    });
    await expect(controller.readConversationAttachmentAsset?.({ conversationId: 'conversation-1', attachmentId: 'attachment-1', asset: 'preview', revision: 2 })).resolves.toEqual({
      dataUrl: 'data:image/png;base64,cHJldmlldw==',
      mimeType: 'image/png',
      fileName: 'preview.png',
    });

    expect(readDesktopConversationArtifacts).toHaveBeenCalledWith('conversation-1');
    expect(readDesktopConversationArtifact).toHaveBeenCalledWith({ conversationId: 'conversation-1', artifactId: 'artifact-1' });
    expect(deleteDesktopConversationArtifact).toHaveBeenCalledWith({ conversationId: 'conversation-1', artifactId: 'artifact-1' });
    expect(readDesktopConversationAttachments).toHaveBeenCalledWith('conversation-1');
    expect(readDesktopConversationAttachment).toHaveBeenCalledWith({ conversationId: 'conversation-1', attachmentId: 'attachment-1' });
    expect(createDesktopConversationAttachment).toHaveBeenCalledWith({ conversationId: 'conversation-1', sourceData: 'source', previewData: 'preview' });
    expect(updateDesktopConversationAttachment).toHaveBeenCalledWith({ conversationId: 'conversation-1', attachmentId: 'attachment-1', sourceData: 'source', previewData: 'preview' });
    expect(deleteDesktopConversationAttachment).toHaveBeenCalledWith({ conversationId: 'conversation-1', attachmentId: 'attachment-1' });
    expect(readDesktopConversationAttachmentAsset).toHaveBeenCalledWith({ conversationId: 'conversation-1', attachmentId: 'attachment-1', asset: 'preview', revision: 2 });
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes dedicated model and provider capabilities through the local API module without loopback proxying', async () => {
    const unsubscribeProviderOAuth = vi.fn();
    const readDesktopModels = vi.fn().mockResolvedValue({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', models: [] });
    const updateDesktopModelPreferences = vi.fn().mockResolvedValue({ ok: true });
    const readDesktopModelProviders = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const saveDesktopModelProvider = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const deleteDesktopModelProvider = vi.fn().mockResolvedValue({ providers: [] });
    const saveDesktopModelProviderModel = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [{ id: 'model-a' }] }] });
    const deleteDesktopModelProviderModel = vi.fn().mockResolvedValue({ providers: [{ id: 'openrouter', models: [] }] });
    const readDesktopProviderAuth = vi.fn().mockResolvedValue({ providers: [{ id: 'openai', authType: 'api_key' }] });
    const readDesktopCodexPlanUsage = vi.fn().mockResolvedValue({ available: true, planType: 'plus' });
    const setDesktopProviderApiKey = vi.fn().mockResolvedValue({ providers: [{ id: 'openai', authType: 'api_key' }] });
    const removeDesktopProviderCredential = vi.fn().mockResolvedValue({ providers: [] });
    const startDesktopProviderOAuthLogin = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', status: 'running' });
    const readDesktopProviderOAuthLogin = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', status: 'running' });
    const submitDesktopProviderOAuthLoginInput = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', status: 'running' });
    const cancelDesktopProviderOAuthLogin = vi.fn().mockResolvedValue({ id: 'login-1', provider: 'openrouter', status: 'cancelled' });
    const subscribeDesktopProviderOAuthLogin = vi.fn().mockResolvedValue(unsubscribeProviderOAuth);
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopModels,
      updateDesktopModelPreferences,
      readDesktopModelProviders,
      saveDesktopModelProvider,
      deleteDesktopModelProvider,
      saveDesktopModelProviderModel,
      deleteDesktopModelProviderModel,
      readDesktopProviderAuth,
      readDesktopCodexPlanUsage,
      setDesktopProviderApiKey,
      removeDesktopProviderCredential,
      startDesktopProviderOAuthLogin,
      readDesktopProviderOAuthLogin,
      submitDesktopProviderOAuthLoginInput,
      cancelDesktopProviderOAuthLogin,
      subscribeDesktopProviderOAuthLogin,
    }));
    const backend = createBackendMock();
    const controller = new LocalHostController(
      { id: 'local', label: 'Local', kind: 'local' },
      backend,
      loadLocalApi,
    );
    const onState = vi.fn();

    await expect(controller.readModels?.()).resolves.toEqual({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', models: [] });
    await expect(controller.updateModelPreferences?.({ model: 'gpt-5.4', thinkingLevel: 'medium' })).resolves.toEqual({ ok: true });
    await expect(controller.readModelProviders?.()).resolves.toEqual({ providers: [{ id: 'openrouter', models: [] }] });
    await expect(controller.saveModelProvider?.({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api' })).resolves.toEqual({ providers: [{ id: 'openrouter', models: [] }] });
    await expect(controller.deleteModelProvider?.('openrouter')).resolves.toEqual({ providers: [] });
    await expect(controller.saveModelProviderModel?.({ provider: 'openrouter', modelId: 'model-a' })).resolves.toEqual({ providers: [{ id: 'openrouter', models: [{ id: 'model-a' }] }] });
    await expect(controller.deleteModelProviderModel?.({ provider: 'openrouter', modelId: 'model-a' })).resolves.toEqual({ providers: [{ id: 'openrouter', models: [] }] });
    await expect(controller.readProviderAuth?.()).resolves.toEqual({ providers: [{ id: 'openai', authType: 'api_key' }] });
    await expect(controller.readCodexPlanUsage?.()).resolves.toEqual({ available: true, planType: 'plus' });
    await expect(controller.setProviderApiKey?.({ provider: 'openai', apiKey: 'sk-test' })).resolves.toEqual({ providers: [{ id: 'openai', authType: 'api_key' }] });
    await expect(controller.removeProviderCredential?.('openai')).resolves.toEqual({ providers: [] });
    await expect(controller.startProviderOAuthLogin?.('openrouter')).resolves.toEqual({ id: 'login-1', provider: 'openrouter', status: 'running' });
    await expect(controller.readProviderOAuthLogin?.('login-1')).resolves.toEqual({ id: 'login-1', provider: 'openrouter', status: 'running' });
    await expect(controller.submitProviderOAuthLoginInput?.({ loginId: 'login-1', value: '123456' })).resolves.toEqual({ id: 'login-1', provider: 'openrouter', status: 'running' });
    await expect(controller.cancelProviderOAuthLogin?.('login-1')).resolves.toEqual({ id: 'login-1', provider: 'openrouter', status: 'cancelled' });
    await expect(controller.subscribeProviderOAuthLogin?.('login-1', onState)).resolves.toBe(unsubscribeProviderOAuth);

    expect(readDesktopModels).toHaveBeenCalledTimes(1);
    expect(updateDesktopModelPreferences).toHaveBeenCalledWith({ model: 'gpt-5.4', thinkingLevel: 'medium' });
    expect(readDesktopModelProviders).toHaveBeenCalledTimes(1);
    expect(saveDesktopModelProvider).toHaveBeenCalledWith({ provider: 'openrouter', baseUrl: 'https://openrouter.ai/api' });
    expect(deleteDesktopModelProvider).toHaveBeenCalledWith('openrouter');
    expect(saveDesktopModelProviderModel).toHaveBeenCalledWith({ provider: 'openrouter', modelId: 'model-a' });
    expect(deleteDesktopModelProviderModel).toHaveBeenCalledWith({ provider: 'openrouter', modelId: 'model-a' });
    expect(readDesktopProviderAuth).toHaveBeenCalledTimes(1);
    expect(readDesktopCodexPlanUsage).toHaveBeenCalledTimes(1);
    expect(setDesktopProviderApiKey).toHaveBeenCalledWith({ provider: 'openai', apiKey: 'sk-test' });
    expect(removeDesktopProviderCredential).toHaveBeenCalledWith('openai');
    expect(startDesktopProviderOAuthLogin).toHaveBeenCalledWith('openrouter');
    expect(readDesktopProviderOAuthLogin).toHaveBeenCalledWith('login-1');
    expect(submitDesktopProviderOAuthLoginInput).toHaveBeenCalledWith({ loginId: 'login-1', value: '123456' });
    expect(cancelDesktopProviderOAuthLogin).toHaveBeenCalledWith('login-1');
    expect(subscribeDesktopProviderOAuthLogin).toHaveBeenCalledWith('login-1', onState);
    expect(backend.ensureStarted).not.toHaveBeenCalled();
  });

  it('routes inbox activity and alert capabilities through the local API module without loopback proxying', async () => {
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
      readDesktopActivity: vi.fn().mockResolvedValue([{ id: 'activity-1' }]),
      readDesktopActivityById: vi.fn().mockResolvedValue({ id: 'activity-1' }),
      markDesktopActivityRead: vi.fn().mockResolvedValue({ ok: true }),
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
      resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' },
      resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' }],
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
    const readDesktopSessionDetail = vi.fn().mockResolvedValue({ meta: { id: 'live-1' }, blocks: [], blockOffset: 0, totalBlocks: 0, contextUsage: null });
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
    const summarizeAndForkDesktopLiveSession = vi.fn().mockResolvedValue({ newSessionId: 'summary-1', sessionFile: '/tmp/summary-1.jsonl' });
    const abortDesktopLiveSession = vi.fn().mockResolvedValue({ ok: true });
    const loadLocalApi = vi.fn().mockResolvedValue(createLocalApiModuleMock({
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
    await expect(controller.markDurableRunAttention?.({ runId: 'run-1', read: false })).resolves.toEqual({ ok: true });
    await expect(controller.readConversationBootstrap?.({ conversationId: 'live-1', tailBlocks: 12 })).resolves.toEqual({
      conversationId: 'live-1',
      sessionDetail: null,
      liveSession: { live: true, id: 'live-1' },
    });
    await expect(controller.renameConversation?.({ conversationId: 'live-1', name: 'Renamed conversation', surfaceId: 'surface-1' })).resolves.toEqual({
      ok: true,
      title: 'Renamed conversation',
    });
    await expect(controller.readConversationDeferredResumes?.('conversation-1')).resolves.toEqual({
      conversationId: 'conversation-1',
      resumes: [{ id: 'resume-1', dueAt: '2026-04-24T10:05:00.000Z' }],
    });
    await expect(controller.scheduleConversationDeferredResume?.({ conversationId: 'conversation-1', delay: '10m', prompt: 'Resume later.' })).resolves.toEqual({
      conversationId: 'conversation-1',
      resume: { id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' },
      resumes: [{ id: 'resume-2', dueAt: '2026-04-24T10:10:00.000Z' }],
    });
    await expect(controller.cancelConversationDeferredResume?.({ conversationId: 'conversation-1', resumeId: 'resume-2' })).resolves.toEqual({
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
    expect(markDesktopDurableRunAttention).toHaveBeenCalledWith({ runId: 'run-1', read: false });
    expect(readDesktopConversationBootstrap).toHaveBeenCalledWith({ conversationId: 'live-1', tailBlocks: 12 });
    expect(renameDesktopConversation).toHaveBeenCalledWith({ conversationId: 'live-1', name: 'Renamed conversation', surfaceId: 'surface-1' });
    expect(readDesktopConversationDeferredResumes).toHaveBeenCalledWith('conversation-1');
    expect(scheduleDesktopConversationDeferredResume).toHaveBeenCalledWith({ conversationId: 'conversation-1', delay: '10m', prompt: 'Resume later.' });
    expect(cancelDesktopConversationDeferredResume).toHaveBeenCalledWith({ conversationId: 'conversation-1', resumeId: 'resume-2' });
    expect(fireDesktopConversationDeferredResume).toHaveBeenCalledWith({ conversationId: 'conversation-1', resumeId: 'resume-1' });
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
