import { getProfilesRoot, loadUnifiedNodes } from '@personal-agent/core';
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

function inferTagKeys(tags: string[]): string[] {
  return tags
    .map((tag) => tag.match(/^([^:]+):/)?.[1]?.trim().toLowerCase())
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(Array.from(values).map((value) => value.trim()).filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
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
