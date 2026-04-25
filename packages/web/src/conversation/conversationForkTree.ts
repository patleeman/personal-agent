import type { SessionMeta } from '../shared/types';

export interface ConversationForkTreeNode {
  session: SessionMeta;
  depth: number;
  childCount: number;
  isAncestor: boolean;
  isCurrent: boolean;
}

export interface ConversationForkTree {
  rootId: string;
  nodes: ConversationForkTreeNode[];
  relatedCount: number;
}

function compareSessionsForForkTree(left: SessionMeta, right: SessionMeta): number {
  const leftTime = left.lastActivityAt ?? left.timestamp;
  const rightTime = right.lastActivityAt ?? right.timestamp;
  const timeCompare = rightTime.localeCompare(leftTime);
  if (timeCompare !== 0) {
    return timeCompare;
  }

  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}

function findRootId(currentId: string, byId: Map<string, SessionMeta>): string {
  let rootId = currentId;
  const seen = new Set<string>();

  while (!seen.has(rootId)) {
    seen.add(rootId);
    const parentId = byId.get(rootId)?.parentSessionId;
    if (!parentId || !byId.has(parentId)) {
      return rootId;
    }
    rootId = parentId;
  }

  return currentId;
}

function buildAncestorIds(currentId: string, byId: Map<string, SessionMeta>): Set<string> {
  const ancestors = new Set<string>();
  let nextId: string | undefined = currentId;

  while (nextId && !ancestors.has(nextId)) {
    ancestors.add(nextId);
    nextId = byId.get(nextId)?.parentSessionId;
  }

  return ancestors;
}

export function buildConversationForkTree(
  sessions: SessionMeta[] | null | undefined,
  currentId: string | null | undefined,
): ConversationForkTree | null {
  if (!sessions || !currentId) {
    return null;
  }

  const byId = new Map(sessions.map((session) => [session.id, session]));
  const current = byId.get(currentId);
  if (!current) {
    return null;
  }

  const rootId = findRootId(currentId, byId);
  const childrenByParentId = new Map<string, SessionMeta[]>();
  for (const session of sessions) {
    if (!session.parentSessionId) {
      continue;
    }

    const children = childrenByParentId.get(session.parentSessionId) ?? [];
    children.push(session);
    childrenByParentId.set(session.parentSessionId, children);
  }

  for (const children of childrenByParentId.values()) {
    children.sort(compareSessionsForForkTree);
  }

  const ancestorIds = buildAncestorIds(currentId, byId);
  const nodes: ConversationForkTreeNode[] = [];
  const visited = new Set<string>();

  function visit(session: SessionMeta, depth: number) {
    if (visited.has(session.id)) {
      return;
    }

    visited.add(session.id);
    const children = childrenByParentId.get(session.id) ?? [];
    nodes.push({
      session,
      depth,
      childCount: children.length,
      isAncestor: ancestorIds.has(session.id) && session.id !== currentId,
      isCurrent: session.id === currentId,
    });

    for (const child of children) {
      visit(child, depth + 1);
    }
  }

  const root = byId.get(rootId);
  if (!root) {
    return null;
  }

  visit(root, 0);
  const relatedCount = nodes.length - 1;
  return relatedCount > 0 ? { rootId, nodes, relatedCount } : null;
}
