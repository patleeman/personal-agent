import { getDesktopAppBaseUrl } from '../app-protocol.js';
import { LocalBackendProcesses } from '../backend/local-backend-processes.js';
import { loadLocalApiModule, type LocalApiModuleLoader } from '../local-api-module.js';
import type {
  DesktopApiStreamEvent,
  DesktopAppBridgeEvent,
  DesktopConversationBootstrapRequest,
  DesktopConversationCwdChangeRequest,
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
    return {
      reachable: status.daemonHealthy,
      mode: 'local-child-process',
      summary: status.daemonHealthy ? 'Local desktop runtime is healthy.' : 'Local desktop runtime is starting or unavailable.',
      webUrl: getDesktopAppBaseUrl(),
      daemonHealthy: status.daemonHealthy,
    };
  }

  async openNewConversation(): Promise<string> {
    const baseUrl = await this.getBaseUrl();
    return new URL('/conversations/new', baseUrl).toString();
  }

  async invokeLocalApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown> {
    const module = await this.loadLocalApi();
    return module.invokeDesktopLocalApi({ method, path, body });
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

  async createLiveSession(input: DesktopLiveSessionCreateRequest): Promise<{ id: string; sessionFile: string }> {
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

  async abortLiveSession(conversationId: string): Promise<{ ok: true }> {
    const module = await this.loadLocalApi();
    return module.abortDesktopLiveSession(conversationId);
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
