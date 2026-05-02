import type { SessionMeta } from '../shared/types';

export function mergeSessionSnapshotPreservingOrder(
  previousSessions: readonly SessionMeta[] | null,
  nextSessions: readonly SessionMeta[],
): SessionMeta[] {
  if (!previousSessions || previousSessions.length === 0) {
    return [...nextSessions];
  }

  const nextSessionById = new Map(nextSessions.map((session) => [session.id, session]));
  const orderedSessions = previousSessions
    .map((session) => nextSessionById.get(session.id))
    .filter((session): session is SessionMeta => Boolean(session));
  const knownSessionIdSet = new Set(orderedSessions.map((session) => session.id));

  for (const session of nextSessions) {
    if (knownSessionIdSet.has(session.id)) {
      continue;
    }

    orderedSessions.push(session);
  }

  return orderedSessions;
}

export function replaceSessionMetaPreservingOrder(sessions: readonly SessionMeta[], nextSession: SessionMeta): SessionMeta[] {
  const existingIndex = sessions.findIndex((session) => session.id === nextSession.id);
  if (existingIndex === -1) {
    return [...sessions, nextSession];
  }

  if (sessions[existingIndex] === nextSession) {
    return sessions as SessionMeta[];
  }

  const nextSessions = [...sessions];
  nextSessions[existingIndex] = nextSession;
  return nextSessions;
}

export function removeSessionMetaPreservingOrder(sessions: readonly SessionMeta[], sessionId: string): SessionMeta[] {
  const existingIndex = sessions.findIndex((session) => session.id === sessionId);
  if (existingIndex === -1) {
    return sessions as SessionMeta[];
  }

  return [...sessions.slice(0, existingIndex), ...sessions.slice(existingIndex + 1)];
}
