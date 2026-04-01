import type { NodeBrowserSummary, NodeLinkKind } from './types';

export type NodeBrowserFilter = 'all' | NodeLinkKind;
export type NodeBrowserSort = 'updated_desc' | 'updated_asc' | 'created_desc' | 'created_asc' | 'title_asc' | 'title_desc' | 'status_asc';
export type NodeBrowserDateField = 'updated' | 'created';
export type NodeBrowserGroupBy = 'none' | 'kind' | 'status' | 'profile' | 'area' | `tag:${string}`;

export const NODE_FILTER_SEARCH_PARAM = 'type';
export const NODE_KIND_SEARCH_PARAM = 'kind';
export const NODE_ID_SEARCH_PARAM = 'node';
export const NODE_QUERY_SEARCH_PARAM = 'q';
export const NODE_SORT_SEARCH_PARAM = 'sort';
export const NODE_GROUP_SEARCH_PARAM = 'group';
export const NODE_DATE_FIELD_SEARCH_PARAM = 'dateField';
export const NODE_DATE_FROM_SEARCH_PARAM = 'from';
export const NODE_DATE_TO_SEARCH_PARAM = 'to';

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

function normalizeSort(value: string | null): NodeBrowserSort {
  switch (value?.trim()) {
    case 'updated_asc':
    case 'created_desc':
    case 'created_asc':
    case 'title_asc':
    case 'title_desc':
    case 'status_asc':
      return value;
    default:
      return 'updated_desc';
  }
}

function normalizeDateField(value: string | null): NodeBrowserDateField {
  return value?.trim() === 'created' ? 'created' : 'updated';
}

function isDateValue(value: string | null): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function normalizeGroupBy(value: string | null): NodeBrowserGroupBy {
  const normalized = value?.trim();
  if (!normalized) {
    return 'kind';
  }
  if (normalized === 'none' || normalized === 'kind' || normalized === 'status' || normalized === 'profile' || normalized === 'area') {
    return normalized;
  }
  if (normalized.startsWith('tag:') && normalized.slice(4).trim().length > 0) {
    return `tag:${normalized.slice(4).trim()}`;
  }
  return 'kind';
}

function extractTagValue(tags: string[], key: string): string | null {
  for (const tag of tags) {
    const match = tag.match(new RegExp(`^${key}:(.+)$`, 'i'));
    if (match?.[1]?.trim()) {
      return match[1].trim();
    }
  }
  return null;
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

export function readNodeBrowserQuery(search: string): string {
  const params = new URLSearchParams(search);
  return params.get(NODE_QUERY_SEARCH_PARAM)?.trim() ?? '';
}

export function readNodeBrowserSort(search: string): NodeBrowserSort {
  const params = new URLSearchParams(search);
  return normalizeSort(params.get(NODE_SORT_SEARCH_PARAM));
}

export function readNodeBrowserGroupBy(search: string): NodeBrowserGroupBy {
  const params = new URLSearchParams(search);
  return normalizeGroupBy(params.get(NODE_GROUP_SEARCH_PARAM));
}

export function readNodeBrowserDateField(search: string): NodeBrowserDateField {
  const params = new URLSearchParams(search);
  return normalizeDateField(params.get(NODE_DATE_FIELD_SEARCH_PARAM));
}

export function readNodeBrowserDateRange(search: string): { from: string | null; to: string | null } {
  const params = new URLSearchParams(search);
  return {
    from: isDateValue(params.get(NODE_DATE_FROM_SEARCH_PARAM)) ? params.get(NODE_DATE_FROM_SEARCH_PARAM)!.trim() : null,
    to: isDateValue(params.get(NODE_DATE_TO_SEARCH_PARAM)) ? params.get(NODE_DATE_TO_SEARCH_PARAM)!.trim() : null,
  };
}

export function buildNodesSearch(
  currentSearch: string,
  updates: {
    filter?: NodeBrowserFilter | null;
    kind?: NodeLinkKind | null;
    nodeId?: string | null;
    query?: string | null;
    sort?: NodeBrowserSort | null;
    groupBy?: NodeBrowserGroupBy | null;
    dateField?: NodeBrowserDateField | null;
    dateFrom?: string | null;
    dateTo?: string | null;
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

  if (updates.query !== undefined) {
    const normalizedQuery = updates.query?.trim();
    if (!normalizedQuery) {
      params.delete(NODE_QUERY_SEARCH_PARAM);
    } else {
      params.set(NODE_QUERY_SEARCH_PARAM, normalizedQuery);
    }
  }

  if (updates.sort !== undefined) {
    if (!updates.sort || updates.sort === 'updated_desc') {
      params.delete(NODE_SORT_SEARCH_PARAM);
    } else {
      params.set(NODE_SORT_SEARCH_PARAM, updates.sort);
    }
  }

  if (updates.groupBy !== undefined) {
    if (!updates.groupBy || updates.groupBy === 'kind') {
      params.delete(NODE_GROUP_SEARCH_PARAM);
    } else {
      params.set(NODE_GROUP_SEARCH_PARAM, updates.groupBy);
    }
  }

  if (updates.dateField !== undefined) {
    if (!updates.dateField || updates.dateField === 'updated') {
      params.delete(NODE_DATE_FIELD_SEARCH_PARAM);
    } else {
      params.set(NODE_DATE_FIELD_SEARCH_PARAM, updates.dateField);
    }
  }

  if (updates.dateFrom !== undefined) {
    if (!updates.dateFrom || !isDateValue(updates.dateFrom)) {
      params.delete(NODE_DATE_FROM_SEARCH_PARAM);
    } else {
      params.set(NODE_DATE_FROM_SEARCH_PARAM, updates.dateFrom);
    }
  }

  if (updates.dateTo !== undefined) {
    if (!updates.dateTo || !isDateValue(updates.dateTo)) {
      params.delete(NODE_DATE_TO_SEARCH_PARAM);
    } else {
      params.set(NODE_DATE_TO_SEARCH_PARAM, updates.dateTo);
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

function tokenizeQuery(query: string): string[] {
  const tokens: string[] = [];
  const normalized = query.trim();
  if (!normalized) {
    return tokens;
  }

  const regex = /\(|\)|"(?:\\.|[^"])*"(?:\s*~\d+)?|\S+/g;
  for (const match of normalized.matchAll(regex)) {
    tokens.push(match[0]);
  }
  return tokens;
}

function normalizePhraseToken(token: string): string {
  if (token.startsWith('"')) {
    return token.replace(/\s*~\d+$/, '').slice(1, -1);
  }
  return token;
}

type QueryPredicate = (node: NodeBrowserSummary) => boolean;

function buildTokenPredicate(token: string): QueryPredicate {
  const normalized = normalizePhraseToken(token).trim();
  if (!normalized) {
    return () => true;
  }

  const fieldMatch = normalized.match(/^([^:\s]+):(.*)$/);
  if (!fieldMatch) {
    const needle = normalized.toLowerCase();
    return (node) => node.searchText.includes(needle);
  }

  const field = fieldMatch[1]?.toLowerCase() ?? '';
  const rawValue = fieldMatch[2] ?? '';
  const wildcard = rawValue.endsWith('*');
  const value = (wildcard ? rawValue.slice(0, -1) : rawValue).toLowerCase();
  const matches = (candidate: string | undefined | null): boolean => {
    if (!candidate) return false;
    const normalizedCandidate = candidate.toLowerCase();
    return wildcard ? normalizedCandidate.startsWith(value) : normalizedCandidate === value;
  };

  return (node) => {
    switch (field) {
      case 'id':
        return matches(node.id);
      case 'title':
        return wildcard ? node.title.toLowerCase().includes(value) : node.title.toLowerCase() === value;
      case 'summary':
        return node.summary.toLowerCase().includes(value);
      case 'description':
        return node.description?.toLowerCase().includes(value) ?? false;
      case 'type':
      case 'kind':
        return node.kinds.some((kind) => matches(kind)) || matches(node.kind);
      case 'status':
        return matches(node.status) || Boolean(extractTagValue(node.tags, 'status') && matches(extractTagValue(node.tags, 'status')));
      case 'profile':
        return node.profiles.some((profile) => matches(profile));
      case 'parent':
        return matches(node.parent);
      case 'tag':
        return node.tags.some((tag) => wildcard ? tag.toLowerCase().startsWith(value) : tag.toLowerCase() === value);
      case 'area':
        return matches(extractTagValue(node.tags, 'area') ?? node.note?.area ?? null);
      default:
        return matches(extractTagValue(node.tags, field));
    }
  };
}

function parseQuery(tokens: string[]): QueryPredicate {
  let index = 0;

  function parseExpression(): QueryPredicate {
    let left = parseAndExpression();
    while (index < tokens.length && String(tokens[index]).toUpperCase() === 'OR') {
      index += 1;
      const right = parseAndExpression();
      const previous = left;
      left = (node) => previous(node) || right(node);
    }
    return left;
  }

  function parseAndExpression(): QueryPredicate {
    let left = parseFactor();
    while (index < tokens.length) {
      const token = String(tokens[index]).toUpperCase();
      if (token === 'OR' || token === ')') {
        break;
      }
      if (token === 'AND') {
        index += 1;
      }
      const right = parseFactor();
      const previous = left;
      left = (node) => previous(node) && right(node);
    }
    return left;
  }

  function parseFactor(): QueryPredicate {
    const token = tokens[index];
    if (!token) {
      return () => true;
    }
    if (String(token).toUpperCase() === 'NOT') {
      index += 1;
      const predicate = parseFactor();
      return (node) => !predicate(node);
    }
    if (token === '(') {
      index += 1;
      const predicate = parseExpression();
      if (tokens[index] === ')') {
        index += 1;
      }
      return predicate;
    }
    index += 1;
    return buildTokenPredicate(token);
  }

  return parseExpression();
}

export function matchesNodeBrowserQuery(node: NodeBrowserSummary, query: string): boolean {
  const normalized = query.trim();
  if (!normalized) {
    return true;
  }
  return parseQuery(tokenizeQuery(normalized))(node);
}

export function getNodeGroupValue(node: NodeBrowserSummary, groupBy: NodeBrowserGroupBy): string {
  switch (groupBy) {
    case 'none':
      return 'All nodes';
    case 'kind':
      return node.kind;
    case 'status':
      return node.status || 'unknown';
    case 'profile':
      return node.profiles[0] ?? 'shared';
    case 'area':
      return extractTagValue(node.tags, 'area') ?? node.note?.area ?? 'untagged';
    default:
      if (groupBy.startsWith('tag:')) {
        return extractTagValue(node.tags, groupBy.slice(4)) ?? 'untagged';
      }
      return 'All nodes';
  }
}
