import type { ActivityEntry, ApplicationRestartRequestResult, AppStatus, ConversationArtifactRecord, ConversationArtifactSummary, ConversationAttachmentRecord, ConversationAttachmentSummary, ConversationAutomationPreferencesState, ConversationAutomationResponse, ConversationAutomationTemplateTodoItem, ConversationAutomationWorkflowPresetLibraryState, ConversationAutomationWorkspaceState, ConversationCwdChangeResult, ConversationExecutionState, ConversationProjectLinks, ConversationTitleSettingsState, ConversationTreeSnapshot, DaemonState, DefaultCwdState, DeferredResumeSummary, DisplayBlock, DurableRunDetailResult, DurableRunListResult, ExecutionTargetPathMapping, ExecutionTargetsState, FolderPickerResult, GatewayConfigUpdateInput, GatewayState, LiveSessionContext, LiveSessionMeta, LiveSessionPresenceState, McpServerDetail, McpToolDetail, MemoryData, MemoryDocDetail, MemoryDocItem, MemoryWorkItem, ModelState, PackageInstallResult, ProfileState, ProjectDetail, ProjectDiagnostics, ProjectRecord, PromptAttachmentRefInput, PromptImageInput, ProviderAuthState, ProviderOAuthLoginState, RemoteConversationConnectionState, RemoteFolderListing, ScheduledTaskDetail, ScheduledTaskSummary, SessionContextUsage, SessionDetail, SessionMeta, SyncState, ToolsState, WebUiState, WorkspaceCommitDraftResult, WorkspaceFileDetail, WorkspaceGitCommitResult, WorkspaceGitDiffDetail, WorkspaceGitScope, WorkspaceGitStatusSummary, WorkspaceSnapshot } from './types';
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
  const res = await fetchWithRetry('/api' + path, { cache: 'no-store' });
  recordApiTiming('/api' + path, res);
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetchWithRetry('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  recordApiTiming('/api' + path, res);
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetchWithRetry('/api' + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  recordApiTiming('/api' + path, res);
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetchWithRetry('/api' + path, { method: 'DELETE' });
  recordApiTiming('/api' + path, res);
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

export const api = {
  // ── Core ──────────────────────────────────────────────────────────────────
  status:       () => get<AppStatus>('/status'),
  gateway:      () => get<GatewayState>('/gateway'),
  saveGatewayConfig: (input: GatewayConfigUpdateInput) => post<GatewayState>('/gateway/config', input),
  restartGateway: () => post<GatewayState>('/gateway/restart'),
  installGatewayService: () => post<GatewayState>('/gateway/service/install'),
  startGatewayService: () => post<GatewayState>('/gateway/service/start'),
  stopGatewayService: () => post<GatewayState>('/gateway/service/stop'),
  uninstallGatewayService: () => post<GatewayState>('/gateway/service/uninstall'),
  daemon:       () => get<DaemonState>('/daemon'),
  installDaemonService: () => post<DaemonState>('/daemon/service/install'),
  startDaemonService: () => post<DaemonState>('/daemon/service/start'),
  restartDaemonService: () => post<DaemonState>('/daemon/service/restart'),
  stopDaemonService: () => post<DaemonState>('/daemon/service/stop'),
  uninstallDaemonService: () => post<DaemonState>('/daemon/service/uninstall'),
  sync: () => get<SyncState>('/sync'),
  runSync: () => post<SyncState>('/sync/run'),
  setupSync: (input: {
    repoUrl: string;
    branch?: string;
    mode?: 'fresh' | 'bootstrap';
    repoDir?: string;
  }) => post<SyncState>('/sync/setup', input),
  webUiState:   () => get<WebUiState>('/web-ui/state'),
  restartApplication: () => post<ApplicationRestartRequestResult>('/application/restart'),
  updateApplication: () => post<ApplicationRestartRequestResult>('/application/update'),
  installWebUiService: () => post<WebUiState>('/web-ui/service/install'),
  startWebUiService: () => post<WebUiState>('/web-ui/service/start'),
  restartWebUiService: () => post<ApplicationRestartRequestResult>('/web-ui/service/restart'),
  rollbackWebUiService: (input?: { reason?: string }) => post<WebUiState>('/web-ui/service/rollback', input),
  markBadWebUiRelease: (input?: { slot?: 'blue' | 'green'; reason?: string }) => post<WebUiState>('/web-ui/service/mark-bad', input),
  stopWebUiService: () => post<WebUiState>('/web-ui/service/stop'),
  uninstallWebUiService: () => post<WebUiState>('/web-ui/service/uninstall'),
  setWebUiConfig: (input: { useTailscaleServe?: boolean; resumeFallbackPrompt?: string }) => patch<WebUiState>('/web-ui/config', input),
  activity:     () => get<ActivityEntry[]>('/activity'),
  activityById: (id: string) => get<ActivityEntry>(`/activity/${encodeURIComponent(id)}`),
  sessions:     () => get<SessionMeta[]>('/sessions'),
  sessionDetail: (id: string, options?: { tailBlocks?: number }) => {
    const params = new URLSearchParams();
    if (typeof options?.tailBlocks === 'number' && Number.isInteger(options.tailBlocks) && options.tailBlocks > 0) {
      params.set('tailBlocks', String(options.tailBlocks));
    }

    const query = params.toString();
    return get<SessionDetail>(`/sessions/${encodeURIComponent(id)}${query ? `?${query}` : ''}`);
  },
  sessionTree: (id: string) => get<ConversationTreeSnapshot>(`/sessions/${encodeURIComponent(id)}/tree`),
  sessionBlock: (id: string, blockId: string) => get<DisplayBlock>(`/sessions/${encodeURIComponent(id)}/blocks/${encodeURIComponent(blockId)}`),
  sessionSearchIndex: (sessionIds: string[]) => post<{ index: Record<string, string> }>('/sessions/search-index', { sessionIds }),
  projects:     (options?: { profile?: string }) => get<ProjectRecord[]>(withViewProfile('/projects', options?.profile)),
  projectDiagnostics: (options?: { profile?: string }) => get<ProjectDiagnostics>(withViewProfile('/projects/diagnostics', options?.profile)),
  projectById:  (id: string, options?: { profile?: string }) => get<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}`, options?.profile)),
  createProject: (input: {
    title: string;
    description: string;
    repoRoot?: string | null;
    summary?: string;
    goal?: string;
    acceptanceCriteria?: string[];
    planSummary?: string;
    completionSummary?: string | null;
    status?: string;
    currentFocus?: string | null;
    blockers?: string[];
    recentProgress?: string[];
  }, options?: { profile?: string }) => post<ProjectDetail>(withViewProfile('/projects', options?.profile), input),
  updateProject: (id: string, patchBody: {
    title?: string;
    description?: string;
    repoRoot?: string | null;
    summary?: string;
    goal?: string;
    acceptanceCriteria?: string[];
    planSummary?: string | null;
    completionSummary?: string | null;
    status?: string;
    currentFocus?: string | null;
    currentMilestoneId?: string | null;
    blockers?: string[];
    recentProgress?: string[];
  }, options?: { profile?: string }) => patch<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}`, options?.profile), patchBody),
  deleteProject: (id: string, options?: { profile?: string }) =>
    del<{ ok: true; deletedProjectId: string }>(withViewProfile(`/projects/${encodeURIComponent(id)}`, options?.profile)),
  archiveProject: (id: string, options?: { profile?: string }) => post<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/archive`, options?.profile)),
  unarchiveProject: (id: string, options?: { profile?: string }) => post<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/unarchive`, options?.profile)),
  addProjectMilestone: (id: string, input: {
    title: string;
    status: string;
    summary?: string;
    makeCurrent?: boolean;
  }, options?: { profile?: string }) => post<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/milestones`, options?.profile), input),
  updateProjectMilestone: (id: string, milestoneId: string, patchBody: {
    title?: string;
    status?: string;
    summary?: string | null;
    makeCurrent?: boolean;
  }, options?: { profile?: string }) => patch<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(milestoneId)}`, options?.profile), patchBody),
  deleteProjectMilestone: (id: string, milestoneId: string, options?: { profile?: string }) =>
    del<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(milestoneId)}`, options?.profile)),
  moveProjectMilestone: (id: string, milestoneId: string, direction: 'up' | 'down', options?: { profile?: string }) =>
    post<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(milestoneId)}/move`, options?.profile), { direction }),
  createProjectTask: (id: string, input: {
    title: string;
    status: string;
    milestoneId?: string | null;
  }, options?: { profile?: string }) => post<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/tasks`, options?.profile), input),
  updateProjectTask: (id: string, taskId: string, patchBody: {
    title?: string;
    status?: string;
    milestoneId?: string | null;
  }, options?: { profile?: string }) => patch<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`, options?.profile), patchBody),
  deleteProjectTask: (id: string, taskId: string, options?: { profile?: string }) =>
    del<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`, options?.profile)),
  moveProjectTask: (id: string, taskId: string, direction: 'up' | 'down', options?: { profile?: string }) =>
    post<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/move`, options?.profile), { direction }),
  projectSource: (id: string, options?: { profile?: string }) => get<{ path: string; content: string }>(withViewProfile(`/projects/${encodeURIComponent(id)}/source`, options?.profile)),
  saveProjectSource: (id: string, content: string, options?: { profile?: string }) => post<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/source`, options?.profile), { content }),
  saveProjectBrief: (id: string, content: string, options?: { profile?: string }) => post<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/brief`, options?.profile), { content }),
  regenerateProjectBrief: (id: string, options?: { profile?: string }) => post<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/brief/regenerate`, options?.profile), {}),
  createProjectNote: (id: string, input: { title: string; kind: string; body?: string }, options?: { profile?: string }) => post<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/notes`, options?.profile), input),
  updateProjectNote: (id: string, noteId: string, input: { title?: string; kind?: string; body?: string }, options?: { profile?: string }) =>
    patch<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, options?.profile), input),
  deleteProjectNote: (id: string, noteId: string, options?: { profile?: string }) =>
    del<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, options?.profile)),
  uploadProjectFile: (id: string, input: {
    kind: 'attachment' | 'artifact';
    name: string;
    mimeType?: string;
    title?: string;
    description?: string;
    data: string;
  }, options?: { profile?: string }) => post<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/files`, options?.profile), input),
  deleteProjectFile: (id: string, kind: 'attachment' | 'artifact', fileId: string, options?: { profile?: string }) =>
    del<ProjectDetail>(withViewProfile(`/projects/${encodeURIComponent(id)}/files/${kind}/${encodeURIComponent(fileId)}`, options?.profile)),
  profiles:     () => get<ProfileState>('/profiles'),
  setCurrentProfile: (profile: string) => patch<{ ok: boolean; currentProfile: string }>('/profiles/current', { profile }),

  // ── Models ────────────────────────────────────────────────────────────────
  models: () => get<ModelState>('/models'),
  defaultCwd: () => get<DefaultCwdState>('/default-cwd'),
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
  providerAuth: () => get<ProviderAuthState>('/provider-auth'),
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
  openConversationTabs: () => get<{ sessionIds: string[]; pinnedSessionIds: string[] }>('/web-ui/open-conversations'),
  setOpenConversationTabs: (sessionIds: string[], pinnedSessionIds: string[] = []) =>
    patch<{ ok: boolean; sessionIds: string[]; pinnedSessionIds: string[] }>('/web-ui/open-conversations', { sessionIds, pinnedSessionIds }),

  // ── Tasks ─────────────────────────────────────────────────────────────────
  tasks: () => get<ScheduledTaskSummary[]>('/tasks'),
  taskDetail: (id: string) =>
    get<ScheduledTaskDetail>(`/tasks/${encodeURIComponent(id)}`),
  createTask: (input: {
    taskId: string;
    enabled: boolean;
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
    enabled: boolean;
    cron?: string | null;
    at?: string | null;
    model?: string | null;
    cwd?: string | null;
    timeoutSeconds?: number | null;
    prompt: string;
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
  retryMemoryDistillRun: (id: string) => post<{ accepted: true; conversationId: string; runId: string; status: string }>(`/runs/${encodeURIComponent(id)}/memory-distill/retry`),
  recoverMemoryDistillRun: (id: string) => post<{ ok: true; runId: string; conversationId: string; sessionFile: string; cwd: string }>(`/runs/${encodeURIComponent(id)}/memory-distill/recover`),
  importRemoteRun: (id: string) => post<{ ok: true; runId: string; conversationId: string; summary: string; importedAt: string }>(`/runs/${encodeURIComponent(id)}/import`),
  remoteRunTranscriptUrl: (id: string) => `/api/runs/${encodeURIComponent(id)}/remote-transcript`,

  // ── Shell run ─────────────────────────────────────────────────────────────
  pickFolder: (cwd?: string) =>
    post<FolderPickerResult>('/folder-picker', { cwd }),
  browseRemoteFolder: (targetId: string, cwd?: string, baseCwd?: string) =>
    post<RemoteFolderListing>(`/execution-targets/${encodeURIComponent(targetId)}/folders`, { cwd, baseCwd }),
  run: (command: string, cwd?: string) =>
    post<{ output: string; exitCode: number }>('/run', { command, cwd }),
  workspaceSnapshot: (cwd?: string) =>
    get<WorkspaceSnapshot>(`/workspace${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  workspaceGitStatus: (cwd?: string) =>
    get<WorkspaceGitStatusSummary>(`/workspace/git-status${cwd ? `?cwd=${encodeURIComponent(cwd)}` : ''}`),
  workspaceGitDiff: (path: string, scope: WorkspaceGitScope, cwd?: string) => {
    const params = new URLSearchParams({ path, scope });
    if (cwd) {
      params.set('cwd', cwd);
    }
    return get<WorkspaceGitDiffDetail>(`/workspace/git-diff?${params.toString()}`);
  },
  workspaceGitStage: (path: string, cwd?: string) =>
    post<WorkspaceGitStatusSummary>('/workspace/git/stage', { path, cwd }),
  workspaceGitUnstage: (path: string, cwd?: string) =>
    post<WorkspaceGitStatusSummary>('/workspace/git/unstage', { path, cwd }),
  workspaceGitStageAll: (cwd?: string) =>
    post<WorkspaceGitStatusSummary>('/workspace/git/stage-all', { cwd }),
  workspaceGitUnstageAll: (cwd?: string) =>
    post<WorkspaceGitStatusSummary>('/workspace/git/unstage-all', { cwd }),
  workspaceGitDraftCommitMessage: (cwd?: string) =>
    post<WorkspaceCommitDraftResult>('/workspace/git/draft-commit-message', { cwd }),
  workspaceGitCommit: (message: string, cwd?: string) =>
    post<WorkspaceGitCommitResult>('/workspace/git/commit', { message, cwd }),
  workspaceFile: (path: string, cwd?: string) => {
    const params = new URLSearchParams({ path });
    if (cwd) {
      params.set('cwd', cwd);
    }
    return get<WorkspaceFileDetail>(`/workspace/file?${params.toString()}`);
  },
  workspaceFileSave: (path: string, content: string, cwd?: string) =>
    post<WorkspaceFileDetail>('/workspace/file', { path, content, cwd }),

  // ── Memory browser ────────────────────────────────────────────────────────
  memory:         (options?: { profile?: string }) => get<MemoryData>(withViewProfile('/memory', options?.profile)),
  memoryFile:     (path: string) => get<{ content: string; path: string }>(`/memory/file?path=${encodeURIComponent(path)}`),
  memoryFileSave: (path: string, content: string) => post<{ ok: boolean }>('/memory/file', { path, content }),

  // ── Activity count ────────────────────────────────────────────────────────
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
  executionTargets: () => get<ExecutionTargetsState>('/execution-targets'),
  createExecutionTarget: (input: {
    id: string;
    label: string;
    description?: string | null;
    sshDestination: string;
    sshCommand?: string | null;
    remotePaCommand?: string | null;
    profile?: string | null;
    defaultRemoteCwd?: string | null;
    commandPrefix?: string | null;
    cwdMappings?: ExecutionTargetPathMapping[];
  }) => post<ExecutionTargetsState>('/execution-targets', input),
  updateExecutionTarget: (id: string, input: {
    label: string;
    description?: string | null;
    sshDestination: string;
    sshCommand?: string | null;
    remotePaCommand?: string | null;
    profile?: string | null;
    defaultRemoteCwd?: string | null;
    commandPrefix?: string | null;
    cwdMappings?: ExecutionTargetPathMapping[];
  }) => patch<ExecutionTargetsState>(`/execution-targets/${encodeURIComponent(id)}`, input),
  deleteExecutionTarget: (id: string) => del<ExecutionTargetsState>(`/execution-targets/${encodeURIComponent(id)}`),
  remoteRuns: (input: {
    conversationId?: string;
    cwd?: string;
    referencedProjectIds?: string[];
    text: string;
    targetId: string;
  }) => post<{ accepted: true; conversationId: string; sessionFile: string; runId: string; remoteCwd: string; target: { id: string; label: string } }>(`/remote-runs`, input),
  conversationExecution: (id: string) => get<ConversationExecutionState>(`/conversations/${encodeURIComponent(id)}/execution`),
  remoteConversationConnection: (id: string) => get<RemoteConversationConnectionState>(`/conversations/${encodeURIComponent(id)}/remote-connection`),
  updateConversationExecution: (id: string, targetId: string | null, surfaceId?: string) => patch<ConversationExecutionState>(`/conversations/${encodeURIComponent(id)}/execution`, { targetId, ...(surfaceId ? { surfaceId } : {}) }),
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
    fetch(`/api/conversations/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(artifactId)}`, { method: 'DELETE' }).then(async (res) => {
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
    fetch(`/api/conversations/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`, { method: 'DELETE' }).then(async (res) => {
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
  conversationProjects: (id: string) => get<ConversationProjectLinks>(`/conversations/${encodeURIComponent(id)}/projects`),
  deferredResumes: (id: string) => get<{ conversationId: string; resumes: DeferredResumeSummary[] }>(`/conversations/${encodeURIComponent(id)}/deferred-resumes`),
  scheduleDeferredResume: (id: string, input: { delay: string; prompt?: string }) =>
    fetch(`/api/conversations/${encodeURIComponent(id)}/deferred-resumes`, {
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
    fetch(`/api/conversations/${encodeURIComponent(id)}/deferred-resumes/${encodeURIComponent(resumeId)}/fire`, { method: 'POST' }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      return res.json() as Promise<{ conversationId: string; resume: DeferredResumeSummary; resumes: DeferredResumeSummary[] }>;
    }),
  cancelDeferredResume: (id: string, resumeId: string) =>
    fetch(`/api/conversations/${encodeURIComponent(id)}/deferred-resumes/${encodeURIComponent(resumeId)}`, { method: 'DELETE' }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      return res.json() as Promise<{ conversationId: string; cancelledId: string; resumes: DeferredResumeSummary[] }>;
    }),
  memories: () => get<{ memories: MemoryDocItem[]; memoryQueue: MemoryWorkItem[] }>('/memories'),
  memoryDoc: (memoryId: string) =>
    get<MemoryDocDetail>(`/memories/${encodeURIComponent(memoryId)}`),
  saveMemoryDoc: (memoryId: string, content: string) =>
    post<MemoryDocDetail>(`/memories/${encodeURIComponent(memoryId)}`, { content }),
  deleteMemoryDoc: (memoryId: string) =>
    del<{ deleted: boolean; memoryId: string }>(`/memories/${encodeURIComponent(memoryId)}`),
  conversationMemoryDistillStatus: (id: string) =>
    get<{ conversationId: string; running: boolean; runId: string | null; status: string | null }>(`/conversations/${encodeURIComponent(id)}/memories/status`),
  createConversationMemory: (
    id: string,
    input: { title?: string; summary?: string; anchorMessageId?: string; tags?: string[] },
  ) =>
    post<{ conversationId: string; accepted: boolean; runId: string; running: boolean; status: string }>(`/conversations/${encodeURIComponent(id)}/memories`, input),
  startMemoryConversation: (memoryId: string, input?: { cwd?: string }) =>
    post<{ memoryId: string; id: string; sessionFile: string; cwd: string }>(`/memories/${encodeURIComponent(memoryId)}/start`, input ?? {}),
  addConversationProject: (id: string, projectId: string) =>
    post<ConversationProjectLinks>(`/conversations/${encodeURIComponent(id)}/projects`, { projectId }),
  removeConversationProject: (id: string, projectId: string) =>
    fetch(`/api/conversations/${encodeURIComponent(id)}/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<ConversationProjectLinks>;
    }),
  changeConversationCwd: (id: string, cwd: string, surfaceId?: string) =>
    fetch(`/api/conversations/${encodeURIComponent(id)}/cwd`, {
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
  recoverConversation: (id: string) =>
    post<{
      conversationId: string;
      live: boolean;
      recovered: boolean;
      replayedPendingOperation: boolean;
      usedFallbackPrompt: boolean;
    }>(`/conversations/${encodeURIComponent(id)}/recover`),

  createLiveSession: (cwd?: string, referencedProjectIds?: string[], text?: string, targetId?: string | null) =>
    post<{ id: string; sessionFile: string }>('/live-sessions', { cwd, referencedProjectIds, text, targetId }),

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
  restoreQueuedMessage: (id: string, input: { behavior: 'steer' | 'followUp'; index: number }, surfaceId?: string) =>
    post<{ ok: boolean; text: string; images: PromptImageInput[] }>(`/live-sessions/${id}/dequeue`, {
      ...input,
      ...(surfaceId ? { surfaceId } : {}),
    }),
  takeoverLiveSession: (id: string, surfaceId: string) =>
    post<LiveSessionPresenceState>(`/live-sessions/${id}/takeover`, { surfaceId }),
  compactSession: (id: string, customInstructions?: string, surfaceId?: string) =>
    post<{ ok: boolean; result: unknown }>(`/live-sessions/${id}/compact`, { customInstructions, ...(surfaceId ? { surfaceId } : {}) }),
  reloadSession: (id: string, surfaceId?: string) =>
    post<{ ok: boolean }>(`/live-sessions/${id}/reload`, surfaceId ? { surfaceId } : {}),
  exportSession: (id: string, outputPath?: string) =>
    post<{ ok: boolean; path: string }>(`/live-sessions/${id}/export`, { outputPath }),
  renameSession: (id: string, name: string) =>
    patch<{ ok: boolean; name: string }>(`/live-sessions/${id}/name`, { name }),

  abortSession: (id: string, surfaceId?: string) =>
    post<{ ok: boolean }>(`/live-sessions/${id}/abort`, surfaceId ? { surfaceId } : {}),

  destroySession: (id: string, surfaceId?: string) =>
    fetchWithRetry(`/api/live-sessions/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(surfaceId ? { surfaceId } : {}),
    }).then(async (r) => {
      recordApiTiming(`/api/live-sessions/${id}`, r);
      if (!r.ok) {
        throw new Error(await readApiError(r));
      }
      return r.json() as Promise<{ ok: boolean }>;
    }),

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
