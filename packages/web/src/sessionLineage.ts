import type { DurableRunRecord, SessionMeta } from './types';

export interface SessionLineageRow {
  session: SessionMeta;
  depth: number;
  parentSessionId: string | null;
}

export interface SessionLineageAutoOpenResult {
  changed: boolean;
  nextKnownSessionIds: string[];
  nextPendingSessionIds: string[];
  nextOpenIds: string[];
  nextPinnedIds: string[];
}

function normalizeId(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function resolveSessionParentConversationId(
  session: SessionMeta,
  runsById: ReadonlyMap<string, DurableRunRecord>,
): string | null {
  const directParentId = normalizeId(session.parentSessionId);
  if (directParentId && directParentId !== session.id) {
    return directParentId;
  }

  const sourceRunId = normalizeId(session.sourceRunId);
  if (!sourceRunId) {
    return null;
  }

  const run = runsById.get(sourceRunId);
  if (!run || run.manifest?.kind !== 'background-run') {
    return null;
  }

  if (run.manifest.source?.type !== 'tool') {
    return null;
  }

  const conversationId = normalizeId(run.manifest.source.id);
  return conversationId && conversationId !== session.id ? conversationId : null;
}

export function buildNestedSessionRows(
  sessions: SessionMeta[],
  runsById: ReadonlyMap<string, DurableRunRecord>,
): SessionLineageRow[] {
  const rows: SessionLineageRow[] = [];
  const sessionsById = new Map(sessions.map((session) => [session.id, session] as const));
  const childrenByParentId = new Map<string, SessionMeta[]>();
  const visited = new Set<string>();

  for (const session of sessions) {
    const parentSessionId = resolveSessionParentConversationId(session, runsById);
    if (!parentSessionId || !sessionsById.has(parentSessionId)) {
      continue;
    }

    const children = childrenByParentId.get(parentSessionId);
    if (children) {
      children.push(session);
      continue;
    }

    childrenByParentId.set(parentSessionId, [session]);
  }

  function appendSession(session: SessionMeta, depth: number) {
    if (visited.has(session.id)) {
      return;
    }

    visited.add(session.id);
    const parentSessionId = resolveSessionParentConversationId(session, runsById);
    rows.push({
      session,
      depth,
      parentSessionId: parentSessionId && sessionsById.has(parentSessionId) ? parentSessionId : null,
    });

    for (const child of childrenByParentId.get(session.id) ?? []) {
      appendSession(child, depth + 1);
    }
  }

  for (const session of sessions) {
    const parentSessionId = resolveSessionParentConversationId(session, runsById);
    if (parentSessionId && sessionsById.has(parentSessionId)) {
      continue;
    }

    appendSession(session, 0);
  }

  for (const session of sessions) {
    appendSession(session, 0);
  }

  return rows;
}

export function resolveSessionLineageAutoOpen(params: {
  sessions: SessionMeta[];
  runsById: ReadonlyMap<string, DurableRunRecord>;
  openIds: string[];
  pinnedIds: string[];
  knownSessionIds: string[];
  pendingSessionIds: string[];
}): SessionLineageAutoOpenResult {
  const currentSessionIds = params.sessions.map((session) => session.id);
  const currentSessionIdSet = new Set(currentSessionIds);
  const knownSessionIdSet = new Set(params.knownSessionIds);
  const pendingSessionIdSet = new Set(params.pendingSessionIds.filter((sessionId) => currentSessionIdSet.has(sessionId)));
  const nextOpenIds = [...params.openIds];
  const nextPinnedIds = [...params.pinnedIds];
  const openIdSet = new Set(nextOpenIds);
  const pinnedIdSet = new Set(nextPinnedIds);

  for (const session of params.sessions) {
    if (!knownSessionIdSet.has(session.id)) {
      pendingSessionIdSet.add(session.id);
    }
  }

  for (const sessionId of [...pendingSessionIdSet]) {
    if (openIdSet.has(sessionId) || pinnedIdSet.has(sessionId)) {
      pendingSessionIdSet.delete(sessionId);
    }
  }

  for (const session of params.sessions) {
    if (!pendingSessionIdSet.has(session.id)) {
      continue;
    }

    const parentConversationId = resolveSessionParentConversationId(session, params.runsById);
    if (!parentConversationId || parentConversationId === session.id) {
      continue;
    }

    if (pinnedIdSet.has(parentConversationId)) {
      nextPinnedIds.push(session.id);
      pinnedIdSet.add(session.id);
      pendingSessionIdSet.delete(session.id);
      continue;
    }

    if (openIdSet.has(parentConversationId)) {
      nextOpenIds.push(session.id);
      openIdSet.add(session.id);
      pendingSessionIdSet.delete(session.id);
    }
  }

  const changed = nextOpenIds.length !== params.openIds.length || nextPinnedIds.length !== params.pinnedIds.length;

  return {
    changed,
    nextKnownSessionIds: currentSessionIds,
    nextPendingSessionIds: [...pendingSessionIdSet],
    nextOpenIds,
    nextPinnedIds,
  };
}
