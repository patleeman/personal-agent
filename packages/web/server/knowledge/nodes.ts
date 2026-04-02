import { findUnifiedNodeById, getProfilesRoot, loadUnifiedNodes, type UnifiedNodeRecord, type UnifiedNodeRelationship } from '@personal-agent/core';
import { listProjectIndex } from '../projects/projects.js';
import { listMemoryDocs, listSkillsForProfile } from './memoryDocs.js';

type NodeLinkKind = 'note' | 'project' | 'skill';

export interface NodeBrowserProjectMeta {
  profile?: string;
  repoRoot?: string;
  currentFocus?: string;
  taskCount: number;
  openTaskCount: number;
  doneTaskCount: number;
  archivedAt?: string;
}

export interface NodeBrowserSkillMeta {
  source: string;
  recentSessionCount?: number;
  lastUsedAt?: string | null;
  usedInLastSession?: boolean;
}

export interface NodeBrowserNoteMeta {
  referenceCount?: number;
  recentSessionCount?: number;
  lastUsedAt?: string | null;
  usedInLastSession?: boolean;
  type?: string;
  area?: string;
  role?: string;
}

export interface NodeBrowserSummary {
  kind: NodeLinkKind;
  kinds: string[];
  id: string;
  title: string;
  summary: string;
  description?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  path: string;
  tags: string[];
  profiles: string[];
  parent?: string;
  searchText: string;
  note?: NodeBrowserNoteMeta;
  project?: NodeBrowserProjectMeta;
  skill?: NodeBrowserSkillMeta;
}

export interface NodeBrowserData {
  profile: string;
  tagKeys: string[];
  nodes: NodeBrowserSummary[];
}

export interface NodeBrowserRelationship {
  type: string;
  node: {
    kind: NodeLinkKind;
    id: string;
    title: string;
    summary?: string;
  };
}

export interface NodeBrowserRelationshipSuggestion {
  node: {
    kind: NodeLinkKind;
    id: string;
    title: string;
    summary?: string;
  };
  score: number;
  reasons: string[];
}

export interface NodeBrowserDetail {
  node: NodeBrowserSummary;
  outgoingRelationships: NodeBrowserRelationship[];
  incomingRelationships: NodeBrowserRelationship[];
  suggestedNodes: NodeBrowserRelationshipSuggestion[];
}

function inferTagKeys(tags: string[]): string[] {
  return tags
    .map((tag) => tag.match(/^([^:]+):/)?.[1]?.trim().toLowerCase())
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(Array.from(values).map((value) => value.trim()).filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function resolveNodeKind(node: Pick<UnifiedNodeRecord, 'type' | 'kinds'>): NodeLinkKind {
  if (node.type === 'project' || node.kinds.includes('project')) {
    return 'project';
  }
  if (node.type === 'skill' || node.kinds.includes('skill')) {
    return 'skill';
  }
  return 'note';
}

function toNodeLinkKind(node: NodeBrowserSummary): NodeLinkKind {
  return node.kind;
}

function toLinkSummary(node: NodeBrowserSummary | UnifiedNodeRecord): { kind: NodeLinkKind; id: string; title: string; summary?: string } {
  if ('kind' in node) {
    return {
      kind: toNodeLinkKind(node),
      id: node.id,
      title: node.title,
      ...(node.summary ? { summary: node.summary } : {}),
    };
  }

  return {
    kind: resolveNodeKind(node),
    id: node.id,
    title: node.title,
    ...(node.summary ? { summary: node.summary } : {}),
  };
}

function summarizeRelationship(
  relationship: UnifiedNodeRelationship,
  nodesById: Map<string, NodeBrowserSummary>,
  allNodesById: Map<string, UnifiedNodeRecord>,
): NodeBrowserRelationship | null {
  const visible = nodesById.get(relationship.targetId);
  if (visible) {
    return {
      type: relationship.type,
      node: toLinkSummary(visible),
    };
  }

  const target = allNodesById.get(relationship.targetId);
  if (!target) {
    return null;
  }

  return {
    type: relationship.type,
    node: toLinkSummary(target),
  };
}

function interestingTagSet(tags: string[]): Set<string> {
  return new Set(tags.filter((tag) => !/^(status|profile|type|parent):/i.test(tag)).map((tag) => tag.toLowerCase()));
}

function tokenizeSuggestionText(node: NodeBrowserSummary): Set<string> {
  const text = [node.title, node.summary, node.description ?? '']
    .join(' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 4);
  return new Set(text);
}

function scoreNodeSuggestion(current: NodeBrowserSummary, candidate: NodeBrowserSummary): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const currentTags = interestingTagSet(current.tags);
  const candidateTags = interestingTagSet(candidate.tags);
  const sharedTags = [...currentTags].filter((tag) => candidateTags.has(tag));
  if (sharedTags.length > 0) {
    score += Math.min(4, sharedTags.length * 2);
    reasons.push(`shared tags: ${sharedTags.slice(0, 3).join(', ')}`);
  }

  const currentArea = current.tags.find((tag) => /^area:/i.test(tag));
  const candidateArea = candidate.tags.find((tag) => /^area:/i.test(tag));
  if (currentArea && candidateArea && currentArea.toLowerCase() === candidateArea.toLowerCase()) {
    score += 2;
    reasons.push(`same area: ${currentArea.replace(/^area:/i, '')}`);
  }

  if (current.parent && candidate.parent && current.parent === candidate.parent) {
    score += 2;
    reasons.push(`same parent: @${current.parent}`);
  } else if (current.parent && candidate.id === current.parent) {
    score += 2;
    reasons.push(`candidate is parent @${candidate.id}`);
  } else if (candidate.parent && candidate.parent === current.id) {
    score += 2;
    reasons.push(`candidate is child of @${current.id}`);
  }

  const currentTokens = tokenizeSuggestionText(current);
  const candidateTokens = tokenizeSuggestionText(candidate);
  const sharedTokens = [...currentTokens].filter((token) => candidateTokens.has(token));
  if (sharedTokens.length >= 2) {
    score += Math.min(4, sharedTokens.length);
    reasons.push(`overlapping terms: ${sharedTokens.slice(0, 3).join(', ')}`);
  }

  return { score, reasons };
}

export function listNodeBrowserData(profile: string): NodeBrowserData {
  const loaded = loadUnifiedNodes({ profilesRoot: getProfilesRoot() });
  const nodesById = new Map(loaded.nodes.map((node) => [node.id, node] as const));
  const memoryDocs = listMemoryDocs({ includeSearchText: true });
  const projects = listProjectIndex({ profile }).projects;
  const skills = listSkillsForProfile(profile);

  const summaries: NodeBrowserSummary[] = [];

  for (const memory of memoryDocs) {
    const node = nodesById.get(memory.id);
    if (!node) {
      continue;
    }

    summaries.push({
      kind: 'note',
      kinds: [...node.kinds],
      id: node.id,
      title: memory.title,
      summary: memory.summary ?? node.summary,
      ...(memory.description ? { description: memory.description } : {}),
      status: memory.status ?? node.status,
      createdAt: node.createdAt,
      updatedAt: memory.updated ?? node.updatedAt,
      path: memory.path,
      tags: [...node.tags],
      profiles: [...node.profiles],
      ...(memory.parent ? { parent: memory.parent } : {}),
      searchText: memory.searchText ?? node.searchText,
      note: {
        referenceCount: memory.referenceCount,
        recentSessionCount: memory.recentSessionCount,
        lastUsedAt: memory.lastUsedAt,
        usedInLastSession: memory.usedInLastSession,
        type: memory.type,
        area: memory.area,
        role: memory.role,
      },
    });
  }

  for (const project of projects) {
    const node = nodesById.get(project.id);
    if (!node) {
      continue;
    }

    const taskCount = project.plan.tasks.length;
    const doneTaskCount = project.plan.tasks.filter((task) => task.status === 'done' || task.status === 'completed').length;
    const openTaskCount = Math.max(0, taskCount - doneTaskCount);

    summaries.push({
      kind: 'project',
      kinds: [...node.kinds],
      id: project.id,
      title: project.title,
      summary: project.summary || project.description,
      ...(project.description ? { description: project.description } : {}),
      status: project.status,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      path: node.filePath,
      tags: [...node.tags],
      profiles: [...node.profiles],
      ...(node.links.parent ? { parent: node.links.parent } : {}),
      searchText: node.searchText,
      project: {
        profile,
        repoRoot: project.repoRoot,
        currentFocus: project.currentFocus,
        taskCount,
        openTaskCount,
        doneTaskCount,
        archivedAt: project.archivedAt,
      },
    });
  }

  for (const skill of skills) {
    const node = nodesById.get(skill.name);
    if (!node) {
      continue;
    }

    summaries.push({
      kind: 'skill',
      kinds: [...node.kinds],
      id: skill.name,
      title: node.title,
      summary: skill.description || node.summary,
      ...(node.description ? { description: node.description } : {}),
      status: node.status,
      createdAt: node.createdAt,
      updatedAt: node.updatedAt ?? skill.lastUsedAt ?? undefined,
      path: skill.path,
      tags: [...node.tags],
      profiles: [...node.profiles],
      ...(node.links.parent ? { parent: node.links.parent } : {}),
      searchText: node.searchText,
      skill: {
        source: skill.source,
        recentSessionCount: skill.recentSessionCount,
        lastUsedAt: skill.lastUsedAt,
        usedInLastSession: skill.usedInLastSession,
      },
    });
  }

  const tagKeys = uniqueSorted(summaries.flatMap((node) => inferTagKeys(node.tags)));

  summaries.sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '') || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));

  return {
    profile,
    tagKeys,
    nodes: summaries,
  };
}

export function readNodeBrowserDetail(profile: string, nodeId: string): NodeBrowserDetail {
  const browserData = listNodeBrowserData(profile);
  const allNodes = loadUnifiedNodes({ profilesRoot: getProfilesRoot() }).nodes;
  const allNodesById = new Map(allNodes.map((node) => [node.id, node] as const));
  const nodesById = new Map(browserData.nodes.map((node) => [node.id, node] as const));
  const current = nodesById.get(nodeId) ?? (() => {
    const fallback = allNodesById.get(nodeId);
    if (!fallback) {
      throw new Error(`Page not found: ${nodeId}`);
    }
    throw new Error(`Page @${nodeId} is not available in profile ${profile}.`);
  })();
  const currentRecord = findUnifiedNodeById(allNodes, nodeId);

  const outgoingRelationships = currentRecord.links.relationships
    .map((relationship) => summarizeRelationship(relationship, nodesById, allNodesById))
    .filter((relationship): relationship is NodeBrowserRelationship => relationship !== null)
    .sort((left, right) => left.type.localeCompare(right.type) || left.node.title.localeCompare(right.node.title) || left.node.id.localeCompare(right.node.id));

  const incomingRelationships = allNodes
    .flatMap((node) => node.links.relationships
      .filter((relationship) => relationship.targetId === currentRecord.id)
      .map((relationship) => ({ source: node, type: relationship.type })))
    .map((entry) => ({
      type: entry.type,
      node: toLinkSummary(nodesById.get(entry.source.id) ?? entry.source),
    }))
    .sort((left, right) => left.type.localeCompare(right.type) || left.node.title.localeCompare(right.node.title) || left.node.id.localeCompare(right.node.id));

  const excludedIds = new Set<string>([
    current.id,
    current.parent ?? '',
    ...currentRecord.links.related,
    ...outgoingRelationships.map((relationship) => relationship.node.id),
    ...incomingRelationships.map((relationship) => relationship.node.id),
  ]);

  const suggestedNodes = browserData.nodes
    .filter((candidate) => !excludedIds.has(candidate.id))
    .map((candidate) => ({ candidate, ...scoreNodeSuggestion(current, candidate) }))
    .filter((entry) => entry.score >= 4 && entry.reasons.length > 0)
    .sort((left, right) => right.score - left.score || left.candidate.title.localeCompare(right.candidate.title) || left.candidate.id.localeCompare(right.candidate.id))
    .slice(0, 6)
    .map((entry) => ({
      node: toLinkSummary(entry.candidate),
      score: entry.score,
      reasons: entry.reasons,
    }));

  return {
    node: current,
    outgoingRelationships,
    incomingRelationships,
    suggestedNodes,
  };
}
