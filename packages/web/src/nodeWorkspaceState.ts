import type { NodeLinkKind } from './types';

export type NodeBrowserFilter = 'all' | NodeLinkKind;

export const NODE_FILTER_SEARCH_PARAM = 'type';
export const NODE_KIND_SEARCH_PARAM = 'kind';
export const NODE_ID_SEARCH_PARAM = 'node';

function normalizeFilter(value: string | null): NodeBrowserFilter {
  switch (value?.trim()) {
    case 'note':
    case 'project':
    case 'skill':
      return value;
    default:
      return 'all';
  }
}

function normalizeNodeKind(value: string | null): NodeLinkKind | null {
  switch (value?.trim()) {
    case 'note':
    case 'project':
    case 'skill':
      return value;
    default:
      return null;
  }
}

export function readNodeBrowserFilter(search: string): NodeBrowserFilter {
  const params = new URLSearchParams(search);
  return normalizeFilter(params.get(NODE_FILTER_SEARCH_PARAM));
}

export function readSelectedNode(search: string): { kind: NodeLinkKind; id: string } | null {
  const params = new URLSearchParams(search);
  const kind = normalizeNodeKind(params.get(NODE_KIND_SEARCH_PARAM));
  const id = params.get(NODE_ID_SEARCH_PARAM)?.trim();
  if (!kind || !id) {
    return null;
  }

  return { kind, id };
}

export function buildNodesSearch(
  currentSearch: string,
  updates: {
    filter?: NodeBrowserFilter | null;
    kind?: NodeLinkKind | null;
    nodeId?: string | null;
  },
): string {
  const params = new URLSearchParams(currentSearch);

  if (updates.filter !== undefined) {
    if (!updates.filter || updates.filter === 'all') {
      params.delete(NODE_FILTER_SEARCH_PARAM);
    } else {
      params.set(NODE_FILTER_SEARCH_PARAM, updates.filter);
    }
  }

  if (updates.kind !== undefined) {
    if (!updates.kind) {
      params.delete(NODE_KIND_SEARCH_PARAM);
    } else {
      params.set(NODE_KIND_SEARCH_PARAM, updates.kind);
    }
  }

  if (updates.nodeId !== undefined) {
    const normalizedNodeId = updates.nodeId?.trim();
    if (!normalizedNodeId) {
      params.delete(NODE_ID_SEARCH_PARAM);
    } else {
      params.set(NODE_ID_SEARCH_PARAM, normalizedNodeId);
    }
  }

  const query = params.toString();
  return query ? `?${query}` : '';
}

export function buildNodesHref(kind: NodeLinkKind | null | undefined, nodeId: string | null | undefined, filter?: NodeBrowserFilter): string {
  return `/nodes${buildNodesSearch('', {
    ...(filter ? { filter } : {}),
    kind: kind ?? null,
    nodeId: nodeId ?? null,
  })}`;
}
