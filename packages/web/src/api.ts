import type { ActivityEntry, AppStatus, ConversationWorkstreamLinks, LiveSessionContext, LiveSessionMeta, MemoryData, ProfileState, ProjectDetail, ProjectSummary, PromptImageInput, SessionContextUsage, WorkstreamDetail, WorkstreamSummary } from './types';

async function get<T>(path: string): Promise<T> {
  const res = await fetch('/api' + path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

async function patch<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  // ── Core ──────────────────────────────────────────────────────────────────
  status:         () => get<AppStatus>('/status'),
  activity:       () => get<ActivityEntry[]>('/activity'),
  activityById:   (id: string) => get<ActivityEntry>(`/activity/${encodeURIComponent(id)}`),
  projects:       () => get<ProjectSummary[]>('/projects'),
  projectById:    (id: string) => get<ProjectDetail>(`/projects/${encodeURIComponent(id)}`),
  updateProject:  (id: string, body: {
    title?: string;
    status?: string;
    objective?: string;
    currentStatus?: string;
    blockers?: string;
    nextActions?: string;
    relatedConversationIds?: string[];
  }) => patch<ProjectSummary>(`/projects/${encodeURIComponent(id)}`, body),
  updateProjectPlan: (id: string, body: {
    objective?: string;
    steps?: Array<{ text: string; completed: boolean }>;
  }) => patch<ProjectDetail['plan']>(`/projects/${encodeURIComponent(id)}/plan`, body),
  createProjectTask: (projectId: string, body: {
    title: string;
    objective: string;
    status?: string;
    acceptanceCriteria?: string[];
    dependencies?: string[];
    notes?: string;
    relatedConversationIds?: string[];
  }) => post<ProjectDetail['tasks'][number]>(`/projects/${encodeURIComponent(projectId)}/tasks`, body),
  updateProjectTask: (projectId: string, taskId: string, body: {
    title?: string;
    objective?: string;
    status?: string;
    acceptanceCriteria?: string[];
    dependencies?: string[];
    notes?: string;
    relatedConversationIds?: string[];
  }) => patch<ProjectDetail['tasks'][number]>(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`, body),
  updateProjectTaskSummary: (projectId: string, taskId: string, body: {
    outcome?: string;
    summary?: string;
    criteriaValidation?: Array<{ criterion: string; status: 'pass' | 'fail' | 'pending'; evidence: string }>;
    keyChanges?: string[];
    artifacts?: string[];
    followUps?: string[];
  }) => patch<ProjectDetail['tasks'][number]['summary']>(`/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/summary`, body),
  workstreams:    () => get<WorkstreamSummary[]>('/workstreams'),
  workstreamById: (id: string) => get<WorkstreamDetail>(`/workstreams/${encodeURIComponent(id)}`),
  profiles:       () => get<ProfileState>('/profiles'),
  setCurrentProfile: (profile: string) => patch<{ ok: boolean; currentProfile: string }>('/profiles/current', { profile }),

  // ── Models ────────────────────────────────────────────────────────────────
  setModel:    (model: string) => patch<{ ok: boolean }>('/models/current', { model }),

  // ── Tasks ─────────────────────────────────────────────────────────────────
  setTaskEnabled: (id: string, enabled: boolean) =>
    patch<{ ok: boolean }>(`/tasks/${encodeURIComponent(id)}`, { enabled }),
  taskLog: (id: string) =>
    get<{ log: string; path: string }>(`/tasks/${encodeURIComponent(id)}/log`),
  runTaskNow: (id: string) =>
    post<{ ok: boolean; sessionId: string }>(`/tasks/${encodeURIComponent(id)}/run`),

  // ── Shell run ─────────────────────────────────────────────────────────────
  run: (command: string, cwd?: string) =>
    post<{ output: string; exitCode: number }>('/run', { command, cwd }),

  // ── Memory browser ────────────────────────────────────────────────────────
  memory:         () => get<MemoryData>('/memory'),
  memoryFile:     (path: string) => get<{ content: string; path: string }>(`/memory/file?path=${encodeURIComponent(path)}`),
  memoryFileSave: (path: string, content: string) => post<{ ok: boolean }>('/memory/file', { path, content }),

  // ── Activity count ────────────────────────────────────────────────────────
  activityCount:    () => get<{ count: number }>('/activity/count'),
  markActivityRead: (id: string, read = true) =>
    patch<{ ok: boolean }>(`/activity/${encodeURIComponent(id)}`, { read }),

  // ── Live sessions ─────────────────────────────────────────────────────────
  liveSessions: () => get<LiveSessionMeta[]>('/live-sessions'),
  liveSession:        (id: string) => get<LiveSessionMeta & { live: boolean }>(`/live-sessions/${id}`),
  liveSessionContext: (id: string) => get<LiveSessionContext>(`/live-sessions/${id}/context`),
  liveSessionContextUsage: (id: string) => get<SessionContextUsage>(`/live-sessions/${encodeURIComponent(id)}/context-usage`),
  conversationWorkstreams: (id: string) => get<ConversationWorkstreamLinks>(`/conversations/${encodeURIComponent(id)}/workstreams`),
  addConversationWorkstream: (id: string, workstreamId: string) =>
    post<ConversationWorkstreamLinks>(`/conversations/${encodeURIComponent(id)}/workstreams`, { workstreamId }),
  removeConversationWorkstream: (id: string, workstreamId: string) =>
    fetch(`/api/conversations/${encodeURIComponent(id)}/workstreams/${encodeURIComponent(workstreamId)}`, { method: 'DELETE' }).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<ConversationWorkstreamLinks>;
    }),

  createLiveSession: (cwd?: string) =>
    post<{ id: string; sessionFile: string }>('/live-sessions', { cwd }),

  resumeSession: (sessionFile: string) =>
    post<{ id: string }>('/live-sessions/resume', { sessionFile }),

  promptSession: (id: string, text: string, behavior?: 'steer' | 'followUp', images?: PromptImageInput[]) =>
    post<{ ok: boolean }>(`/live-sessions/${id}/prompt`, {
      text,
      behavior,
      images: images?.map((image) => ({
        type: 'image' as const,
        data: image.data,
        mimeType: image.mimeType,
        ...(image.name ? { name: image.name } : {}),
      })),
    }),
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
  forkSession: (id: string, entryId: string) =>
    post<{ newSessionId: string; sessionFile: string }>(`/live-sessions/${id}/fork`, { entryId }),
};
