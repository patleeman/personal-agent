import type { ActivityEntry, AppStatus, LiveSessionMeta, WorkstreamDetail, WorkstreamSummary } from './types';

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

export const api = {
  // ── Core ──────────────────────────────────────────────────────────────────
  status:         () => get<AppStatus>('/status'),
  activity:       () => get<ActivityEntry[]>('/activity'),
  activityById:   (id: string) => get<ActivityEntry>(`/activity/${encodeURIComponent(id)}`),
  workstreams:    () => get<WorkstreamSummary[]>('/workstreams'),
  workstreamById: (id: string) => get<WorkstreamDetail>(`/workstreams/${encodeURIComponent(id)}`),

  // ── Live sessions ─────────────────────────────────────────────────────────
  liveSessions: () => get<LiveSessionMeta[]>('/live-sessions'),
  liveSession:  (id: string) => get<LiveSessionMeta & { live: boolean }>(`/live-sessions/${id}`),

  createLiveSession: (cwd?: string) =>
    post<{ id: string; sessionFile: string }>('/live-sessions', { cwd }),

  resumeSession: (sessionFile: string) =>
    post<{ id: string }>('/live-sessions/resume', { sessionFile }),

  promptSession: (id: string, text: string, behavior?: 'steer' | 'followUp') =>
    post<{ ok: boolean }>(`/live-sessions/${id}/prompt`, { text, behavior }),

  abortSession: (id: string) =>
    post<{ ok: boolean }>(`/live-sessions/${id}/abort`),

  destroySession: (id: string) =>
    fetch(`/api/live-sessions/${id}`, { method: 'DELETE' }).then(r => r.json()),
};
