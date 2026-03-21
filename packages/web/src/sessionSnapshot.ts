import { api } from './api';
import { applyLiveSessionState, buildSyntheticLiveSessionMeta } from './sessionIndicators';
import type { SessionMeta } from './types';

export async function fetchSessionsSnapshot(): Promise<SessionMeta[]> {
  const [sessions, liveSessions] = await Promise.all([api.sessions(), api.liveSessions()]);
  const knownSessionIds = new Set(sessions.map((session) => session.id));
  const syntheticLiveSessions: SessionMeta[] = liveSessions
    .filter((entry) => !knownSessionIds.has(entry.id))
    .map((entry) => buildSyntheticLiveSessionMeta(entry));

  return [...syntheticLiveSessions, ...applyLiveSessionState(sessions, liveSessions)];
}
