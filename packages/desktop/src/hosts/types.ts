export type DesktopHostRecord =
  | {
      id: string;
      label: string;
      kind: 'local';
    }
  | {
      id: string;
      label: string;
      kind: 'ssh';
      sshTarget: string;
      remoteRepoRoot?: string;
      remotePort?: number;
      autoConnect?: boolean;
    }
  | {
      id: string;
      label: string;
      kind: 'web';
      baseUrl: string;
      autoConnect?: boolean;
    };

export interface DesktopConfig {
  version: 1;
  defaultHostId: string;
  openWindowOnLaunch: boolean;
  windowState?: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  };
  hosts: DesktopHostRecord[];
}

export interface HostStatus {
  reachable: boolean;
  mode: 'local-child-process' | 'ssh-tunnel' | 'web-remote';
  summary: string;
  webUrl?: string;
  daemonHealthy?: boolean;
  webHealthy?: boolean;
  lastError?: string;
}

export interface DesktopApiStreamEvent {
  type: 'open' | 'message' | 'error' | 'close';
  data?: string;
  message?: string;
}

export interface DesktopRemoteHostAuthState {
  hostId: string;
  hasBearerToken: boolean;
  sessionId?: string;
  deviceLabel?: string;
  createdAt?: string;
  expiresAt?: string;
}

export interface HostApiDispatchResult {
  statusCode: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export interface DesktopConversationStateSubscriptionRequest {
  conversationId: string;
  tailBlocks?: number;
  surfaceId?: string;
  surfaceType?: 'desktop_web' | 'mobile_web';
}

export interface DesktopConversationStateBridgeEvent {
  type: 'open' | 'state' | 'error' | 'close';
  state?: unknown;
  message?: string;
}

export interface DesktopAppBridgeEvent {
  type: 'open' | 'event' | 'error' | 'close';
  event?: unknown;
  message?: string;
}

export interface DesktopConversationBootstrapRequest {
  conversationId: string;
  tailBlocks?: number;
  knownSessionSignature?: string;
  knownBlockOffset?: number;
  knownTotalBlocks?: number;
  knownLastBlockId?: string;
}

export interface DesktopProviderApiKeyRequest {
  provider: string;
  apiKey: string;
}

export interface DesktopProviderOAuthInputRequest {
  loginId: string;
  value: string;
}

export interface DesktopModelPreferencesUpdateRequest {
  model?: string | null;
  thinkingLevel?: string | null;
}

export interface DesktopConversationPlanDefaultsUpdateRequest {
  defaultEnabled?: boolean;
}

export interface DesktopConversationPlanLibraryUpdateRequest {
  presets?: unknown;
  defaultPresetIds?: unknown;
}

export interface DesktopConversationAttentionRequest {
  conversationId: string;
  read?: boolean;
}

export interface DesktopAlertSnoozeRequest {
  alertId: string;
  delay?: string;
  at?: string;
}

export interface DesktopConversationRenameRequest {
  conversationId: string;
  name: string;
  surfaceId?: string;
}

export interface DesktopConversationCwdChangeRequest {
  conversationId: string;
  cwd: string;
  surfaceId?: string;
}

export interface DesktopLiveSessionExportRequest {
  conversationId: string;
  outputPath?: string;
}

export interface DesktopConversationModelPreferencesRequest {
  conversationId: string;
}

export interface DesktopConversationModelPreferencesUpdateRequest {
  conversationId: string;
  model?: string | null;
  thinkingLevel?: string | null;
  surfaceId?: string;
}

export interface DesktopConversationDeferredResumeScheduleRequest {
  conversationId: string;
  delay?: string;
  prompt?: string;
  behavior?: 'steer' | 'followUp';
}

export interface DesktopConversationDeferredResumeMutationRequest {
  conversationId: string;
  resumeId: string;
}

export interface DesktopSessionDetailRequest {
  sessionId: string;
  tailBlocks?: number;
  knownSessionSignature?: string;
  knownBlockOffset?: number;
  knownTotalBlocks?: number;
  knownLastBlockId?: string;
}

export interface DesktopSessionBlockRequest {
  sessionId: string;
  blockId: string;
}

export interface DesktopDurableRunLogRequest {
  runId: string;
  tail?: number;
}

export interface DesktopDurableRunAttentionRequest {
  runId: string;
  read?: boolean;
}

export interface DesktopScheduledTaskUpdateRequest {
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
}

export interface DesktopLiveSessionCreateRequest {
  cwd?: string;
  model?: string | null;
  thinkingLevel?: string | null;
}

export interface DesktopLiveSessionTakeoverRequest {
  conversationId: string;
  surfaceId: string;
}

export interface DesktopLiveSessionPromptRequest {
  conversationId: string;
  text?: string;
  behavior?: 'steer' | 'followUp';
  images?: Array<{ data: string; mimeType: string; name?: string }>;
  attachmentRefs?: Array<{ attachmentId: string; revision?: number }>;
  surfaceId?: string;
}

export interface DesktopLiveSessionPromptResult {
  ok: true;
  accepted: true;
  delivery: 'started' | 'queued';
  referencedTaskIds: string[];
  referencedMemoryDocIds: string[];
  referencedVaultFileIds: string[];
  referencedAttachmentIds: string[];
}

export interface DesktopLiveSessionQueueRestoreRequest {
  conversationId: string;
  behavior: 'steer' | 'followUp';
  index: number;
  previewId?: string;
}

export interface DesktopLiveSessionQueueRestoreResult {
  ok: true;
  text: string;
  images: Array<{ type: 'image'; data: string; mimeType: string; name?: string }>;
}

export interface DesktopLiveSessionCompactRequest {
  conversationId: string;
  customInstructions?: string;
}

export interface DesktopLiveSessionBranchRequest {
  conversationId: string;
  entryId: string;
}

export interface DesktopLiveSessionForkRequest {
  conversationId: string;
  entryId: string;
  preserveSource?: boolean;
}

export interface HostController {
  readonly id: string;
  readonly label: string;
  readonly kind: DesktopHostRecord['kind'];
  ensureRunning(): Promise<void>;
  getBaseUrl(): Promise<string>;
  getStatus(): Promise<HostStatus>;
  openNewConversation(): Promise<string>;
  dispatchApiRequest(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<HostApiDispatchResult>;
  invokeLocalApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown>;
  readAppStatus?(): Promise<unknown>;
  readDaemonState?(): Promise<unknown>;
  readWebUiState?(): Promise<unknown>;
  updateWebUiConfig?(input: { useTailscaleServe?: boolean; resumeFallbackPrompt?: string }): Promise<unknown>;
  readRemoteAccessState?(): Promise<unknown>;
  createRemoteAccessPairingCode?(): Promise<unknown>;
  revokeRemoteAccessSession?(sessionId: string): Promise<{ ok: boolean; state: unknown }>;
  readSessions?(): Promise<unknown>;
  readSessionMeta?(sessionId: string): Promise<unknown>;
  readSessionSearchIndex?(sessionIds: string[]): Promise<unknown>;
  readProfiles?(): Promise<unknown>;
  setCurrentProfile?(profile: string): Promise<{ ok: true; currentProfile: string }>;
  readModels?(): Promise<unknown>;
  updateModelPreferences?(input: DesktopModelPreferencesUpdateRequest): Promise<{ ok: true }>;
  readDefaultCwd?(): Promise<unknown>;
  updateDefaultCwd?(cwd: string | null): Promise<unknown>;
  readVaultRoot?(): Promise<unknown>;
  readVaultFiles?(): Promise<unknown>;
  updateVaultRoot?(root: string | null): Promise<unknown>;
  pickFolder?(input?: { cwd?: string | null; prompt?: string | null }): Promise<unknown>;
  readConversationTitleSettings?(): Promise<unknown>;
  updateConversationTitleSettings?(input: { enabled?: boolean; model?: string | null }): Promise<unknown>;
  readConversationPlansWorkspace?(): Promise<unknown>;
  readOpenConversationTabs?(): Promise<unknown>;
  updateOpenConversationTabs?(input: { sessionIds?: string[]; pinnedSessionIds?: string[]; archivedSessionIds?: string[]; workspacePaths?: string[] }): Promise<unknown>;
  readModelProviders?(): Promise<unknown>;
  saveModelProvider?(input: {
    provider: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    authHeader?: boolean;
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
    modelOverrides?: Record<string, unknown>;
  }): Promise<unknown>;
  deleteModelProvider?(provider: string): Promise<unknown>;
  saveModelProviderModel?(input: {
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
    cost?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
    compat?: Record<string, unknown>;
  }): Promise<unknown>;
  deleteModelProviderModel?(input: { provider: string; modelId: string }): Promise<unknown>;
  readProviderAuth?(): Promise<unknown>;
  setProviderApiKey?(input: DesktopProviderApiKeyRequest): Promise<unknown>;
  removeProviderCredential?(provider: string): Promise<unknown>;
  startProviderOAuthLogin?(provider: string): Promise<unknown>;
  readProviderOAuthLogin?(loginId: string): Promise<unknown>;
  submitProviderOAuthLoginInput?(input: DesktopProviderOAuthInputRequest): Promise<unknown>;
  cancelProviderOAuthLogin?(loginId: string): Promise<unknown>;
  subscribeProviderOAuthLogin?(loginId: string, onState: (state: unknown) => void): Promise<() => void>;
  markConversationAttention?(input: DesktopConversationAttentionRequest): Promise<{ ok: true }>;
  readScheduledTasks?(): Promise<unknown>;
  readScheduledTaskDetail?(taskId: string): Promise<unknown>;
  readScheduledTaskLog?(taskId: string): Promise<{ path: string; log: string }>;
  createScheduledTask?(input: Omit<DesktopScheduledTaskUpdateRequest, 'taskId'>): Promise<unknown>;
  updateScheduledTask?(input: DesktopScheduledTaskUpdateRequest): Promise<unknown>;
  runScheduledTask?(taskId: string): Promise<unknown>;
  readDurableRuns?(): Promise<unknown>;
  readDurableRun?(runId: string): Promise<unknown>;
  readDurableRunLog?(input: DesktopDurableRunLogRequest): Promise<{ path: string; log: string }>;
  cancelDurableRun?(runId: string): Promise<{ cancelled: boolean; runId: string; reason?: string }>;
  markDurableRunAttention?(input: DesktopDurableRunAttentionRequest): Promise<{ ok: true }>;
  readConversationBootstrap?(input: DesktopConversationBootstrapRequest): Promise<unknown>;
  renameConversation?(input: DesktopConversationRenameRequest): Promise<{ ok: true; title: string }>;
  changeConversationCwd?(input: DesktopConversationCwdChangeRequest): Promise<unknown>;
  readConversationDeferredResumes?(conversationId: string): Promise<unknown>;
  scheduleConversationDeferredResume?(input: DesktopConversationDeferredResumeScheduleRequest): Promise<unknown>;
  cancelConversationDeferredResume?(input: DesktopConversationDeferredResumeMutationRequest): Promise<unknown>;
  fireConversationDeferredResume?(input: DesktopConversationDeferredResumeMutationRequest): Promise<unknown>;
  recoverConversation?(conversationId: string): Promise<unknown>;
  readConversationModelPreferences?(input: DesktopConversationModelPreferencesRequest): Promise<unknown>;
  updateConversationModelPreferences?(input: DesktopConversationModelPreferencesUpdateRequest): Promise<unknown>;
  readConversationArtifacts?(conversationId: string): Promise<unknown>;
  readConversationArtifact?(input: { conversationId: string; artifactId: string }): Promise<unknown>;
  readConversationAttachments?(conversationId: string): Promise<unknown>;
  readConversationAttachment?(input: { conversationId: string; attachmentId: string }): Promise<unknown>;
  createConversationAttachment?(input: {
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
  }): Promise<unknown>;
  updateConversationAttachment?(input: {
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
  }): Promise<unknown>;
  readConversationAttachmentAsset?(input: { conversationId: string; attachmentId: string; asset: 'source' | 'preview'; revision?: number }): Promise<unknown>;
  readLiveSession?(conversationId: string): Promise<unknown>;
  readLiveSessionForkEntries?(conversationId: string): Promise<Array<{ entryId: string; text: string }>>;
  readLiveSessionContext?(conversationId: string): Promise<unknown>;
  readSessionDetail?(input: DesktopSessionDetailRequest): Promise<unknown>;
  readSessionBlock?(input: DesktopSessionBlockRequest): Promise<unknown>;
  createLiveSession?(input: DesktopLiveSessionCreateRequest): Promise<{ id: string; sessionFile: string; bootstrap?: unknown }>;
  resumeLiveSession?(sessionFile: string): Promise<{ id: string }>;
  takeOverLiveSession?(input: DesktopLiveSessionTakeoverRequest): Promise<unknown>;
  restoreQueuedLiveSessionMessage?(input: DesktopLiveSessionQueueRestoreRequest): Promise<DesktopLiveSessionQueueRestoreResult>;
  compactLiveSession?(input: DesktopLiveSessionCompactRequest): Promise<{ ok: true; result: unknown }>;
  exportLiveSession?(input: DesktopLiveSessionExportRequest): Promise<{ ok: true; path: string }>;
  reloadLiveSession?(conversationId: string): Promise<{ ok: true }>;
  destroyLiveSession?(conversationId: string): Promise<{ ok: true }>;
  branchLiveSession?(input: DesktopLiveSessionBranchRequest): Promise<{ newSessionId: string; sessionFile: string }>;
  forkLiveSession?(input: DesktopLiveSessionForkRequest): Promise<{ newSessionId: string; sessionFile: string }>;
  summarizeAndForkLiveSession?(conversationId: string): Promise<{ newSessionId: string; sessionFile: string }>;
  submitLiveSessionPrompt?(input: DesktopLiveSessionPromptRequest): Promise<DesktopLiveSessionPromptResult>;
  abortLiveSession?(conversationId: string): Promise<{ ok: true }>;
  subscribeConversationState?(
    input: DesktopConversationStateSubscriptionRequest,
    onEvent: (event: DesktopConversationStateBridgeEvent) => void,
  ): Promise<() => void>;
  subscribeApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void>;
  subscribeDesktopAppEvents?(onEvent: (event: DesktopAppBridgeEvent) => void): Promise<() => void>;
  restart(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export interface DesktopEnvironmentState {
  isElectron: true;
  activeHostId: string;
  activeHostLabel: string;
  activeHostKind: DesktopHostRecord['kind'];
  activeHostSummary: string;
  launchMode?: 'stable' | 'testing';
  launchLabel?: string;
  canManageConnections: true;
}

export interface DesktopConnectionsState {
  activeHostId: string;
  defaultHostId: string;
  hosts: DesktopHostRecord[];
}
