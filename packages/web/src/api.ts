import type { ActivityEntry, AlertEntry, AlertSnapshot, ApplicationRestartRequestResult, AppStatus, CodexPlanUsageState, CompanionAuthAdminState, CompanionAuthSessionState, CompanionConversationListResult, CompanionPairingCodeResult, ConversationArtifactRecord, ConversationArtifactSummary, ConversationAttachmentRecord, ConversationAttachmentSummary, ConversationAutomationPreferencesState, ConversationAutomationResponse, ConversationAutomationTemplateTodoItem, ConversationAutomationWorkflowPresetLibraryState, ConversationAutomationWorkspaceState, ConversationBootstrapState, ConversationCwdChangeResult, ConversationTitleSettingsState, DaemonState, DefaultCwdState, DeferredResumeSummary, DesktopAuthSessionState, DisplayBlock, DurableRunDetailResult, DurableRunListResult, FolderPickerResult, LiveSessionContext, LiveSessionMeta, LiveSessionPresenceState, McpServerDetail, McpToolDetail, MemoryData, ModelProviderState, ModelState, PackageInstallResult, ProfileState, PromptAttachmentRefInput, PromptImageInput, ProviderAuthState, ProviderOAuthLoginState, ScheduledTaskDetail, ScheduledTaskSummary, SessionContextUsage, SessionDetailResult, SessionMeta, ToolsState, VaultFileListResult, VaultRootState, WebUiState } from './types';
import { buildApiPath } from './apiBase';
import { recordApiTiming } from './perfDiagnostics';

// ── Retry helpers for transient network errors (e.g. server restarts) ────────

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

function isTransientNetworkError(error: unknown): boolean {
  if (error instanceof TypeError && /failed to fetch|network|ECONNREFUSED|ECONNRESET/i.test(error.message)) {
    return true;
  }

  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= RETRY_DELAYS_MS.length) {
        throw error;
      }

      await sleep(RETRY_DELAYS_MS[attempt] as number);
    }
  }

  throw lastError;
}

// ── API helpers ──────────────────────────────────────────────────────────────

async function get<T>(path: string): Promise<T> {
  const requestPath = buildApiPath(path);
  const res = await fetchWithRetry(requestPath, { cache: 'no-store' });
  recordApiTiming(requestPath, res);
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const requestPath = buildApiPath(path);
  const res = await fetchWithRetry(requestPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  recordApiTiming(requestPath, res);
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const requestPath = buildApiPath(path);
  const res = await fetchWithRetry(requestPath, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  recordApiTiming(requestPath, res);
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const requestPath = buildApiPath(path);
  const res = await fetchWithRetry(requestPath, { method: 'DELETE' });
  recordApiTiming(requestPath, res);
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json() as Promise<T>;
}

async function readApiError(res: Response): Promise<string> {
  try {
    const data = await res.json() as { error?: string };
    if (typeof data.error === 'string' && data.error.trim().length > 0) {
      return data.error;
    }
  } catch {
    // Ignore non-JSON error bodies.
  }

  return `${res.status} ${res.statusText}`;
}

function withViewProfile(path: string, profile?: string): string {
  if (!profile) {
    return path;
  }

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}viewProfile=${encodeURIComponent(profile)}`;
}

const pendingMemoryRequests = new Map<string, Promise<MemoryData>>();

function buildMemoryRequestKey(options?: { profile?: string }): string {
  return options?.profile?.trim() || '__current__';
}

async function getMemoryData(options?: { profile?: string }): Promise<MemoryData> {
  const cacheKey = buildMemoryRequestKey(options);
  const pending = pendingMemoryRequests.get(cacheKey);
  if (pending) {
    return pending;
  }

  const request = get<MemoryData>(withViewProfile('/memory', options?.profile)).finally(() => {
    pendingMemoryRequests.delete(cacheKey);
  });
  pendingMemoryRequests.set(cacheKey, request);
  return request;
}

export const api = {
  // ── Core ──────────────────────────────────────────────────────────────────
  status:       () => get<AppStatus>('/status'),
  daemon:       () => get<DaemonState>('/daemon'),
  installDaemonService: () => post<DaemonState>('/daemon/service/install'),
  startDaemonService: () => post<DaemonState>('/daemon/service/start'),
  restartDaemonService: () => post<DaemonState>('/daemon/service/restart'),
  stopDaemonService: () => post<DaemonState>('/daemon/service/stop'),
  uninstallDaemonService: () => post<DaemonState>('/daemon/service/uninstall'),
  webUiState:   () => get<WebUiState>('/web-ui/state'),
  restartApplication: () => post<ApplicationRestartRequestResult>('/application/restart'),
  updateApplication: () => post<ApplicationRestartRequestResult>('/application/update'),
  installWebUiService: () => post<WebUiState>('/web-ui/service/install'),
  startWebUiService: () => post<WebUiState>('/web-ui/service/start'),
  restartWebUiService: () => post<ApplicationRestartRequestResult>('/web-ui/service/restart'),
  stopWebUiService: () => post<WebUiState>('/web-ui/service/stop'),
  uninstallWebUiService: () => post<WebUiState>('/web-ui/service/uninstall'),
  setWebUiConfig: (input: { companionPort?: number; useTailscaleServe?: boolean; resumeFallbackPrompt?: string }) => patch<WebUiState>('/web-ui/config', input),
  companionAuthState: () => get<CompanionAuthAdminState>('/companion-auth'),
  createCompanionPairingCode: () => post<CompanionPairingCodeResult>('/companion-auth/pairing-code'),
  revokeCompanionSession: (sessionId: string) =>
    del<{ ok: boolean; state: CompanionAuthAdminState }>(`/companion-auth/sessions/${encodeURIComponent(sessionId)}`),
  desktopAuthSession: () => get<DesktopAuthSessionState>('/desktop-auth/session'),
  exchangeDesktopPairingCode: (code: string, deviceLabel?: string) =>
    post<DesktopAuthSessionState>('/desktop-auth/exchange', { code, deviceLabel }),
  logoutDesktopSession: () => post<{ ok: boolean }>('/desktop-auth/logout'),
  companionSession: () => get<CompanionAuthSessionState>('/companion-auth/session'),
  exchangeCompanionPairingCode: (code: string, deviceLabel?: string) =>
    post<CompanionAuthSessionState>('/companion-auth/exchange', { code, deviceLabel }),
  logoutCompanionSession: () => post<{ ok: boolean }>('/companion-auth/logout'),
  activity:     () => get<ActivityEntry[]>('/activity'),
  activityById: (id: string) => get<ActivityEntry>(`/activity/${encodeURIComponent(id)}`),
  sessions:     () => get<SessionMeta[]>('/sessions'),
  sessionMeta:  (id: string) => get<SessionMeta>(`/sessions/${encodeURIComponent(id)}/meta`),
  companionConversationList: (options?: { archivedOffset?: number; archivedLimit?: number }) => {
    const params = new URLSearchParams();
    if (typeof options?.archivedOffset === 'number' && Number.isInteger(options.archivedOffset) && options.archivedOffset >= 0) {
      params.set('archivedOffset', String(options.archivedOffset));
    }
    if (typeof options?.archivedLimit === 'number' && Number.isInteger(options.archivedLimit) && options.archivedLimit > 0) {
      params.set('archivedLimit', String(options.archivedLimit));
    }

    const query = params.toString();
    return get<CompanionConversationListResult>(`/companion/conversations${query ? `?${query}` : ''}`);
  },
  sessionDetail: (id: string, options?: {
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }) => {
    const params = new URLSearchParams();
    if (typeof options?.tailBlocks === 'number' && Number.isInteger(options.tailBlocks) && options.tailBlocks > 0) {
      params.set('tailBlocks', String(options.tailBlocks));
    }
    if (typeof options?.knownSessionSignature === 'string' && options.knownSessionSignature.trim().length > 0) {
      params.set('knownSessionSignature', options.knownSessionSignature.trim());
    }
    if (typeof options?.knownBlockOffset === 'number' && Number.isInteger(options.knownBlockOffset) && options.knownBlockOffset >= 0) {
      params.set('knownBlockOffset', String(options.knownBlockOffset));
    }
    if (typeof options?.knownTotalBlocks === 'number' && Number.isInteger(options.knownTotalBlocks) && options.knownTotalBlocks >= 0) {
      params.set('knownTotalBlocks', String(options.knownTotalBlocks));
    }
    if (typeof options?.knownLastBlockId === 'string' && options.knownLastBlockId.trim().length > 0) {
      params.set('knownLastBlockId', options.knownLastBlockId.trim());
    }

    const query = params.toString();
    return get<SessionDetailResult>(`/sessions/${encodeURIComponent(id)}${query ? `?${query}` : ''}`);
  },
  sessionBlock: (id: string, blockId: string) => get<DisplayBlock>(`/sessions/${encodeURIComponent(id)}/blocks/${encodeURIComponent(blockId)}`),
  sessionSearchIndex: (sessionIds: string[]) => post<{ index: Record<string, string> }>('/sessions/search-index', { sessionIds }),
  profiles:     () => get<ProfileState>('/profiles'),
  setCurrentProfile: (profile: string) => patch<{ ok: boolean; currentProfile: string }>('/profiles/current', { profile }),

  // ── Models ────────────────────────────────────────────────────────────────
  models: () => get<ModelState>('/models'),
  modelProviders: () => get<ModelProviderState>('/model-providers'),
  saveModelProvider: (provider: string, input: {
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    authHeader?: boolean;
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
    modelOverrides?: Record<string, unknown>;
  }) => post<ModelProviderState>('/model-providers/providers', { provider, ...input }),
  deleteModelProvider: (provider: string) =>
    del<ModelProviderState>(`/model-providers/providers/${encodeURIComponent(provider)}`),
  saveModelProviderModel: (provider: string, input: {
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
  }) => post<ModelProviderState>(`/model-providers/providers/${encodeURIComponent(provider)}/models`, input),
  deleteModelProviderModel: (provider: string, modelId: string) =>
    del<ModelProviderState>(`/model-providers/providers/${encodeURIComponent(provider)}/models/${encodeURIComponent(modelId)}`),
  defaultCwd: () => get<DefaultCwdState>('/default-cwd'),
  vaultRoot: () => get<VaultRootState>('/vault-root'),
  vaultFiles: () => get<VaultFileListResult>('/vault-files'),
  tools: (options?: { profile?: string }) => get<ToolsState>(withViewProfile('/tools', options?.profile)),
  installPackageSource: (input: { source: string; target: 'profile' | 'local'; profileName?: string }) =>
    post<PackageInstallResult>('/tools/packages/install', input),
  mcpServer: (server: string) => get<McpServerDetail>(`/tools/mcp/servers/${encodeURIComponent(server)}`),
  mcpTool: (server: string, tool: string) => get<McpToolDetail>(`/tools/mcp/servers/${encodeURIComponent(server)}/tools/${encodeURIComponent(tool)}`),
  setModel: (model: string) => patch<{ ok: boolean }>('/models/current', { model }),
  updateModelPreferences: (input: { model?: string; thinkingLevel?: string }) =>
    patch<{ ok: boolean }>('/models/current', input),
  updateDefaultCwd: (cwd: string | null) =>
    patch<DefaultCwdState>('/default-cwd', { cwd }),
  updateVaultRoot: (root: string | null) =>
    patch<VaultRootState>('/vault-root', { root }),
  providerAuth: () => get<ProviderAuthState>('/provider-auth'),
  codexPlanUsage: () => get<CodexPlanUsageState>('/provider-auth/openai-codex/usage'),
  setProviderApiKey: (provider: string, apiKey: string) =>
    patch<ProviderAuthState>(`/provider-auth/${encodeURIComponent(provider)}/api-key`, { apiKey }),
  removeProviderCredential: (provider: string) =>
    del<ProviderAuthState>(`/provider-auth/${encodeURIComponent(provider)}`),
  startProviderOAuthLogin: (provider: string) =>
    post<ProviderOAuthLoginState>(`/provider-auth/${encodeURIComponent(provider)}/oauth/start`),
  providerOAuthLogin: (loginId: string) =>
    get<ProviderOAuthLoginState>(`/provider-auth/oauth/${encodeURIComponent(loginId)}`),
  submitProviderOAuthLoginInput: (loginId: string, value: string) =>
    post<ProviderOAuthLoginState>(`/provider-auth/oauth/${encodeURIComponent(loginId)}/input`, { value }),
  cancelProviderOAuthLogin: (loginId: string) =>
    post<ProviderOAuthLoginState>(`/provider-auth/oauth/${encodeURIComponent(loginId)}/cancel`),
  conversationTitleSettings: () => get<ConversationTitleSettingsState>('/conversation-titles/settings'),
  updateConversationTitleSettings: (input: { enabled?: boolean; model?: string | null }) =>
    patch<ConversationTitleSettingsState>('/conversation-titles/settings', input),
  conversationPlanDefaults: () => get<ConversationAutomationPreferencesState>('/conversation-plans/defaults'),
  updateConversationPlanDefaults: (input: { defaultEnabled: boolean }) =>
    patch<ConversationAutomationPreferencesState>('/conversation-plans/defaults', input),
  openConversationTabs: () => get<{ sessionIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[] }>('/web-ui/open-conversations'),
  setOpenConversationTabs: (sessionIds: string[], pinnedSessionIds: string[] = [], archivedSessionIds: string[] = []) =>
    patch<{ ok: boolean; sessionIds: string[]; pinnedSessionIds: string[]; archivedSessionIds: string[] }>('/web-ui/open-conversations', { sessionIds, pinnedSessionIds, archivedSessionIds }),

  // ── Tasks ─────────────────────────────────────────────────────────────────
  tasks: () => get<ScheduledTaskSummary[]>('/tasks'),
  taskDetail: (id: string) =>
    get<ScheduledTaskDetail>(`/tasks/${encodeURIComponent(id)}`),
  createTask: (input: {
    title: string;
    enabled?: boolean;
    cron?: string | null;
    at?: string | null;
    model?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    prompt: string;
  }) => post<{ ok: boolean; task: ScheduledTaskDetail }>('/tasks', input),
  setTaskEnabled: (id: string, enabled: boolean) =>
    patch<{ ok: boolean; task: ScheduledTaskDetail }>(`/tasks/${encodeURIComponent(id)}`, { enabled }),
  saveTask: (id: string, input: {
    title?: string;
    enabled?: boolean;
    cron?: string | null;
    at?: string | null;
    model?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    prompt?: string;
  }) => patch<{ ok: boolean; task: ScheduledTaskDetail }>(`/tasks/${encodeURIComponent(id)}`, input),
  taskLog: (id: string) =>
    get<{ log: string; path: string }>(`/tasks/${encodeURIComponent(id)}/log`),
  runTaskNow: (id: string) =>
    post<{ ok: boolean; accepted: boolean; runId: string }>(`/tasks/${encodeURIComponent(id)}/run`),
  runs: () => get<DurableRunListResult>('/runs'),
  durableRun: (id: string) => get<DurableRunDetailResult>(`/runs/${encodeURIComponent(id)}`),
  durableRunLog: (id: string, tail?: number) =>
    get<{ log: string; path: string }>(`/runs/${encodeURIComponent(id)}/log${tail ? `?tail=${encodeURIComponent(String(tail))}` : ''}`),
  markDurableRunAttentionRead: (id: string, read = true) =>
    patch<{ ok: boolean }>(`/runs/${encodeURIComponent(id)}/attention`, { read }),
  cancelDurableRun: (id: string) => post<{ cancelled: boolean; runId: string }>(`/runs/${encodeURIComponent(id)}/cancel`),

  // ── Shell run ─────────────────────────────────────────────────────────────
  pickFolder: (cwd?: string) =>
    post<FolderPickerResult>('/folder-picker', { cwd }),
  run: (command: string, cwd?: string) =>
    post<{ output: string; exitCode: number }>('/run', { command, cwd }),

  // ── Memory browser ────────────────────────────────────────────────────────
  memory:         (options?: { profile?: string }) => getMemoryData(options),
  memoryFile:     (path: string) => get<{ content: string; path: string }>(`/memory/file?path=${encodeURIComponent(path)}`),
  memoryFileSave: (path: string, content: string) => post<{ ok: boolean }>('/memory/file', { path, content }),

  // ── Alerts + activity ─────────────────────────────────────────────────────
  alerts: () => get<AlertSnapshot>('/alerts'),
  acknowledgeAlert: (id: string) => post<{ ok: boolean; alert: AlertEntry }>(`/alerts/${encodeURIComponent(id)}/ack`),
  dismissAlert: (id: string) => post<{ ok: boolean; alert: AlertEntry }>(`/alerts/${encodeURIComponent(id)}/dismiss`),
  snoozeAlert: (id: string, input: { delay?: string; at?: string }) =>
    post<{ ok: boolean; alert: AlertEntry; resume: DeferredResumeSummary }>(`/alerts/${encodeURIComponent(id)}/snooze`, input),
  activityCount: () => get<{ count: number }>('/activity/count'),
  clearInbox: () => post<{ ok: boolean; deletedActivityIds: string[]; clearedConversationIds: string[] }>('/inbox/clear'),
  markActivityRead: (id: string, read = true) =>
    patch<{ ok: boolean }>(`/activity/${encodeURIComponent(id)}`, { read }),
  startActivityConversation: (id: string) =>
    post<{ activityId: string; id: string; sessionFile: string; cwd: string; relatedConversationIds: string[] }>(`/activity/${encodeURIComponent(id)}/start`),
  markConversationAttentionRead: (id: string, read = true) =>
    patch<{ ok: boolean }>(`/conversations/${encodeURIComponent(id)}/attention`, { read }),

  // ── Live sessions ─────────────────────────────────────────────────────────
  liveSessions: () => get<LiveSessionMeta[]>('/live-sessions'),
  liveSession: (id: string) => get<LiveSessionMeta & { live: boolean }>(`/live-sessions/${id}`),
  liveSessionContext: (id: string) => get<LiveSessionContext>(`/live-sessions/${id}/context`),
  conversationBootstrap: (id: string, options?: {
    tailBlocks?: number;
    knownSessionSignature?: string;
    knownBlockOffset?: number;
    knownTotalBlocks?: number;
    knownLastBlockId?: string;
  }) => {
    const params = new URLSearchParams();
    if (typeof options?.tailBlocks === 'number' && Number.isInteger(options.tailBlocks) && options.tailBlocks > 0) {
      params.set('tailBlocks', String(options.tailBlocks));
    }
    if (typeof options?.knownSessionSignature === 'string' && options.knownSessionSignature.trim().length > 0) {
      params.set('knownSessionSignature', options.knownSessionSignature.trim());
    }
    if (typeof options?.knownBlockOffset === 'number' && Number.isInteger(options.knownBlockOffset) && options.knownBlockOffset >= 0) {
      params.set('knownBlockOffset', String(options.knownBlockOffset));
    }
    if (typeof options?.knownTotalBlocks === 'number' && Number.isInteger(options.knownTotalBlocks) && options.knownTotalBlocks >= 0) {
      params.set('knownTotalBlocks', String(options.knownTotalBlocks));
    }
    if (typeof options?.knownLastBlockId === 'string' && options.knownLastBlockId.trim().length > 0) {
      params.set('knownLastBlockId', options.knownLastBlockId.trim());
    }

    const query = params.toString();
    return get<ConversationBootstrapState>(`/conversations/${encodeURIComponent(id)}/bootstrap${query ? `?${query}` : ''}`);
  },
  conversationPlan: (id: string) => get<ConversationAutomationResponse>(`/conversations/${encodeURIComponent(id)}/plan`),
  updateConversationPlan: (id: string, input: {
    enabled?: boolean;
    items?: ConversationAutomationTemplateTodoItem[];
  }) => patch<ConversationAutomationResponse>(`/conversations/${encodeURIComponent(id)}/plan`, input),
  resetConversationPlanItem: (id: string, itemId: string, resume = false) =>
    post<ConversationAutomationResponse>(`/conversations/${encodeURIComponent(id)}/plan/items/${encodeURIComponent(itemId)}/reset`, { resume }),
  setConversationPlanItemStatus: (id: string, itemId: string, checked: boolean) =>
    post<ConversationAutomationResponse>(`/conversations/${encodeURIComponent(id)}/plan/items/${encodeURIComponent(itemId)}/status`, { checked }),
  conversationPlansWorkspace: () => get<ConversationAutomationWorkspaceState>('/conversation-plans/workspace'),
  conversationPlanLibrary: () => get<ConversationAutomationWorkflowPresetLibraryState>('/conversation-plans/library'),
  updateConversationPlanLibrary: (input: ConversationAutomationWorkflowPresetLibraryState) =>
    patch<ConversationAutomationWorkflowPresetLibraryState>('/conversation-plans/library', input),
  liveSessionContextUsage: (id: string) => get<SessionContextUsage>(`/live-sessions/${encodeURIComponent(id)}/context-usage`),
  conversationArtifacts: (id: string) => get<{ conversationId: string; artifacts: ConversationArtifactSummary[] }>(`/conversations/${encodeURIComponent(id)}/artifacts`),
  conversationArtifact: (id: string, artifactId: string) => get<{ conversationId: string; artifact: ConversationArtifactRecord }>(`/conversations/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}`),
  deleteConversationArtifact: (id: string, artifactId: string) =>
    fetch(buildApiPath(`/conversations/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}`), { method: 'DELETE' }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      return res.json() as Promise<{ conversationId: string; deleted: boolean; artifactId: string; artifacts: ConversationArtifactSummary[] }>;
    }),
  conversationAttachments: (id: string) =>
    get<{ conversationId: string; attachments: ConversationAttachmentSummary[] }>(`/conversations/${encodeURIComponent(id)}/attachments`),
  conversationAttachment: (id: string, attachmentId: string) =>
    get<{ conversationId: string; attachment: ConversationAttachmentRecord }>(`/conversations/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`),
  createConversationAttachment: (id: string, input: {
    kind?: 'excalidraw';
    title?: string;
    sourceData: string;
    sourceName?: string;
    sourceMimeType?: string;
    previewData: string;
    previewName?: string;
    previewMimeType?: string;
    note?: string;
  }) =>
    post<{
      conversationId: string;
      attachment: ConversationAttachmentRecord;
      attachments: ConversationAttachmentSummary[];
    }>(`/conversations/${encodeURIComponent(id)}/attachments`, input),
  updateConversationAttachment: (id: string, attachmentId: string, input: {
    title?: string;
    sourceData: string;
    sourceName?: string;
    sourceMimeType?: string;
    previewData: string;
    previewName?: string;
    previewMimeType?: string;
    note?: string;
  }) =>
    patch<{
      conversationId: string;
      attachment: ConversationAttachmentRecord;
      attachments: ConversationAttachmentSummary[];
    }>(`/conversations/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`, input),
  deleteConversationAttachment: (id: string, attachmentId: string) =>
    fetch(buildApiPath(`/conversations/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`), { method: 'DELETE' }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      return res.json() as Promise<{
        conversationId: string;
        deleted: boolean;
        attachmentId: string;
        attachments: ConversationAttachmentSummary[];
      }>;
    }),
  deferredResumes: (id: string) => get<{ conversationId: string; resumes: DeferredResumeSummary[] }>(`/conversations/${encodeURIComponent(id)}/deferred-resumes`),
  scheduleDeferredResume: (id: string, input: { delay: string; prompt?: string }) =>
    fetch(buildApiPath(`/conversations/${encodeURIComponent(id)}/deferred-resumes`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      return res.json() as Promise<{ conversationId: string; resume: DeferredResumeSummary; resumes: DeferredResumeSummary[] }>;
    }),
  fireDeferredResumeNow: (id: string, resumeId: string) =>
    fetch(buildApiPath(`/conversations/${encodeURIComponent(id)}/deferred-resumes/${encodeURIComponent(resumeId)}/fire`), { method: 'POST' }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      return res.json() as Promise<{ conversationId: string; resume: DeferredResumeSummary; resumes: DeferredResumeSummary[] }>;
    }),
  cancelDeferredResume: (id: string, resumeId: string) =>
    fetch(buildApiPath(`/conversations/${encodeURIComponent(id)}/deferred-resumes/${encodeURIComponent(resumeId)}`), { method: 'DELETE' }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      return res.json() as Promise<{ conversationId: string; cancelledId: string; resumes: DeferredResumeSummary[] }>;
    }),
  changeConversationCwd: (id: string, cwd: string, surfaceId?: string) =>
    fetch(buildApiPath(`/conversations/${encodeURIComponent(id)}/cwd`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd, ...(surfaceId ? { surfaceId } : {}) }),
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      return res.json() as Promise<ConversationCwdChangeResult>;
    }),
  renameConversation: (id: string, name: string, surfaceId?: string) =>
    patch<{ ok: boolean; title: string }>(`/conversations/${encodeURIComponent(id)}/title`, { name, ...(surfaceId ? { surfaceId } : {}) }),
  conversationModelPreferences: (id: string) =>
    get<{ currentModel: string; currentThinkingLevel: string }>(`/conversations/${encodeURIComponent(id)}/model-preferences`),
  updateConversationModelPreferences: (id: string, input: { model?: string | null; thinkingLevel?: string | null }, surfaceId?: string) =>
    patch<{ currentModel: string; currentThinkingLevel: string }>(`/conversations/${encodeURIComponent(id)}/model-preferences`, { ...input, ...(surfaceId ? { surfaceId } : {}) }),
  recoverConversation: (id: string) =>
    post<{
      conversationId: string;
      live: boolean;
      recovered: boolean;
      replayedPendingOperation: boolean;
      usedFallbackPrompt: boolean;
    }>(`/conversations/${encodeURIComponent(id)}/recover`),

  createLiveSession: (
    cwd?: string,
    text?: string,
    options?: { model?: string | null; thinkingLevel?: string | null },
  ) =>
    post<{ id: string; sessionFile: string }>('/live-sessions', {
      cwd,
      text,
      ...(options?.model !== undefined ? { model: options.model } : {}),
      ...(options?.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
    }),

  resumeSession: (sessionFile: string) =>
    post<{ id: string }>('/live-sessions/resume', { sessionFile }),

  promptSession: (
    id: string,
    text: string,
    behavior?: 'steer' | 'followUp',
    images?: PromptImageInput[],
    attachmentRefs?: PromptAttachmentRefInput[],
    surfaceId?: string,
  ) =>
    post<{ ok: boolean; accepted: boolean; delivery: 'started' | 'queued' }>(`/live-sessions/${id}/prompt`, {
      text,
      behavior,
      ...(surfaceId ? { surfaceId } : {}),
      images: images?.map((image) => ({
        type: 'image' as const,
        data: image.data,
        mimeType: image.mimeType,
        ...(image.name ? { name: image.name } : {}),
      })),
      attachmentRefs: attachmentRefs?.map((attachmentRef) => ({
        attachmentId: attachmentRef.attachmentId,
        ...(attachmentRef.revision ? { revision: attachmentRef.revision } : {}),
      })),
    }),
  restoreQueuedMessage: (
    id: string,
    input: { behavior: 'steer' | 'followUp'; index: number; previewId?: string },
    surfaceId?: string,
  ) =>
    post<{ ok: boolean; text: string; images: PromptImageInput[] }>(`/live-sessions/${id}/dequeue`, {
      ...input,
      ...(surfaceId ? { surfaceId } : {}),
    }),
  takeoverLiveSession: (id: string, surfaceId: string) =>
    post<LiveSessionPresenceState>(`/live-sessions/${id}/takeover`, { surfaceId }),
  compactSession: (id: string, customInstructions?: string, surfaceId?: string) =>
    post<{ ok: boolean; result: unknown }>(`/live-sessions/${id}/compact`, { customInstructions, ...(surfaceId ? { surfaceId } : {}) }),
  summarizeAndForkSession: (id: string, surfaceId?: string) =>
    post<{ newSessionId: string; sessionFile: string }>(`/live-sessions/${id}/summarize-fork`, surfaceId ? { surfaceId } : {}),
  reloadSession: (id: string, surfaceId?: string) =>
    post<{ ok: boolean }>(`/live-sessions/${id}/reload`, surfaceId ? { surfaceId } : {}),
  exportSession: (id: string, outputPath?: string) =>
    post<{ ok: boolean; path: string }>(`/live-sessions/${id}/export`, { outputPath }),
  renameSession: (id: string, name: string) =>
    patch<{ ok: boolean; name: string }>(`/live-sessions/${id}/name`, { name }),

  abortSession: (id: string, surfaceId?: string) =>
    post<{ ok: boolean }>(`/live-sessions/${id}/abort`, surfaceId ? { surfaceId } : {}),

  destroySession: (id: string, surfaceId?: string) => {
    const requestPath = buildApiPath(`/live-sessions/${id}`);
    return fetchWithRetry(requestPath, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(surfaceId ? { surfaceId } : {}),
    }).then(async (r) => {
      recordApiTiming(requestPath, r);
      if (!r.ok) {
        throw new Error(await readApiError(r));
      }
      return r.json() as Promise<{ ok: boolean }>;
    });
  },

  forkEntries: (id: string) =>
    get<{ entryId: string; text: string }[]>(`/live-sessions/${id}/fork-entries`),
  branchSession: (id: string, entryId: string, surfaceId?: string) =>
    post<{ newSessionId: string; sessionFile: string }>(`/live-sessions/${id}/branch`, { entryId, ...(surfaceId ? { surfaceId } : {}) }),
  forkSession: (id: string, entryId: string, options?: { preserveSource?: boolean }, surfaceId?: string) =>
    post<{ newSessionId: string; sessionFile: string }>(`/live-sessions/${id}/fork`, {
      entryId,
      preserveSource: options?.preserveSource,
      ...(surfaceId ? { surfaceId } : {}),
    }),
};
