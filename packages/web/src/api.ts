import type { ActivityEntry, ApplicationRestartRequestResult, AppStatus, ConversationArtifactRecord, ConversationArtifactSummary, ConversationAttachmentRecord, ConversationAttachmentSummary, ConversationCwdChangeResult, ConversationProjectLinks, ConversationTitleSettingsState, ConversationTreeSnapshot, DaemonState, DeferredResumeSummary, DurableRunDetailResult, DurableRunListResult, FolderPickerResult, GatewayConfigUpdateInput, GatewayState, LiveSessionContext, LiveSessionMeta, McpCliServerDetail, McpCliToolDetail, MemoryData, MemoryDocDetail, MemoryDocItem, ModelState, PackageInstallResult, ProfileState, ProjectDetail, ProjectRecord, PromptAttachmentRefInput, PromptImageInput, ProviderAuthState, ProviderOAuthLoginState, ScheduledTaskDetail, ScheduledTaskSummary, SessionContextUsage, SessionDetail, SessionMeta, SyncState, ToolsState, WebUiState } from './types';

async function get<T>(path: string): Promise<T> {
  const res = await fetch('/api' + path);
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(await readApiError(res));
  return res.json() as Promise<T>;
}

async function del<T>(path: string): Promise<T> {
  const res = await fetch('/api' + path, { method: 'DELETE' });
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
  webUiState:   () => get<WebUiState>('/web-ui/state'),
  restartApplication: () => post<ApplicationRestartRequestResult>('/application/restart'),
  installWebUiService: () => post<WebUiState>('/web-ui/service/install'),
  startWebUiService: () => post<WebUiState>('/web-ui/service/start'),
  restartWebUiService: () => post<WebUiState>('/web-ui/service/restart'),
  rollbackWebUiService: (input?: { reason?: string }) => post<WebUiState>('/web-ui/service/rollback', input),
  markBadWebUiRelease: (input?: { slot?: 'blue' | 'green'; reason?: string }) => post<WebUiState>('/web-ui/service/mark-bad', input),
  stopWebUiService: () => post<WebUiState>('/web-ui/service/stop'),
  uninstallWebUiService: () => post<WebUiState>('/web-ui/service/uninstall'),
  setWebUiConfig: (input: { useTailscaleServe?: boolean; resumeFallbackPrompt?: string }) => patch<WebUiState>('/web-ui/config', input),
  activity:     () => get<ActivityEntry[]>('/activity'),
  activityById: (id: string) => get<ActivityEntry>(`/activity/${encodeURIComponent(id)}`),
  sessions:     () => get<SessionMeta[]>('/sessions'),
  sessionDetail: (id: string) => get<SessionDetail>(`/sessions/${encodeURIComponent(id)}`),
  sessionTree: (id: string) => get<ConversationTreeSnapshot>(`/sessions/${encodeURIComponent(id)}/tree`),
  sessionSearchIndex: (sessionIds: string[]) => post<{ index: Record<string, string> }>('/sessions/search-index', { sessionIds }),
  projects:     () => get<ProjectRecord[]>('/projects'),
  projectById:  (id: string) => get<ProjectDetail>(`/projects/${encodeURIComponent(id)}`),
  createProject: (input: {
    title: string;
    description: string;
    repoRoot?: string | null;
    summary?: string;
    status?: string;
    currentFocus?: string | null;
    blockers?: string[];
    recentProgress?: string[];
  }) => post<ProjectDetail>('/projects', input),
  updateProject: (id: string, patchBody: {
    title?: string;
    description?: string;
    repoRoot?: string | null;
    summary?: string;
    status?: string;
    currentFocus?: string | null;
    currentMilestoneId?: string | null;
    blockers?: string[];
    recentProgress?: string[];
  }) => patch<ProjectDetail>(`/projects/${encodeURIComponent(id)}`, patchBody),
  deleteProject: (id: string) =>
    del<{ ok: true; deletedProjectId: string }>(`/projects/${encodeURIComponent(id)}`),
  addProjectMilestone: (id: string, input: {
    title: string;
    status: string;
    summary?: string;
    makeCurrent?: boolean;
  }) => post<ProjectDetail>(`/projects/${encodeURIComponent(id)}/milestones`, input),
  updateProjectMilestone: (id: string, milestoneId: string, patchBody: {
    title?: string;
    status?: string;
    summary?: string | null;
    makeCurrent?: boolean;
  }) => patch<ProjectDetail>(`/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(milestoneId)}`, patchBody),
  deleteProjectMilestone: (id: string, milestoneId: string) =>
    del<ProjectDetail>(`/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(milestoneId)}`),
  moveProjectMilestone: (id: string, milestoneId: string, direction: 'up' | 'down') =>
    post<ProjectDetail>(`/projects/${encodeURIComponent(id)}/milestones/${encodeURIComponent(milestoneId)}/move`, { direction }),
  createProjectTask: (id: string, input: {
    title: string;
    status: string;
    milestoneId?: string | null;
  }) => post<ProjectDetail>(`/projects/${encodeURIComponent(id)}/tasks`, input),
  updateProjectTask: (id: string, taskId: string, patchBody: {
    title?: string;
    status?: string;
    milestoneId?: string | null;
  }) => patch<ProjectDetail>(`/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`, patchBody),
  deleteProjectTask: (id: string, taskId: string) =>
    del<ProjectDetail>(`/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}`),
  moveProjectTask: (id: string, taskId: string, direction: 'up' | 'down') =>
    post<ProjectDetail>(`/projects/${encodeURIComponent(id)}/tasks/${encodeURIComponent(taskId)}/move`, { direction }),
  projectSource: (id: string) => get<{ path: string; content: string }>(`/projects/${encodeURIComponent(id)}/source`),
  saveProjectSource: (id: string, content: string) => post<ProjectDetail>(`/projects/${encodeURIComponent(id)}/source`, { content }),
  saveProjectBrief: (id: string, content: string) => post<ProjectDetail>(`/projects/${encodeURIComponent(id)}/brief`, { content }),
  regenerateProjectBrief: (id: string) => post<ProjectDetail>(`/projects/${encodeURIComponent(id)}/brief/regenerate`, {}),
  createProjectNote: (id: string, input: { title: string; kind: string; body?: string }) => post<ProjectDetail>(`/projects/${encodeURIComponent(id)}/notes`, input),
  updateProjectNote: (id: string, noteId: string, input: { title?: string; kind?: string; body?: string }) =>
    patch<ProjectDetail>(`/projects/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`, input),
  deleteProjectNote: (id: string, noteId: string) =>
    del<ProjectDetail>(`/projects/${encodeURIComponent(id)}/notes/${encodeURIComponent(noteId)}`),
  uploadProjectFile: (id: string, input: {
    kind: 'attachment' | 'artifact';
    name: string;
    mimeType?: string;
    title?: string;
    description?: string;
    data: string;
  }) => post<ProjectDetail>(`/projects/${encodeURIComponent(id)}/files`, input),
  deleteProjectFile: (id: string, kind: 'attachment' | 'artifact', fileId: string) =>
    del<ProjectDetail>(`/projects/${encodeURIComponent(id)}/files/${kind}/${encodeURIComponent(fileId)}`),
  profiles:     () => get<ProfileState>('/profiles'),
  setCurrentProfile: (profile: string) => patch<{ ok: boolean; currentProfile: string }>('/profiles/current', { profile }),

  // ── Models ────────────────────────────────────────────────────────────────
  models: () => get<ModelState>('/models'),
  tools: () => get<ToolsState>('/tools'),
  installPackageSource: (input: { source: string; target: 'profile' | 'local'; profileName?: string }) =>
    post<PackageInstallResult>('/tools/packages/install', input),
  mcpCliServer: (server: string) => get<McpCliServerDetail>(`/tools/mcp/servers/${encodeURIComponent(server)}`),
  mcpCliTool: (server: string, tool: string) => get<McpCliToolDetail>(`/tools/mcp/servers/${encodeURIComponent(server)}/tools/${encodeURIComponent(tool)}`),
  setModel: (model: string) => patch<{ ok: boolean }>('/models/current', { model }),
  updateModelPreferences: (input: { model?: string; thinkingLevel?: string }) =>
    patch<{ ok: boolean }>('/models/current', input),
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
  openConversationTabs: () => get<{ sessionIds: string[]; pinnedSessionIds: string[] }>('/web-ui/open-conversations'),
  setOpenConversationTabs: (sessionIds: string[], pinnedSessionIds: string[] = []) =>
    patch<{ ok: boolean; sessionIds: string[]; pinnedSessionIds: string[] }>('/web-ui/open-conversations', { sessionIds, pinnedSessionIds }),

  // ── Tasks ─────────────────────────────────────────────────────────────────
  tasks: () => get<ScheduledTaskSummary[]>('/tasks'),
  taskDetail: (id: string) =>
    get<ScheduledTaskDetail>(`/tasks/${encodeURIComponent(id)}`),
  setTaskEnabled: (id: string, enabled: boolean) =>
    patch<{ ok: boolean }>(`/tasks/${encodeURIComponent(id)}`, { enabled }),
  taskLog: (id: string) =>
    get<{ log: string; path: string }>(`/tasks/${encodeURIComponent(id)}/log`),
  runTaskNow: (id: string) =>
    post<{ ok: boolean; accepted: boolean; runId: string }>(`/tasks/${encodeURIComponent(id)}/run`),
  runs: () => get<DurableRunListResult>('/runs'),
  durableRun: (id: string) => get<DurableRunDetailResult>(`/runs/${encodeURIComponent(id)}`),
  durableRunLog: (id: string, tail?: number) =>
    get<{ log: string; path: string }>(`/runs/${encodeURIComponent(id)}/log${tail ? `?tail=${encodeURIComponent(String(tail))}` : ''}`),
  cancelDurableRun: (id: string) => post<{ cancelled: boolean; runId: string }>(`/runs/${encodeURIComponent(id)}/cancel`),

  // ── Shell run ─────────────────────────────────────────────────────────────
  pickFolder: (cwd?: string) =>
    post<FolderPickerResult>('/folder-picker', { cwd }),
  run: (command: string, cwd?: string) =>
    post<{ output: string; exitCode: number }>('/run', { command, cwd }),

  // ── Memory browser ────────────────────────────────────────────────────────
  memory:         () => get<MemoryData>('/memory'),
  memoryFile:     (path: string) => get<{ content: string; path: string }>(`/memory/file?path=${encodeURIComponent(path)}`),
  memoryFileSave: (path: string, content: string) => post<{ ok: boolean }>('/memory/file', { path, content }),

  // ── Activity count ────────────────────────────────────────────────────────
  activityCount: () => get<{ count: number }>('/activity/count'),
  markActivityRead: (id: string, read = true) =>
    patch<{ ok: boolean }>(`/activity/${encodeURIComponent(id)}`, { read }),
  markConversationAttentionRead: (id: string, read = true) =>
    patch<{ ok: boolean }>(`/conversations/${encodeURIComponent(id)}/attention`, { read }),

  // ── Live sessions ─────────────────────────────────────────────────────────
  liveSessions: () => get<LiveSessionMeta[]>('/live-sessions'),
  liveSession: (id: string) => get<LiveSessionMeta & { live: boolean }>(`/live-sessions/${id}`),
  liveSessionContext: (id: string) => get<LiveSessionContext>(`/live-sessions/${id}/context`),
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
  cancelDeferredResume: (id: string, resumeId: string) =>
    fetch(`/api/conversations/${encodeURIComponent(id)}/deferred-resumes/${encodeURIComponent(resumeId)}`, { method: 'DELETE' }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      return res.json() as Promise<{ conversationId: string; cancelledId: string; resumes: DeferredResumeSummary[] }>;
    }),
  memories: () => get<{ memories: MemoryDocItem[] }>('/memories'),
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
  changeConversationCwd: (id: string, cwd: string) =>
    fetch(`/api/conversations/${encodeURIComponent(id)}/cwd`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd }),
    }).then(async (res) => {
      if (!res.ok) {
        throw new Error(await readApiError(res));
      }

      return res.json() as Promise<ConversationCwdChangeResult>;
    }),
  renameConversation: (id: string, name: string) =>
    patch<{ ok: boolean; title: string }>(`/conversations/${encodeURIComponent(id)}/title`, { name }),
  recoverConversation: (id: string) =>
    post<{
      conversationId: string;
      live: boolean;
      recovered: boolean;
      replayedPendingOperation: boolean;
      usedFallbackPrompt: boolean;
    }>(`/conversations/${encodeURIComponent(id)}/recover`),

  createLiveSession: (cwd?: string, referencedProjectIds?: string[], text?: string) =>
    post<{ id: string; sessionFile: string }>('/live-sessions', { cwd, referencedProjectIds, text }),

  resumeSession: (sessionFile: string) =>
    post<{ id: string }>('/live-sessions/resume', { sessionFile }),

  promptSession: (
    id: string,
    text: string,
    behavior?: 'steer' | 'followUp',
    images?: PromptImageInput[],
    attachmentRefs?: PromptAttachmentRefInput[],
  ) =>
    post<{ ok: boolean }>(`/live-sessions/${id}/prompt`, {
      text,
      behavior,
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
  restoreQueuedMessage: (id: string, input: { behavior: 'steer' | 'followUp'; index: number }) =>
    post<{ ok: boolean; text: string; images: PromptImageInput[] }>(`/live-sessions/${id}/dequeue`, input),
  compactSession: (id: string, customInstructions?: string) =>
    post<{ ok: boolean; result: unknown }>(`/live-sessions/${id}/compact`, { customInstructions }),
  reloadSession: (id: string) =>
    post<{ ok: boolean }>(`/live-sessions/${id}/reload`),
  exportSession: (id: string, outputPath?: string) =>
    post<{ ok: boolean; path: string }>(`/live-sessions/${id}/export`, { outputPath }),
  renameSession: (id: string, name: string) =>
    patch<{ ok: boolean; name: string }>(`/live-sessions/${id}/name`, { name }),

  abortSession: (id: string) =>
    post<{ ok: boolean }>(`/live-sessions/${id}/abort`),

  destroySession: (id: string) =>
    fetch(`/api/live-sessions/${id}`, { method: 'DELETE' }).then(r => r.json()),

  forkEntries: (id: string) =>
    get<{ entryId: string; text: string }[]>(`/live-sessions/${id}/fork-entries`),
  branchSession: (id: string, entryId: string) =>
    post<{ newSessionId: string; sessionFile: string }>(`/live-sessions/${id}/branch`, { entryId }),
  forkSession: (id: string, entryId: string, options?: { preserveSource?: boolean }) =>
    post<{ newSessionId: string; sessionFile: string }>(`/live-sessions/${id}/fork`, {
      entryId,
      preserveSource: options?.preserveSource,
    }),
};
