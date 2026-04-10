import type {
  ActivityEntry,
  AlertEntry,
  AlertSnapshot,
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
  LiveSessionExportResult,
  LiveSessionForkEntry,
  LiveSessionMeta,
  LiveSessionPresenceState,
  DeferredResumeSummary,
  PromptAttachmentRefInput,
  PromptImageInput,
  SessionDetailResult,
} from './types';

export const DESKTOP_API_STREAM_EVENT = 'personal-agent-desktop-api-stream';
export const DESKTOP_APP_EVENTS_EVENT = 'personal-agent-desktop-app-events';

export interface PersonalAgentDesktopBridge {
  getEnvironment(): Promise<DesktopEnvironmentState>;
  getConnections(): Promise<DesktopConnectionsState>;
  getNavigationState(): Promise<DesktopNavigationState>;
  switchHost(hostId: string): Promise<void>;
  saveHost(host: DesktopHostRecord): Promise<DesktopConnectionsState>;
  deleteHost(hostId: string): Promise<DesktopConnectionsState>;
  openNewConversation(): Promise<void>;
  readActivity(): Promise<ActivityEntry[]>;
  readActivityById(activityId: string): Promise<ActivityEntry>;
  markActivityRead(input: { activityId: string; read?: boolean }): Promise<{ ok: true }>;
  readActivityCount(): Promise<{ count: number }>;
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
  recoverConversation(conversationId: string): Promise<ConversationRecoveryResult>;
  readConversationModelPreferences(input: { conversationId: string }): Promise<{ currentModel: string; currentThinkingLevel: string }>;
  updateConversationModelPreferences(input: { conversationId: string; model?: string | null; thinkingLevel?: string | null; surfaceId?: string }): Promise<{ currentModel: string; currentThinkingLevel: string }>;
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
  createLiveSession(input: { cwd?: string; model?: string | null; thinkingLevel?: string | null }): Promise<{ id: string; sessionFile: string }>;
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
  invokeLocalApi(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<unknown>;
  subscribeApiStream(path: string): Promise<{ subscriptionId: string }>;
  unsubscribeApiStream(subscriptionId: string): Promise<void>;
  subscribeAppEvents(): Promise<{ subscriptionId: string }>;
  unsubscribeAppEvents(subscriptionId: string): Promise<void>;
  openHostWindow(hostId: string): Promise<void>;
  showConnectionsWindow(): Promise<void>;
  goBack(): Promise<DesktopNavigationState>;
  goForward(): Promise<DesktopNavigationState>;
  restartActiveHost(): Promise<void>;
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
