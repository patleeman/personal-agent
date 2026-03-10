import type { ActivityEntry, AppStatus, WorkstreamDetail, WorkstreamSummary } from './types';

async function get<T>(path: string): Promise<T> {
  const res = await fetch('/api' + path);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  status: () => get<AppStatus>('/status'),
  activity: () => get<ActivityEntry[]>('/activity'),
  activityById: (id: string) => get<ActivityEntry>(`/activity/${encodeURIComponent(id)}`),
  workstreams: () => get<WorkstreamSummary[]>('/workstreams'),
  workstreamById: (id: string) => get<WorkstreamDetail>(`/workstreams/${encodeURIComponent(id)}`),
};
