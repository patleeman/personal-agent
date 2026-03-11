import type { ActivityEntry, AppStatus, ConversationProjectLinks, LiveSessionContext, LiveSessionMeta, MemoryData, ProfileState, ProjectDetail, ProjectSummary, PromptImageInput, SessionContextUsage } from './types';

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
  status:       () => get<AppStatus>('/status'),
  activity:     () => get<ActivityEntry[]>('/activity'),
  activityById: (id: string) => get<ActivityEntry>(`/activity/${encodeURIComponent(id)}`),
  projects:     () => get<ProjectSummary[]>('/projects'),
  projectById:  (id: string) => get<ProjectDetail>(`/projects/${encodeURIComponent(id)}`),
  profiles:     () => get<ProfileState>('/profiles'),
  setCurrentProfile: (profile: string) => patch<{ ok: boolean; currentProfile: string }>('/profiles/current', { profile }),

  // ── Models ────────────────────────────────────────────────────────────────
  setModel: (model: string) => patch<{ ok: boolean }>('/models/current', { model }),

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
  activityCount: () => get<{ count: number }>('/activity/count'),
  markActivityRead: (id: string, read = true) =>
    patch<{ ok: boolean }>(`/activity/${encodeURIComponent(id)}`, { read }),

  // ── Live sessions ─────────────────────────────────────────────────────────
  liveSessions: () => get<LiveSessionMeta[]>('/live-sessions'),
  liveSession: (id: string) => get<LiveSessionMeta & { live: boolean }>(`/live-sessions/${id}`),
  liveSessionContext: (id: string) => get<LiveSessionContext>(`/live-sessions/${id}/context`),
  liveSessionContextUsage: (id: string) => get<SessionContextUsage>(`/live-sessions/${encodeURIComponent(id)}/context-usage`),
  conversationProjects: (id: string) => get<ConversationProjectLinks>(`/conversations/${encodeURIComponent(id)}/projects`),
  addConversationProject: (id: string, projectId: string) =>
    post<ConversationProjectLinks>(`/conversations/${encodeURIComponent(id)}/projects`, { projectId }),
  removeConversationProject: (id: string, projectId: string) =>
    fetch(`/api/conversations/${encodeURIComponent(id)}/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' }).then(r => {
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      return r.json() as Promise<ConversationProjectLinks>;
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
