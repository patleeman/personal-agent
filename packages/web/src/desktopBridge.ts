import type {
  ActivityEntry,
  AlertEntry,
  AlertSnapshot,
  AppStatus,
  CodexPlanUsageState,
  RemoteAccessAdminState,
  RemoteAccessPairingCodeResult,
  ConversationArtifactRecord,
  ConversationArtifactSummary,
  ConversationAttachmentAssetData,
  ConversationAttachmentRecord,
  ConversationAttachmentSummary,
  ConversationAutomationPreferencesState,
  ConversationAutomationWorkflowPresetLibraryState,
  ConversationAutomationWorkspaceState,
  ConversationTitleSettingsState,
  DefaultCwdState,
  DaemonState,
  ModelProviderState,
  ModelState,
  ProfileState,
  ProviderAuthState,
  ProviderOAuthLoginState,
  VaultRootState,
  WebUiState,
  ConversationBootstrapState,
  ConversationCwdChangeResult,
  ConversationRecoveryResult,
  DesktopConnectionsState,
  DurableRunDetailResult,
  DurableRunListResult,
  DesktopEnvironmentState,
  ScheduledTaskDetail,
  ScheduledTaskSummary,
  DesktopHostRecord,
  DesktopNavigationState,
  DisplayBlock,
  LiveSessionContext,
  LiveSessionCreateResult,
  LiveSessionExportResult,
  LiveSessionForkEntry,
  LiveSessionMeta,
  LiveSessionPresenceState,
  LiveSessionStats,
  DeferredResumeSummary,
  FolderPickerResult,
  PromptAttachmentRefInput,
  PromptImageInput,
  SessionDetailResult,
  SessionMeta,
  VaultFileListResult,
} from './types';

export const DESKTOP_API_STREAM_EVENT = 'personal-agent-desktop-api-stream';
export const DESKTOP_APP_EVENTS_EVENT = 'personal-agent-desktop-app-events';
export const DESKTOP_PROVIDER_OAUTH_EVENT = 'personal-agent-desktop-provider-oauth-login';

export interface PersonalAgentDesktopBridge {
  getEnvironment(): Promise<DesktopEnvironmentState>;
  getConnections(): Promise<DesktopConnectionsState>;
  getNavigationState(): Promise<DesktopNavigationState>;
  switchHost(hostId: string): Promise<void>;
  saveHost(host: DesktopHostRecord): Promise<DesktopConnectionsState>;
  deleteHost(hostId: string): Promise<DesktopConnectionsState>;
  openNewConversation(): Promise<void>;
  readAppStatus(): Promise<AppStatus>;
  readDaemonState(): Promise<DaemonState>;
  readWebUiState(): Promise<WebUiState>;
  updateWebUiConfig(input: { useTailscaleServe?: boolean; resumeFallbackPrompt?: string }): Promise<WebUiState>;
  readRemoteAccessState(): Promise<RemoteAccessAdminState>;
  createRemoteAccessPairingCode(): Promise<RemoteAccessPairingCodeResult>;
  revokeRemoteAccessSession(sessionId: string): Promise<{ ok: boolean; state: RemoteAccessAdminState }>;
  readSessions(): Promise<SessionMeta[]>;
  readSessionMeta(sessionId: string): Promise<SessionMeta>;
  readSessionSearchIndex(sessionIds: string[]): Promise<{ index: Record<string, string> }>;
  readProfiles(): Promise<ProfileState>;
  setCurrentProfile(profile: string): Promise<{ ok: true; currentProfile: string }>;
  readModels(): Promise<ModelState>;
  updateModelPreferences(input: { model?: string | null; thinkingLevel?: string | null }): Promise<{ ok: true }>;
  readDefaultCwd(): Promise<DefaultCwdState>;
  updateDefaultCwd(cwd: string | null): Promise<DefaultCwdState>;
  readVaultRoot(): Promise<VaultRootState>;
  readVaultFiles(): Promise<VaultFileListResult>;
  updateVaultRoot(root: string | null): Promise<VaultRootState>;
  pickFolder(input?: { cwd?: string | null }): Promise<FolderPickerResult>;
  runShellCommand(input: { command: string; cwd?: string | null }): Promise<{ output: string; exitCode: number; cwd: string }>;
  readConversationTitleSettings(): Promise<ConversationTitleSettingsState>;
  updateConversationTitleSettings(input: { enabled?: boolean; model?: string | null }): Promise<ConversationTitleSettingsState>;
  readConversationPlanDefaults(): Promise<ConversationAutomationPreferencesState>;
  updateConversationPlanDefaults(input: { defaultEnabled?: boolean }): Promise<ConversationAutomationPreferencesState>;
  readConversationPlanLibrary(): Promise<ConversationAutomationWorkflowPresetLibraryState>;
  updateConversationPlanLibrary(input: ConversationAutomationWorkflowPresetLibraryState): Promise<ConversationAutomationWorkflowPresetLibraryState>;
  readConversationPlansWorkspace(): Promise<ConversationAutomationWorkspaceState>;
  readOpenConversationTabs(): Promise<{ sessionIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[] }>;
  updateOpenConversationTabs(input: { sessionIds?: string[]; pinnedSessionIds?: string[]; archivedSessionIds?: string[] }): Promise<{
    ok: true;
    sessionIds: string[];
    pinnedSessionIds: string[];
    archivedSessionIds: string[];
  }>;
  readModelProviders(): Promise<ModelProviderState>;
  saveModelProvider(input: {
    provider: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    authHeader?: boolean;
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
    modelOverrides?: Record<string, unknown>;
  }): Promise<ModelProviderState>;
  deleteModelProvider(provider: string): Promise<ModelProviderState>;
  saveModelProviderModel(input: {
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
  }): Promise<ModelProviderState>;
  deleteModelProviderModel(input: { provider: string; modelId: string }): Promise<ModelProviderState>;
  readProviderAuth(): Promise<ProviderAuthState>;
  readCodexPlanUsage(): Promise<CodexPlanUsageState>;
  setProviderApiKey(input: { provider: string; apiKey: string }): Promise<ProviderAuthState>;
  removeProviderCredential(provider: string): Promise<ProviderAuthState>;
  startProviderOAuthLogin(provider: string): Promise<ProviderOAuthLoginState>;
  readProviderOAuthLogin(loginId: string): Promise<ProviderOAuthLoginState | null>;
  submitProviderOAuthLoginInput(input: { loginId: string; value: string }): Promise<ProviderOAuthLoginState>;
  cancelProviderOAuthLogin(loginId: string): Promise<ProviderOAuthLoginState>;
  subscribeProviderOAuthLogin(loginId: string): Promise<{ subscriptionId: string }>;
  unsubscribeProviderOAuthLogin(subscriptionId: string): Promise<void>;
  readActivity(): Promise<ActivityEntry[]>;
  readActivityById(activityId: string): Promise<ActivityEntry>;
  markActivityRead(input: { activityId: string; read?: boolean }): Promise<{ ok: true }>;
  clearInbox(): Promise<{ ok: true; deletedActivityIds: string[]; clearedConversationIds: string[] }>;
  startActivityConversation(activityId: string): Promise<{ activityId: string; id: string; sessionFile: string; cwd: string; relatedConversationIds: string[] }>;
  markConversationAttention(input: { conversationId: string; read?: boolean }): Promise<{ ok: true }>;
  readAlerts(): Promise<AlertSnapshot>;
  acknowledgeAlert(alertId: string): Promise<{ ok: true; alert: AlertEntry }>;
  dismissAlert(alertId: string): Promise<{ ok: true; alert: AlertEntry }>;
  snoozeAlert(input: { alertId: string; delay?: string; at?: string }): Promise<{ ok: true; alert: AlertEntry; resume: DeferredResumeSummary }>;
  readScheduledTasks(): Promise<ScheduledTaskSummary[]>;
  readScheduledTaskDetail(taskId: string): Promise<ScheduledTaskDetail>;
  readScheduledTaskLog(taskId: string): Promise<{ path: string; log: string }>;
  createScheduledTask(input: {
    title?: string;
    enabled?: boolean;
    cron?: string | null;
    at?: string | null;
    model?: string | null;
    thinkingLevel?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    prompt?: string;
  }): Promise<{ ok: true; task: ScheduledTaskDetail }>;
  updateScheduledTask(input: {
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
  }): Promise<{ ok: true; task: ScheduledTaskDetail }>;
  runScheduledTask(taskId: string): Promise<{ ok: true; accepted: boolean; runId: string; reason?: string }>;
  readDurableRuns(): Promise<DurableRunListResult>;
  readDurableRun(runId: string): Promise<DurableRunDetailResult>;
  readDurableRunLog(input: { runId: string; tail?: number }): Promise<{ path: string; log: string }>;
  cancelDurableRun(runId: string): Promise<{ cancelled: boolean; runId: string; reason?: string }>;
  markDurableRunAttention(input: { runId: string; read?: boolean }): Promise<{ ok: true }>;
  readConversationBootstrap(input: {
    conversationId: string;
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }): Promise<ConversationBootstrapState>;
  renameConversation(input: { conversationId: string; name: string; surfaceId?: string }): Promise<{ ok: true; title: string }>;
  changeConversationCwd(input: { conversationId: string; cwd: string; surfaceId?: string }): Promise<ConversationCwdChangeResult>;
  readConversationDeferredResumes(conversationId: string): Promise<{ conversationId: string; resumes: DeferredResumeSummary[] }>;
  scheduleConversationDeferredResume(input: { conversationId: string; delay: string; prompt?: string }): Promise<{
    conversationId: string;
    resume: DeferredResumeSummary;
    resumes: DeferredResumeSummary[];
  }>;
  cancelConversationDeferredResume(input: { conversationId: string; resumeId: string }): Promise<{
    conversationId: string;
    cancelledId: string;
    resumes: DeferredResumeSummary[];
  }>;
  fireConversationDeferredResume(input: { conversationId: string; resumeId: string }): Promise<{
    conversationId: string;
    resume: DeferredResumeSummary;
    resumes: DeferredResumeSummary[];
  }>;
  recoverConversation(conversationId: string): Promise<ConversationRecoveryResult>;
  readConversationModelPreferences(input: { conversationId: string }): Promise<{ currentModel: string; currentThinkingLevel: string }>;
  updateConversationModelPreferences(input: { conversationId: string; model?: string | null; thinkingLevel?: string | null; surfaceId?: string }): Promise<{ currentModel: string; currentThinkingLevel: string }>;
  readConversationArtifacts(conversationId: string): Promise<{ conversationId: string; artifacts: ConversationArtifactSummary[] }>;
  readConversationArtifact(input: { conversationId: string; artifactId: string }): Promise<{ conversationId: string; artifact: ConversationArtifactRecord }>;
  deleteConversationArtifact(input: { conversationId: string; artifactId: string }): Promise<{ conversationId: string; deleted: boolean; artifactId: string; artifacts: ConversationArtifactSummary[] }>;
  readConversationAttachments(conversationId: string): Promise<{ conversationId: string; attachments: ConversationAttachmentSummary[] }>;
  readConversationAttachment(input: { conversationId: string; attachmentId: string }): Promise<{ conversationId: string; attachment: ConversationAttachmentRecord }>;
  createConversationAttachment(input: {
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
  }): Promise<{ conversationId: string; attachment: ConversationAttachmentRecord; attachments: ConversationAttachmentSummary[] }>;
  updateConversationAttachment(input: {
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
  }): Promise<{ conversationId: string; attachment: ConversationAttachmentRecord; attachments: ConversationAttachmentSummary[] }>;
  deleteConversationAttachment(input: { conversationId: string; attachmentId: string }): Promise<{ conversationId: string; deleted: boolean; attachmentId: string; attachments: ConversationAttachmentSummary[] }>;
  readConversationAttachmentAsset(input: { conversationId: string; attachmentId: string; asset: 'source' | 'preview'; revision?: number }): Promise<ConversationAttachmentAssetData>;
  readLiveSessions(): Promise<LiveSessionMeta[]>;
  readLiveSession(conversationId: string): Promise<LiveSessionMeta & { live: boolean }>;
  readLiveSessionStats(conversationId: string): Promise<LiveSessionStats>;
  readLiveSessionForkEntries(conversationId: string): Promise<LiveSessionForkEntry[]>;
  readLiveSessionContext(conversationId: string): Promise<LiveSessionContext>;
  readSessionDetail(input: {
    sessionId: string;
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }): Promise<SessionDetailResult>;
  readSessionBlock(input: { sessionId: string; blockId: string }): Promise<DisplayBlock>;
  createLiveSession(input: { cwd?: string; model?: string | null; thinkingLevel?: string | null }): Promise<LiveSessionCreateResult>;
  resumeLiveSession(sessionFile: string): Promise<{ id: string }>;
  takeOverLiveSession(input: { conversationId: string; surfaceId: string }): Promise<LiveSessionPresenceState>;
  restoreQueuedLiveSessionMessage(input: {
    conversationId: string;
    behavior: 'steer' | 'followUp';
    index: number;
    previewId?: string;
  }): Promise<{ ok: true; text: string; images: Array<{ type: 'image'; data: string; mimeType: string; name?: string }> }>;
  compactLiveSession(input: { conversationId: string; customInstructions?: string }): Promise<{ ok: true; result: unknown }>;
  exportLiveSession(input: { conversationId: string; outputPath?: string }): Promise<LiveSessionExportResult>;
  reloadLiveSession(conversationId: string): Promise<{ ok: true }>;
  destroyLiveSession(conversationId: string): Promise<{ ok: true }>;
  branchLiveSession(input: { conversationId: string; entryId: string }): Promise<{ newSessionId: string; sessionFile: string }>;
  forkLiveSession(input: { conversationId: string; entryId: string; preserveSource?: boolean }): Promise<{ newSessionId: string; sessionFile: string }>;
  summarizeAndForkLiveSession(conversationId: string): Promise<{ newSessionId: string; sessionFile: string }>;
  submitLiveSessionPrompt(input: {
    conversationId: string;
    text?: string;
    behavior?: 'steer' | 'followUp';
    images?: PromptImageInput[];
    attachmentRefs?: PromptAttachmentRefInput[];
    surfaceId?: string;
  }): Promise<{
    ok: true;
    accepted: true;
    delivery: 'started' | 'queued';
    referencedTaskIds: string[];
    referencedMemoryDocIds: string[];
    referencedVaultFileIds: string[];
    referencedAttachmentIds: string[];
  }>;
  abortLiveSession(conversationId: string): Promise<{ ok: true }>;
  subscribeApiStream(path: string): Promise<{ subscriptionId: string }>;
  unsubscribeApiStream(subscriptionId: string): Promise<void>;
  subscribeAppEvents(): Promise<{ subscriptionId: string }>;
  unsubscribeAppEvents(subscriptionId: string): Promise<void>;
  openHostWindow(hostId: string): Promise<void>;
  showConnectionsWindow(): Promise<void>;
  goBack(): Promise<DesktopNavigationState>;
  goForward(): Promise<DesktopNavigationState>;
}

export function getDesktopBridge(): PersonalAgentDesktopBridge | null {
  if (typeof window === 'undefined') {
    return null;
  }

  return window.personalAgentDesktop ?? null;
}

export function isDesktopShell(): boolean {
  if (getDesktopBridge() !== null) {
    return true;
  }

  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('desktop-shell') === '1') {
      return true;
    }

    try {
      if (window.sessionStorage.getItem('__pa_desktop_shell__') === '1') {
        return true;
      }
    } catch {
      // Ignore storage failures.
    }
  }

  if (typeof document !== 'undefined' && document.documentElement.dataset.personalAgentDesktop === '1') {
    return true;
  }

  if (typeof navigator === 'undefined') {
    return false;
  }

  return /Electron/i.test(navigator.userAgent);
}

export function isLocalDesktopHostShell(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.location.protocol === 'personal-agent:';
}

export async function readDesktopEnvironment(): Promise<DesktopEnvironmentState | null> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    return null;
  }

  return bridge.getEnvironment();
}

export async function readDesktopConnections(): Promise<DesktopConnectionsState | null> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    return null;
  }

  return bridge.getConnections();
}
