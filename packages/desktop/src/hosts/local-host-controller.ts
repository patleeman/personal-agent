import { getDesktopAppBaseUrl } from '../app-protocol.js';
import { LocalBackendProcesses } from '../backend/local-backend-processes.js';
import { loadLocalApiModule, type LocalApiModuleLoader } from '../local-api-module.js';
import type {
  DesktopApiStreamEvent,
  DesktopAppBridgeEvent,
  DesktopConversationBootstrapRequest,
  DesktopConversationCwdChangeRequest,
  DesktopConversationDeferredResumeMutationRequest,
  DesktopConversationDeferredResumeScheduleRequest,
  DesktopConversationStateBridgeEvent,
  DesktopConversationStateSubscriptionRequest,
  DesktopDurableRunAttentionRequest,
  DesktopConversationModelPreferencesRequest,
  DesktopConversationModelPreferencesUpdateRequest,
  DesktopConversationRenameRequest,
  DesktopDurableRunLogRequest,
  DesktopHostRecord,
  DesktopLiveSessionBranchRequest,
  DesktopLiveSessionCompactRequest,
  DesktopLiveSessionCreateRequest,
  DesktopLiveSessionExportRequest,
  DesktopLiveSessionForkRequest,
  DesktopLiveSessionParallelPromptRequest,
  DesktopLiveSessionParallelPromptResult,
  DesktopLiveSessionParallelJobRequest,
  DesktopLiveSessionParallelJobResult,
  DesktopLiveSessionPromptRequest,
  DesktopLiveSessionPromptResult,
  DesktopLiveSessionQueueRestoreRequest,
  DesktopLiveSessionQueueRestoreResult,
  DesktopLiveSessionTakeoverRequest,
  DesktopSessionBlockRequest,
  DesktopSessionDetailRequest,
  HostController,
  HostStatus,
} from './types.js';

export class LocalHostController implements HostController {
  readonly id: string;
  readonly label: string;
  readonly kind = 'local' as const;

  constructor(
    record: Extract<DesktopHostRecord, { kind: 'local' }>,
    private readonly backend = new LocalBackendProcesses(),
    private readonly loadLocalApi = loadLocalApiModule as LocalApiModuleLoader,
  ) {
    this.id = record.id;
    this.label = record.label;
  }

  async ensureRunning(): Promise<void> {
    await this.backend.ensureStarted();
  }

  async getBaseUrl(): Promise<string> {
    await this.backend.ensureStarted();
    return getDesktopAppBaseUrl();
  }

  async getStatus(): Promise<HostStatus> {
    const status = await this.backend.getStatus();
    const reachable = status.daemonHealthy && !status.blockedReason;
    const summary = status.blockedReason
      ?? (!status.daemonHealthy
        ? 'Local desktop runtime is starting or unavailable.'
        : status.daemonOwnership === 'external'
          ? 'Local desktop runtime is attached to an external daemon.'
          : 'Local desktop runtime is healthy.');

    return {
      reachable,
      mode: 'local-child-process',
      summary,
      webUrl: getDesktopAppBaseUrl(),
      daemonHealthy: reachable,
    };
  }

  async openNewConversation(): Promise<string> {
    const baseUrl = await this.getBaseUrl();
    return new URL('/conversations/new', baseUrl).toString();
  }

  async dispatchApiRequest(input: {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    path: string;
    body?: unknown;
    headers?: Record<string, string>;
  }) {
    const module = await this.loadLocalApi();
    return module.dispatchDesktopLocalApiRequest(input);
  }

  async invokeLocalApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.invokeDesktopLocalApi({ method, path, body });
  }

  async readAppStatus(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopAppStatus();
  }

  async readDaemonState(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopDaemonState();
  }

  async readWebUiState(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopWebUiState();
  }

  async updateWebUiConfig(input: {
    useTailscaleServe?: boolean;
    resumeFallbackPrompt?: string;
  }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.updateDesktopWebUiConfig(input);
  }

  async readRemoteAccessState(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopRemoteAccessState();
  }

  async createRemoteAccessPairingCode(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.createDesktopRemoteAccessPairingCode();
  }

  async revokeRemoteAccessSession(sessionId: string): Promise<{ ok: boolean; state: unknown }> {
    const module = await this.loadLocalApi();
    return module.revokeDesktopRemoteAccessSession(sessionId);
  }

  async readSessions(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopSessions();
  }

  async readSessionMeta(sessionId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopSessionMeta(sessionId);
  }

  async readSessionSearchIndex(sessionIds: string[]): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopSessionSearchIndex(sessionIds);
  }

  async readProfiles(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopProfiles();
  }

  async setCurrentProfile(profile: string): Promise<{ ok: true; currentProfile: string }> {
    const module = await this.loadLocalApi();
    return module.setDesktopCurrentProfile(profile);
  }

  async readModels(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopModels();
  }

  async updateModelPreferences(input: { model?: string | null; thinkingLevel?: string | null; serviceTier?: string | null }): Promise<{ ok: true }> {
    const module = await this.loadLocalApi();
    return module.updateDesktopModelPreferences(input);
  }

  async readDefaultCwd(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopDefaultCwd();
  }

  async updateDefaultCwd(cwd: string | null): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.updateDesktopDefaultCwd(cwd);
  }

  async readVaultRoot(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopVaultRoot();
  }

  async readVaultFiles(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopVaultFiles();
  }

  async updateVaultRoot(root: string | null): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.updateDesktopVaultRoot(root);
  }

  async pickFolder(input?: { cwd?: string | null; prompt?: string | null }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.pickDesktopFolder(input);
  }

  async readConversationTitleSettings(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationTitleSettings();
  }

  async updateConversationTitleSettings(input: { enabled?: boolean; model?: string | null }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.updateDesktopConversationTitleSettings(input);
  }

  async readConversationPlansWorkspace(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationPlansWorkspace();
  }

  async readOpenConversationTabs(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopOpenConversationTabs();
  }

  async updateOpenConversationTabs(input: { sessionIds?: string[]; pinnedSessionIds?: string[]; archivedSessionIds?: string[]; workspacePaths?: string[] }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.updateDesktopOpenConversationTabs(input);
  }

  async readModelProviders(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopModelProviders();
  }

  async saveModelProvider(input: {
    provider: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    authHeader?: boolean;
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
    modelOverrides?: Record<string, unknown>;
  }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.saveDesktopModelProvider(input);
  }

  async deleteModelProvider(provider: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.deleteDesktopModelProvider(provider);
  }

  async saveModelProviderModel(input: {
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
  }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.saveDesktopModelProviderModel(input);
  }

  async deleteModelProviderModel(input: { provider: string; modelId: string }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.deleteDesktopModelProviderModel(input);
  }

  async readProviderAuth(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopProviderAuth();
  }

  async setProviderApiKey(input: { provider: string; apiKey: string }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.setDesktopProviderApiKey(input);
  }

  async removeProviderCredential(provider: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.removeDesktopProviderCredential(provider);
  }

  async startProviderOAuthLogin(provider: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.startDesktopProviderOAuthLogin(provider);
  }

  async readProviderOAuthLogin(loginId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopProviderOAuthLogin(loginId);
  }

  async submitProviderOAuthLoginInput(input: { loginId: string; value: string }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.submitDesktopProviderOAuthLoginInput(input);
  }

  async cancelProviderOAuthLogin(loginId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.cancelDesktopProviderOAuthLogin(loginId);
  }

  async subscribeProviderOAuthLogin(loginId: string, onState: (state: unknown) => void): Promise<() => void> {
    const module = await this.loadLocalApi();
    return module.subscribeDesktopProviderOAuthLogin(loginId, onState);
  }

  async markConversationAttention(input: { conversationId: string; read?: boolean }): Promise<{ ok: true }> {
    const module = await this.loadLocalApi();
    return module.markDesktopConversationAttention(input);
  }

  async readScheduledTasks(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopScheduledTasks();
  }

  async readScheduledTaskDetail(taskId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopScheduledTaskDetail(taskId);
  }

  async readScheduledTaskLog(taskId: string): Promise<{ path: string; log: string }> {
    const module = await this.loadLocalApi();
    return module.readDesktopScheduledTaskLog(taskId);
  }

  async deleteScheduledTask(taskId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.deleteDesktopScheduledTask(taskId);
  }

  async createScheduledTask(input: {
    title?: string;
    enabled?: boolean;
    cron?: string | null;
    at?: string | null;
    model?: string | null;
    thinkingLevel?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    prompt?: string;
  }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.createDesktopScheduledTask(input);
  }

  async updateScheduledTask(input: {
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
  }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.updateDesktopScheduledTask(input);
  }

  async runScheduledTask(taskId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.runDesktopScheduledTask(taskId);
  }

  async readDurableRuns(): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopDurableRuns();
  }

  async readDurableRun(runId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopDurableRun(runId);
  }

  async readDurableRunLog(input: DesktopDurableRunLogRequest): Promise<{ path: string; log: string }> {
    const module = await this.loadLocalApi();
    return module.readDesktopDurableRunLog(input);
  }

  async cancelDurableRun(runId: string): Promise<{ cancelled: boolean; runId: string; reason?: string }> {
    const module = await this.loadLocalApi();
    return module.cancelDesktopDurableRun(runId);
  }

  async markDurableRunAttention(input: DesktopDurableRunAttentionRequest): Promise<{ ok: true }> {
    const module = await this.loadLocalApi();
    return module.markDesktopDurableRunAttention(input);
  }

  async readConversationBootstrap(input: DesktopConversationBootstrapRequest): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationBootstrap(input);
  }

  async renameConversation(input: DesktopConversationRenameRequest): Promise<{ ok: true; title: string }> {
    const module = await this.loadLocalApi();
    return module.renameDesktopConversation(input);
  }

  async changeConversationCwd(input: DesktopConversationCwdChangeRequest): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.changeDesktopConversationCwd(input);
  }

  async readConversationDeferredResumes(conversationId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationDeferredResumes(conversationId);
  }

  async scheduleConversationDeferredResume(input: DesktopConversationDeferredResumeScheduleRequest): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.scheduleDesktopConversationDeferredResume(input);
  }

  async cancelConversationDeferredResume(input: DesktopConversationDeferredResumeMutationRequest): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.cancelDesktopConversationDeferredResume(input);
  }

  async fireConversationDeferredResume(input: DesktopConversationDeferredResumeMutationRequest): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.fireDesktopConversationDeferredResume(input);
  }

  async recoverConversation(conversationId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.recoverDesktopConversation(conversationId);
  }

  async readConversationModelPreferences(input: DesktopConversationModelPreferencesRequest): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationModelPreferences(input.conversationId);
  }

  async updateConversationModelPreferences(input: DesktopConversationModelPreferencesUpdateRequest): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.updateDesktopConversationModelPreferences(input);
  }

  async readConversationArtifacts(conversationId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationArtifacts(conversationId);
  }

  async readConversationArtifact(input: { conversationId: string; artifactId: string }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationArtifact(input);
  }

  async readConversationCheckpoints(conversationId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationCheckpoints(conversationId);
  }

  async readConversationCheckpoint(input: { conversationId: string; checkpointId: string }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationCheckpoint(input);
  }

  async readConversationAttachments(conversationId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationAttachments(conversationId);
  }

  async readConversationAttachment(input: { conversationId: string; attachmentId: string }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationAttachment(input);
  }

  async createConversationAttachment(input: {
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
  }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.createDesktopConversationAttachment(input);
  }

  async updateConversationAttachment(input: {
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
  }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.updateDesktopConversationAttachment(input);
  }

  async readConversationAttachmentAsset(input: { conversationId: string; attachmentId: string; asset: 'source' | 'preview'; revision?: number }): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopConversationAttachmentAsset(input);
  }

  async readLiveSession(conversationId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopLiveSession(conversationId);
  }

  async readLiveSessionForkEntries(conversationId: string): Promise<Array<{ entryId: string; text: string }>> {
    const module = await this.loadLocalApi();
    return module.readDesktopLiveSessionForkEntries(conversationId);
  }

  async readLiveSessionContext(conversationId: string): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopLiveSessionContext(conversationId);
  }

  async readSessionDetail(input: DesktopSessionDetailRequest): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopSessionDetail(input);
  }

  async readSessionBlock(input: DesktopSessionBlockRequest): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.readDesktopSessionBlock(input);
  }

  async createLiveSession(input: DesktopLiveSessionCreateRequest): Promise<{ id: string; sessionFile: string; bootstrap?: unknown }> {
    const module = await this.loadLocalApi();
    return module.createDesktopLiveSession(input);
  }

  async resumeLiveSession(sessionFile: string): Promise<{ id: string }> {
    const module = await this.loadLocalApi();
    return module.resumeDesktopLiveSession(sessionFile);
  }

  async takeOverLiveSession(input: DesktopLiveSessionTakeoverRequest): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.takeOverDesktopLiveSession(input);
  }

  async restoreQueuedLiveSessionMessage(input: DesktopLiveSessionQueueRestoreRequest): Promise<DesktopLiveSessionQueueRestoreResult> {
    const module = await this.loadLocalApi();
    return module.restoreDesktopQueuedLiveSessionMessage(input);
  }

  async compactLiveSession(input: DesktopLiveSessionCompactRequest): Promise<{ ok: true; result: unknown }> {
    const module = await this.loadLocalApi();
    return module.compactDesktopLiveSession(input);
  }

  async exportLiveSession(input: DesktopLiveSessionExportRequest): Promise<{ ok: true; path: string }> {
    const module = await this.loadLocalApi();
    return module.exportDesktopLiveSession(input);
  }

  async reloadLiveSession(conversationId: string): Promise<{ ok: true }> {
    const module = await this.loadLocalApi();
    return module.reloadDesktopLiveSession({ conversationId });
  }

  async destroyLiveSession(conversationId: string): Promise<{ ok: true }> {
    const module = await this.loadLocalApi();
    return module.destroyDesktopLiveSession(conversationId);
  }

  async branchLiveSession(input: DesktopLiveSessionBranchRequest): Promise<{ newSessionId: string; sessionFile: string }> {
    const module = await this.loadLocalApi();
    return module.branchDesktopLiveSession(input);
  }

  async forkLiveSession(input: DesktopLiveSessionForkRequest): Promise<{ newSessionId: string; sessionFile: string }> {
    const module = await this.loadLocalApi();
    return module.forkDesktopLiveSession(input);
  }

  async summarizeAndForkLiveSession(conversationId: string): Promise<{ newSessionId: string; sessionFile: string }> {
    const module = await this.loadLocalApi();
    return module.summarizeAndForkDesktopLiveSession({ conversationId });
  }

  async submitLiveSessionPrompt(input: DesktopLiveSessionPromptRequest): Promise<DesktopLiveSessionPromptResult> {
    const module = await this.loadLocalApi();
    return module.submitDesktopLiveSessionPrompt(input);
  }

  async submitLiveSessionParallelPrompt(input: DesktopLiveSessionParallelPromptRequest): Promise<DesktopLiveSessionParallelPromptResult> {
    const module = await this.loadLocalApi();
    return module.submitDesktopLiveSessionParallelPrompt(input);
  }

  async manageLiveSessionParallelJob(input: DesktopLiveSessionParallelJobRequest): Promise<DesktopLiveSessionParallelJobResult> {
    const module = await this.loadLocalApi();
    return module.manageDesktopLiveSessionParallelJob(input);
  }

  async abortLiveSession(conversationId: string): Promise<{ ok: true }> {
    const module = await this.loadLocalApi();
    return module.abortDesktopLiveSession(conversationId);
  }

  async subscribeConversationState(
    input: DesktopConversationStateSubscriptionRequest,
    onEvent: (event: DesktopConversationStateBridgeEvent) => void,
  ): Promise<() => void> {
    const module = await this.loadLocalApi();
    return module.subscribeDesktopConversationState(input, onEvent);
  }

  async subscribeApiStream(path: string, onEvent: (event: DesktopApiStreamEvent) => void): Promise<() => void> {
    const module = await this.loadLocalApi();
    return module.subscribeDesktopLocalApiStream(path, onEvent);
  }

  async subscribeDesktopAppEvents(onEvent: (event: DesktopAppBridgeEvent) => void): Promise<() => void> {
    const module = await this.loadLocalApi();
    return module.subscribeDesktopAppEvents(onEvent);
  }

  async restart(): Promise<void> {
    await this.backend.restart();
  }

  async stop(): Promise<void> {
    await this.backend.stop();
  }

  async dispose(): Promise<void> {
    await this.stop();
  }
}
