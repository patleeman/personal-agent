import type {
  AppStatus,
  ConversationArtifactRecord,
  ConversationArtifactSummary,
  ConversationCommitCheckpointRecord,
  ConversationCommitCheckpointSummary,
  ConversationAttachmentAssetData,
  ConversationAttachmentRecord,
  ConversationAttachmentSummary,
  ConversationAutomationWorkspaceState,
  ConversationTitleSettingsState,
  DefaultCwdState,
  DaemonState,
  ModelProviderState,
  ModelState,
  ProviderAuthState,
  ProviderOAuthLoginState,
  ConversationBootstrapState,
  ConversationCwdChangeResult,
  ConversationRecoveryResult,
  DesktopConnectionsState,
  DesktopAppPreferencesState,
  DurableRunDetailResult,
  DurableRunListResult,
  DesktopEnvironmentState,
  ScheduledTaskDetail,
  ScheduledTaskSummary,
  DesktopHostRecord,
  DesktopNavigationState,
  DesktopRemoteDirectoryListing,
  DesktopRemoteOperationBridgeEvent,
  DesktopSshConnectionTestResult,
  DisplayBlock,
  LiveSessionContext,
  LiveSessionCreateResult,
  LiveSessionExportResult,
  LiveSessionForkEntry,
  LiveSessionMeta,
  LiveSessionPresenceState,
  DeferredResumeSummary,
  FolderPickerResult,
  MemoryData,
  InjectedPromptMessage,
  PromptAttachmentRefInput,
  PromptImageInput,
  SessionDetailResult,
  SessionMeta,
  ToolsState,
  TranscriptionResult,
  VaultFileListResult,
} from '../shared/types';

export const DESKTOP_API_STREAM_EVENT = 'personal-agent-desktop-api-stream';
export const DESKTOP_CONVERSATION_STATE_EVENT = 'personal-agent-desktop-conversation-state';
export const DESKTOP_APP_EVENTS_EVENT = 'personal-agent-desktop-app-events';
export const DESKTOP_REMOTE_OPERATION_EVENT = 'personal-agent-desktop-remote-operation';
export const DESKTOP_PROVIDER_OAUTH_EVENT = 'personal-agent-desktop-provider-oauth-login';

export type DesktopConversationContextMenuAction =
  | 'pin'
  | 'unpin'
  | 'archive'
  | 'duplicate'
  | 'summarize-and-new'
  | 'copy-working-directory'
  | 'copy-id'
  | 'copy-deeplink';

export type DesktopConversationCwdGroupContextMenuAction =
  | 'open-in-finder'
  | 'edit-name'
  | 'archive-threads'
  | 'remove';

export type DesktopKnowledgeEntryContextMenuAction = 'open-in-finder' | 'rename' | 'move' | 'delete';

type DesktopSelectionContextMenuAction = 'reply' | 'copy';

interface DesktopConversationContextMenuRequest {
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
}

interface DesktopConversationCwdGroupContextMenuRequest {
  x: number;
  y: number;
  canOpenInFinder?: boolean;
  canEditName?: boolean;
  canArchiveThreads?: boolean;
  canRemove?: boolean;
}

interface DesktopKnowledgeEntryContextMenuRequest {
  x: number;
  y: number;
  canOpenInFinder?: boolean;
  canRename?: boolean;
  canMove?: boolean;
  canDelete?: boolean;
}

export interface DesktopScreenshotCaptureResult {
  cancelled: boolean;
  image?: {
    name?: string;
    mimeType: string;
    data: string;
  };
}

export interface PersonalAgentDesktopBridge {
  getEnvironment(): Promise<DesktopEnvironmentState>;
  getConnections(): Promise<DesktopConnectionsState>;
  getNavigationState(): Promise<DesktopNavigationState>;
  continueConversationInHost(input: { conversationId: string; hostId: string; cwd?: string | null }): Promise<{
    conversationId: string;
    remoteHostId?: string;
    remoteHostLabel?: string;
    remoteConversationId?: string;
  }>;
  saveHost(host: DesktopHostRecord): Promise<DesktopConnectionsState>;
  deleteHost(hostId: string): Promise<DesktopConnectionsState>;
  readRemoteDirectory(input: { hostId: string; path?: string | null }): Promise<DesktopRemoteDirectoryListing>;
  testSshConnection(input: { sshTarget: string }): Promise<DesktopSshConnectionTestResult>;
  openNewConversation(): Promise<void>;
  showConversationContextMenu(input: DesktopConversationContextMenuRequest): Promise<{ action: DesktopConversationContextMenuAction | null }>;
  showConversationCwdGroupContextMenu(input: DesktopConversationCwdGroupContextMenuRequest): Promise<{ action: DesktopConversationCwdGroupContextMenuAction | null }>;
  showKnowledgeEntryContextMenu(input: DesktopKnowledgeEntryContextMenuRequest): Promise<{ action: DesktopKnowledgeEntryContextMenuAction | null }>;
  showSelectionContextMenu(input: { x: number; y: number; canReply?: boolean; canCopy?: boolean }): Promise<{ action: DesktopSelectionContextMenuAction | null }>;
  openPath(targetPath: string): Promise<{ path: string; opened: boolean; error?: string }>;
  readDesktopAppPreferences(): Promise<DesktopAppPreferencesState>;
  updateDesktopAppPreferences(input: { autoInstallUpdates?: boolean; startOnSystemStart?: boolean }): Promise<DesktopAppPreferencesState>;
  ensureCompanionNetworkReachable(): Promise<{ changed: boolean; url: string | null }>;
  readAppStatus(): Promise<AppStatus>;
  readDaemonState(): Promise<DaemonState>;
  readSessions(): Promise<SessionMeta[]>;
  readSessionMeta(sessionId: string): Promise<SessionMeta>;
  readSessionSearchIndex(sessionIds: string[]): Promise<{ index: Record<string, string> }>;
  readModels(): Promise<ModelState>;
  transcribeFile(input: { dataBase64: string; mimeType?: string; fileName?: string; language?: string; model?: string }): Promise<TranscriptionResult>;
  updateModelPreferences(input: { model?: string | null; thinkingLevel?: string | null; serviceTier?: string | null }): Promise<{ ok: true }>;
  readDefaultCwd(): Promise<DefaultCwdState>;
  updateDefaultCwd(cwd: string | null): Promise<DefaultCwdState>;
  readVaultFiles(): Promise<VaultFileListResult>;
  readMemory?(options?: { profile?: string }): Promise<MemoryData>;
  readTools?(options?: { profile?: string }): Promise<ToolsState>;
  pickFolder(input?: { cwd?: string | null; prompt?: string | null }): Promise<FolderPickerResult>;
  captureScreenshot(): Promise<DesktopScreenshotCaptureResult>;
  readConversationTitleSettings(): Promise<ConversationTitleSettingsState>;
  updateConversationTitleSettings(input: { enabled?: boolean; model?: string | null }): Promise<ConversationTitleSettingsState>;
  readConversationPlansWorkspace(): Promise<ConversationAutomationWorkspaceState>;
  readOpenConversationTabs(): Promise<{
    sessionIds: string[];
    pinnedSessionIds: string[];
    archivedSessionIds: string[];
    workspacePaths: string[];
  }>;
  updateOpenConversationTabs(input: {
    sessionIds?: string[];
    pinnedSessionIds?: string[];
    archivedSessionIds?: string[];
    workspacePaths?: string[];
  }): Promise<{
    ok: true;
    sessionIds: string[];
    pinnedSessionIds: string[];
    archivedSessionIds: string[];
    workspacePaths: string[];
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
  setProviderApiKey(input: { provider: string; apiKey: string }): Promise<ProviderAuthState>;
  removeProviderCredential(provider: string): Promise<ProviderAuthState>;
  startProviderOAuthLogin(provider: string): Promise<ProviderOAuthLoginState>;
  readProviderOAuthLogin(loginId: string): Promise<ProviderOAuthLoginState | null>;
  submitProviderOAuthLoginInput(input: { loginId: string; value: string }): Promise<ProviderOAuthLoginState>;
  cancelProviderOAuthLogin(loginId: string): Promise<ProviderOAuthLoginState>;
  subscribeProviderOAuthLogin(loginId: string): Promise<{ subscriptionId: string }>;
  unsubscribeProviderOAuthLogin(subscriptionId: string): Promise<void>;
  markConversationAttention(input: { conversationId: string; read?: boolean }): Promise<{ ok: true }>;
  readScheduledTasks(): Promise<ScheduledTaskSummary[]>;
  readScheduledTaskDetail(taskId: string): Promise<ScheduledTaskDetail>;
  readScheduledTaskLog(taskId: string): Promise<{ path: string; log: string }>;
  deleteScheduledTask(taskId: string): Promise<{ ok: true; deleted: boolean }>;
  createScheduledTask(input: {
    title?: string;
    enabled?: boolean;
    cron?: string | null;
    at?: string | null;
    model?: string | null;
    thinkingLevel?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    catchUpWindowSeconds?: number | null;
    prompt?: string;
    targetType?: 'background-agent' | 'conversation' | null;
    threadMode?: 'dedicated' | 'existing' | 'none' | null;
    threadConversationId?: string | null;
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
    catchUpWindowSeconds?: number | null;
    prompt?: string;
    targetType?: 'background-agent' | 'conversation' | null;
    threadMode?: 'dedicated' | 'existing' | 'none' | null;
    threadConversationId?: string | null;
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
  scheduleConversationDeferredResume(input: { conversationId: string; delay: string; prompt?: string; behavior?: 'steer' | 'followUp' }): Promise<{
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
  readConversationModelPreferences(input: { conversationId: string }): Promise<{ currentModel: string; currentThinkingLevel: string; currentServiceTier: string; hasExplicitServiceTier: boolean }>;
  updateConversationModelPreferences(input: { conversationId: string; model?: string | null; thinkingLevel?: string | null; serviceTier?: string | null; surfaceId?: string }): Promise<{ currentModel: string; currentThinkingLevel: string; currentServiceTier: string; hasExplicitServiceTier: boolean }>;
  readConversationArtifacts(conversationId: string): Promise<{ conversationId: string; artifacts: ConversationArtifactSummary[] }>;
  readConversationArtifact(input: { conversationId: string; artifactId: string }): Promise<{ conversationId: string; artifact: ConversationArtifactRecord }>;
  readConversationCheckpoints(conversationId: string): Promise<{ conversationId: string; checkpoints: ConversationCommitCheckpointSummary[] }>;
  readConversationCheckpoint(input: { conversationId: string; checkpointId: string }): Promise<{ conversationId: string; checkpoint: ConversationCommitCheckpointRecord }>;
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
  readConversationAttachmentAsset(input: { conversationId: string; attachmentId: string; asset: 'source' | 'preview'; revision?: number }): Promise<ConversationAttachmentAssetData>;
  readLiveSession(conversationId: string): Promise<LiveSessionMeta & { live: boolean }>;
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
  createLiveSession(input: { cwd?: string; workspaceCwd?: string | null; model?: string | null; thinkingLevel?: string | null; serviceTier?: string | null }): Promise<LiveSessionCreateResult>;
  resumeLiveSession(input: { sessionFile: string; cwd?: string }): Promise<{ id: string }>;
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
  forkLiveSession(input: { conversationId: string; entryId: string; preserveSource?: boolean; beforeEntry?: boolean }): Promise<{ newSessionId: string; sessionFile: string }>;
  summarizeAndForkLiveSession(conversationId: string): Promise<{ newSessionId: string; sessionFile: string }>;
  submitLiveSessionPrompt(input: {
    conversationId: string;
    text?: string;
    behavior?: 'steer' | 'followUp';
    images?: PromptImageInput[];
    attachmentRefs?: PromptAttachmentRefInput[];
    contextMessages?: Array<Pick<InjectedPromptMessage, 'customType' | 'content'>>;
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
  submitLiveSessionParallelPrompt(input: {
    conversationId: string;
    text?: string;
    images?: PromptImageInput[];
    attachmentRefs?: PromptAttachmentRefInput[];
    contextMessages?: Array<Pick<InjectedPromptMessage, 'customType' | 'content'>>;
    surfaceId?: string;
  }): Promise<{
    ok: true;
    accepted: true;
    jobId: string;
    childConversationId: string;
    referencedTaskIds: string[];
    referencedMemoryDocIds: string[];
    referencedVaultFileIds: string[];
    referencedAttachmentIds: string[];
  }>;
  manageLiveSessionParallelJob(input: {
    conversationId: string;
    jobId: string;
    action: 'importNow' | 'skip' | 'cancel';
    surfaceId?: string;
  }): Promise<{
    ok: true;
    status: 'imported' | 'queued' | 'skipped' | 'cancelled';
  }>;
  abortLiveSession(conversationId: string): Promise<{ ok: true }>;
  subscribeConversationState(input: {
    conversationId: string;
    tailBlocks?: number;
    surfaceId?: string;
    surfaceType?: 'desktop_web' | 'mobile_web';
  }): Promise<{ subscriptionId: string }>;
  unsubscribeConversationState(subscriptionId: string): Promise<void>;
  subscribeApiStream(path: string): Promise<{ subscriptionId: string }>;
  unsubscribeApiStream(subscriptionId: string): Promise<void>;
  subscribeAppEvents(): Promise<{ subscriptionId: string }>;
  unsubscribeAppEvents(subscriptionId: string): Promise<void>;
  subscribeRemoteOperations(): Promise<{ subscriptionId: string }>;
  unsubscribeRemoteOperations(subscriptionId: string): Promise<void>;
  goBack(): Promise<DesktopNavigationState>;
  goForward(): Promise<DesktopNavigationState>;
}

export interface DesktopRemoteOperationEnvelope {
  subscriptionId: string;
  event: DesktopRemoteOperationBridgeEvent;
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

// App-owned context menus stay in-app on both web and desktop. The native
// Electron menu path caused hangs and split the UX between surfaces.
export function shouldUseNativeAppContextMenus(): boolean {
  return false;
}

// Desktop environment reads cross the Electron bridge and can trigger daemon
// status checks. Cache the in-flight result so route changes do not keep poking
// the desktop runtime while the user clicks around the app.
let desktopEnvironmentPromise: Promise<DesktopEnvironmentState | null> | null = null;
let desktopEnvironmentBridge: PersonalAgentDesktopBridge | null = null;

export async function readDesktopEnvironment(): Promise<DesktopEnvironmentState | null> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    desktopEnvironmentBridge = null;
    desktopEnvironmentPromise = null;
    return null;
  }

  if (desktopEnvironmentBridge === bridge && desktopEnvironmentPromise) {
    return desktopEnvironmentPromise;
  }

  desktopEnvironmentBridge = bridge;
  const request = bridge.getEnvironment()
    .catch((error) => {
      if (desktopEnvironmentPromise === request) {
        desktopEnvironmentPromise = null;
        desktopEnvironmentBridge = null;
      }
      throw error;
    });
  desktopEnvironmentPromise = request;
  return request;
}

export async function readDesktopConnections(): Promise<DesktopConnectionsState | null> {
  const bridge = getDesktopBridge();
  if (!bridge) {
    return null;
  }

  return bridge.getConnections();
}
