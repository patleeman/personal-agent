import { contextBridge, ipcRenderer } from 'electron';

const CHANNEL_PREFIX = 'personal-agent-desktop';
const SHORTCUT_CHANNEL = `${CHANNEL_PREFIX}:shortcut`;
const SHORTCUT_EVENT = 'personal-agent-desktop-shortcut';
const NAVIGATE_CHANNEL = `${CHANNEL_PREFIX}:navigate`;
const NAVIGATE_EVENT = 'personal-agent-desktop-navigate';
const API_STREAM_CHANNEL = `${CHANNEL_PREFIX}:api-stream`;
const API_STREAM_EVENT = 'personal-agent-desktop-api-stream';
const CONVERSATION_STATE_CHANNEL = `${CHANNEL_PREFIX}:conversation-state`;
const CONVERSATION_STATE_EVENT = 'personal-agent-desktop-conversation-state';
const APP_EVENTS_CHANNEL = `${CHANNEL_PREFIX}:app-events`;
const APP_EVENTS_EVENT = 'personal-agent-desktop-app-events';
const PROVIDER_OAUTH_CHANNEL = `${CHANNEL_PREFIX}:provider-oauth-login`;
const PROVIDER_OAUTH_EVENT = 'personal-agent-desktop-provider-oauth-login';

const domGlobals = globalThis as typeof globalThis & {
  document?: {
    documentElement?: {
      dataset: Record<string, string>;
    };
    body?: {
      setAttribute(name: string, value: string): void;
    };
  };
  dispatchEvent?: (event: { type: string }) => boolean;
  CustomEvent?: new <T>(type: string, init?: { detail?: T }) => { type: string; detail?: T };
};

const desktopBridge = {
  getEnvironment: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:get-environment`),
  getConnections: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:get-connections`),
  getNavigationState: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:get-navigation-state`),
  switchHost: (hostId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:switch-host`, hostId),
  saveHost: (host: unknown) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:save-host`, host),
  deleteHost: (hostId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:delete-host`, hostId),
  readHostAuthState: (hostId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-host-auth-state`, hostId),
  pairHost: (input: { hostId: string; code: string; deviceLabel?: string }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:pair-host`, input),
  clearHostAuth: (hostId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:clear-host-auth`, hostId),
  openNewConversation: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:open-new-conversation`),
  showConversationContextMenu: (input: {
    x: number;
    y: number;
    pinAction?: 'pin' | 'unpin' | null;
    canArchive?: boolean;
    canDuplicate?: boolean;
    canSummarizeAndNew?: boolean;
    canCopyWorkingDirectory?: boolean;
    canCopyId?: boolean;
    canCopyDeeplink?: boolean;
    busyAction?: 'duplicate' | 'summarize' | null;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:show-conversation-context-menu`, input),
  showConversationCwdGroupContextMenu: (input: {
    x: number;
    y: number;
    canOpenInFinder?: boolean;
    canEditName?: boolean;
    canArchiveThreads?: boolean;
    canRemove?: boolean;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:show-conversation-cwd-group-context-menu`, input),
  showSelectionContextMenu: (input: {
    x: number;
    y: number;
    canReply?: boolean;
    canCopy?: boolean;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:show-selection-context-menu`, input),
  openPath: (targetPath: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:open-path`, targetPath),
  readAppStatus: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-app-status`),
  readDaemonState: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-daemon-state`),
  readWebUiState: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-web-ui-state`),
  updateWebUiConfig: (input: { useTailscaleServe?: boolean; resumeFallbackPrompt?: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:update-web-ui-config`, input),
  readRemoteAccessState: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-remote-access-state`),
  createRemoteAccessPairingCode: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:create-remote-access-pairing-code`),
  revokeRemoteAccessSession: (sessionId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:revoke-remote-access-session`, sessionId),
  readSessions: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-sessions`),
  readSessionMeta: (sessionId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-session-meta`, sessionId),
  readSessionSearchIndex: (sessionIds: string[]) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-session-search-index`, sessionIds),
  readProfiles: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-profiles`),
  setCurrentProfile: (profile: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:set-current-profile`, profile),
  readModels: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-models`),
  updateModelPreferences: (input: { model?: string | null; thinkingLevel?: string | null }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:update-model-preferences`, input),
  readDefaultCwd: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-default-cwd`),
  updateDefaultCwd: (cwd: string | null) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:update-default-cwd`, cwd),
  readVaultRoot: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-vault-root`),
  readVaultFiles: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-vault-files`),
  updateVaultRoot: (root: string | null) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:update-vault-root`, root),
  pickFolder: (input?: { cwd?: string | null; prompt?: string | null }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:pick-folder`, input),
  readConversationTitleSettings: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-conversation-title-settings`),
  updateConversationTitleSettings: (input: { enabled?: boolean; model?: string | null }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:update-conversation-title-settings`, input),
  readConversationPlansWorkspace: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-conversation-plans-workspace`),
  readOpenConversationTabs: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-open-conversation-tabs`),
  updateOpenConversationTabs: (input: { sessionIds?: string[]; pinnedSessionIds?: string[]; archivedSessionIds?: string[]; workspacePaths?: string[] }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:update-open-conversation-tabs`, input),
  readModelProviders: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-model-providers`),
  saveModelProvider: (input: {
    provider: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    authHeader?: boolean;
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
    modelOverrides?: Record<string, unknown>;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:save-model-provider`, input),
  deleteModelProvider: (provider: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:delete-model-provider`, provider),
  saveModelProviderModel: (input: {
    provider: string;
    modelId: string;
    name?: string;
    api?: string;
    baseUrl?: string;
    reasoning?: boolean;
    input?: Array<'text' | 'image'>;
    contextWindow?: number;
    maxTokens?: number;
    headers?: Record<string, string>;
    cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
    compat?: Record<string, unknown>;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:save-model-provider-model`, input),
  deleteModelProviderModel: (input: { provider: string; modelId: string }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:delete-model-provider-model`, input),
  readProviderAuth: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-provider-auth`),
  setProviderApiKey: (input: { provider: string; apiKey: string }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:set-provider-api-key`, input),
  removeProviderCredential: (provider: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:remove-provider-credential`, provider),
  startProviderOAuthLogin: (provider: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:start-provider-oauth-login`, provider),
  readProviderOAuthLogin: (loginId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-provider-oauth-login`, loginId),
  submitProviderOAuthLoginInput: (input: { loginId: string; value: string }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:submit-provider-oauth-login-input`, input),
  cancelProviderOAuthLogin: (loginId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:cancel-provider-oauth-login`, loginId),
  subscribeProviderOAuthLogin: (loginId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:subscribe-provider-oauth-login`, loginId),
  unsubscribeProviderOAuthLogin: (subscriptionId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:unsubscribe-provider-oauth-login`, subscriptionId),
  markConversationAttention: (input: { conversationId: string; read?: boolean }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:mark-conversation-attention`, input),
  readScheduledTasks: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-scheduled-tasks`),
  readScheduledTaskDetail: (taskId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-scheduled-task-detail`, taskId),
  readScheduledTaskLog: (taskId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-scheduled-task-log`, taskId),
  createScheduledTask: (input: {
    title?: string;
    enabled?: boolean;
    cron?: string | null;
    at?: string | null;
    model?: string | null;
    thinkingLevel?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    prompt?: string;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:create-scheduled-task`, input),
  updateScheduledTask: (input: {
    taskId: string;
    title?: string;
    enabled?: boolean;
    cron?: string | null;
    at?: string | null;
    model?: string | null;
    thinkingLevel?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    prompt?: string;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:update-scheduled-task`, input),
  runScheduledTask: (taskId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:run-scheduled-task`, taskId),
  readDurableRuns: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-durable-runs`),
  readDurableRun: (runId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-durable-run`, runId),
  readDurableRunLog: (input: { runId: string; tail?: number }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-durable-run-log`, input),
  cancelDurableRun: (runId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:cancel-durable-run`, runId),
  markDurableRunAttention: (input: { runId: string; read?: boolean }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:mark-durable-run-attention`, input),
  readConversationBootstrap: (input: {
    conversationId: string;
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-conversation-bootstrap`, input),
  renameConversation: (input: { conversationId: string; name: string; surfaceId?: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:rename-conversation`, input),
  changeConversationCwd: (input: { conversationId: string; cwd: string; surfaceId?: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:change-conversation-cwd`, input),
  readConversationDeferredResumes: (conversationId: string) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-conversation-deferred-resumes`, conversationId),
  scheduleConversationDeferredResume: (input: { conversationId: string; delay: string; prompt?: string; behavior?: 'steer' | 'followUp' }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:schedule-conversation-deferred-resume`, input),
  cancelConversationDeferredResume: (input: { conversationId: string; resumeId: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:cancel-conversation-deferred-resume`, input),
  fireConversationDeferredResume: (input: { conversationId: string; resumeId: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:fire-conversation-deferred-resume`, input),
  recoverConversation: (conversationId: string) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:recover-conversation`, conversationId),
  readConversationModelPreferences: (input: { conversationId: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-conversation-model-preferences`, input),
  updateConversationModelPreferences: (input: { conversationId: string; model?: string | null; thinkingLevel?: string | null; surfaceId?: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:update-conversation-model-preferences`, input),
  readConversationArtifacts: (conversationId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-conversation-artifacts`, conversationId),
  readConversationArtifact: (input: { conversationId: string; artifactId: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-conversation-artifact`, input),
  readConversationAttachments: (conversationId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-conversation-attachments`, conversationId),
  readConversationAttachment: (input: { conversationId: string; attachmentId: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-conversation-attachment`, input),
  createConversationAttachment: (input: {
    conversationId: string;
    kind?: 'excalidraw';
    title?: string;
    sourceData?: string;
    sourceName?: string;
    sourceMimeType?: string;
    previewData?: string;
    previewName?: string;
    previewMimeType?: string;
    note?: string;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:create-conversation-attachment`, input),
  updateConversationAttachment: (input: {
    conversationId: string;
    attachmentId: string;
    title?: string;
    sourceData?: string;
    sourceName?: string;
    sourceMimeType?: string;
    previewData?: string;
    previewName?: string;
    previewMimeType?: string;
    note?: string;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:update-conversation-attachment`, input),
  readConversationAttachmentAsset: (input: { conversationId: string; attachmentId: string; asset: 'source' | 'preview'; revision?: number }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-conversation-attachment-asset`, input),
  readLiveSession: (conversationId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-live-session`, conversationId),
  readLiveSessionForkEntries: (conversationId: string) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-live-session-fork-entries`, conversationId),
  readLiveSessionContext: (conversationId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-live-session-context`, conversationId),
  readSessionDetail: (input: {
    sessionId: string;
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-session-detail`, input),
  readSessionBlock: (input: { sessionId: string; blockId: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:read-session-block`, input),
  createLiveSession: (input: { cwd?: string; model?: string | null; thinkingLevel?: string | null }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:create-live-session`, input),
  resumeLiveSession: (sessionFile: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:resume-live-session`, sessionFile),
  takeOverLiveSession: (input: { conversationId: string; surfaceId: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:take-over-live-session`, input),
  restoreQueuedLiveSessionMessage: (input: {
    conversationId: string;
    behavior: 'steer' | 'followUp';
    index: number;
    previewId?: string;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:restore-queued-live-session-message`, input),
  compactLiveSession: (input: { conversationId: string; customInstructions?: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:compact-live-session`, input),
  exportLiveSession: (input: { conversationId: string; outputPath?: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:export-live-session`, input),
  reloadLiveSession: (conversationId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:reload-live-session`, conversationId),
  destroyLiveSession: (conversationId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:destroy-live-session`, conversationId),
  branchLiveSession: (input: { conversationId: string; entryId: string }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:branch-live-session`, input),
  forkLiveSession: (input: { conversationId: string; entryId: string; preserveSource?: boolean }) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:fork-live-session`, input),
  summarizeAndForkLiveSession: (conversationId: string) =>
    ipcRenderer.invoke(`${CHANNEL_PREFIX}:summarize-and-fork-live-session`, conversationId),
  submitLiveSessionPrompt: (input: {
    conversationId: string;
    text?: string;
    behavior?: 'steer' | 'followUp';
    images?: Array<{ data: string; mimeType: string; name?: string }>;
    attachmentRefs?: Array<{ attachmentId: string; revision?: number }>;
    surfaceId?: string;
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:submit-live-session-prompt`, input),
  abortLiveSession: (conversationId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:abort-live-session`, conversationId),
  subscribeConversationState: (input: {
    conversationId: string;
    tailBlocks?: number;
    surfaceId?: string;
    surfaceType?: 'desktop_web' | 'mobile_web';
  }) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:subscribe-conversation-state`, input),
  unsubscribeConversationState: (subscriptionId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:unsubscribe-conversation-state`, subscriptionId),
  subscribeApiStream: (path: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:subscribe-api-stream`, path),
  unsubscribeApiStream: (subscriptionId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:unsubscribe-api-stream`, subscriptionId),
  subscribeAppEvents: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:subscribe-app-events`),
  unsubscribeAppEvents: (subscriptionId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:unsubscribe-app-events`, subscriptionId),
  openHostWindow: (hostId: string) => ipcRenderer.invoke(`${CHANNEL_PREFIX}:open-host-window`, hostId),
  showConnectionsWindow: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:show-connections`),
  goBack: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:go-back`),
  goForward: () => ipcRenderer.invoke(`${CHANNEL_PREFIX}:go-forward`),
};

if (domGlobals.document?.documentElement) {
  domGlobals.document.documentElement.dataset.personalAgentDesktop = '1';
}

if (domGlobals.document?.body) {
  domGlobals.document.body.setAttribute('data-personal-agent-desktop', '1');
}

function dispatchDesktopEvent<T>(type: string, detail: T): void {
  if (!domGlobals.dispatchEvent || typeof domGlobals.CustomEvent !== 'function') {
    return;
  }

  domGlobals.dispatchEvent(new domGlobals.CustomEvent(type, { detail }));
}

ipcRenderer.on(SHORTCUT_CHANNEL, (_event, action: unknown) => {
  dispatchDesktopEvent(SHORTCUT_EVENT, { action });
});

ipcRenderer.on(NAVIGATE_CHANNEL, (_event, payload: unknown) => {
  dispatchDesktopEvent(NAVIGATE_EVENT, payload);
});

ipcRenderer.on(API_STREAM_CHANNEL, (_event, payload: unknown) => {
  dispatchDesktopEvent(API_STREAM_EVENT, payload);
});

ipcRenderer.on(CONVERSATION_STATE_CHANNEL, (_event, payload: unknown) => {
  dispatchDesktopEvent(CONVERSATION_STATE_EVENT, payload);
});

ipcRenderer.on(APP_EVENTS_CHANNEL, (_event, payload: unknown) => {
  dispatchDesktopEvent(APP_EVENTS_EVENT, payload);
});

ipcRenderer.on(PROVIDER_OAUTH_CHANNEL, (_event, payload: unknown) => {
  dispatchDesktopEvent(PROVIDER_OAUTH_EVENT, payload);
});

contextBridge.exposeInMainWorld('personalAgentDesktop', desktopBridge);
