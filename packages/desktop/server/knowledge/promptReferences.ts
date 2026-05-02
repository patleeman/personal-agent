import { relative } from 'node:path';

import { loadUnifiedNodes, type UnifiedNodeRecord } from '@personal-agent/core';

export interface PromptReferenceTask {
  id: string;
  title?: string;
  filePath?: string;
  prompt: string;
  enabled: boolean;
  running: boolean;
  cron?: string;
  at?: string;
  model?: string;
  cwd?: string;
  lastStatus?: string;
}

export interface PromptReferenceMemoryDoc {
  id: string;
  title: string;
  summary: string;
  description?: string;
  tags?: string[];
  path: string;
  updated?: string;
}

export interface PromptReferenceSkill {
  name: string;
  source: string;
  description: string;
  path: string;
}

export interface ResolvedPromptReferences {
  projectIds: string[];
  taskIds: string[];
  memoryDocIds: string[];
  skillNames: string[];
}

export interface ExpandedPromptNodeGraphReferences {
  projectIds: string[];
  memoryDocIds: string[];
  skillNames: string[];
}

const MAX_RELATED_PROMPT_REFERENCES_PER_SEED = 20;

function appendUnique(target: string[], seen: Set<string>, value: string) {
  if (seen.has(value)) {
    return;
  }

  seen.add(value);
  target.push(value);
}

function toDisplayPath(repoRoot: string, path: string): string {
  const displayed = relative(repoRoot, path).replace(/\\/g, '/');
  if (!displayed || displayed.startsWith('..')) {
    return path;
  }

  return displayed;
}

const MENTION_REGEX = /@[A-Za-z0-9_][A-Za-z0-9_./-]*/g;
const TRAILING_MENTION_PUNCTUATION_REGEX = /[),.;:!?\]}>]+$/;

function normalizeMentionId(rawValue: string): string {
  return rawValue.replace(TRAILING_MENTION_PUNCTUATION_REGEX, '');
}

export function extractMentionIds(text: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null = null;

  while ((match = MENTION_REGEX.exec(text)) !== null) {
    const start = match.index;
    const previous = start > 0 ? text[start - 1] : '';
    if (start > 0 && /[\w./+-]/.test(previous)) {
      continue;
    }

    const id = normalizeMentionId(match[0].slice(1));
    if (!id) {
      continue;
    }

    appendUnique(result, seen, id);
  }

  return result;
}

export function resolvePromptReferences(input: {
  text: string;
  availableProjectIds: string[];
  tasks: PromptReferenceTask[];
  memoryDocs: PromptReferenceMemoryDoc[];
  skills: PromptReferenceSkill[];
}): ResolvedPromptReferences {
  const mentionIds = extractMentionIds(input.text);
  const projectIdSet = new Set(input.availableProjectIds);
  const taskIdSet = new Set(input.tasks.map((task) => task.id));
  const memoryDocIdSet = new Set(input.memoryDocs.map((doc) => doc.id));
  const skillNameSet = new Set(input.skills.map((skill) => skill.name));

  const projectIds: string[] = [];
  const taskIds: string[] = [];
  const memoryDocIds: string[] = [];
  const skillNames: string[] = [];
  const seenProjects = new Set<string>();
  const seenTasks = new Set<string>();
  const seenMemoryDocs = new Set<string>();
  const seenSkills = new Set<string>();

  for (const mentionId of mentionIds) {
    if (projectIdSet.has(mentionId)) {
      appendUnique(projectIds, seenProjects, mentionId);
    }
    if (taskIdSet.has(mentionId)) {
      appendUnique(taskIds, seenTasks, mentionId);
    }
    if (memoryDocIdSet.has(mentionId)) {
      appendUnique(memoryDocIds, seenMemoryDocs, mentionId);
    }
    if (skillNameSet.has(mentionId)) {
      appendUnique(skillNames, seenSkills, mentionId);
    }
  }

  return {
    projectIds,
    taskIds,
    memoryDocIds,
    skillNames,
  };
}

function resolveNodeReferenceKind(node: Pick<UnifiedNodeRecord, 'type' | 'kinds'>): 'project' | 'note' | 'skill' {
  if (node.type === 'project' || node.kinds.includes('project')) {
    return 'project';
  }
  if (node.type === 'skill' || node.kinds.includes('skill')) {
    return 'skill';
  }
  return 'note';
}

export function expandPromptReferencesWithNodeGraph(input: {
  projectIds: string[];
  memoryDocIds: string[];
  skillNames: string[];
  maxRelatedPerSeed?: number;
}): ExpandedPromptNodeGraphReferences {
  const loaded = loadUnifiedNodes();
  const nodesById = new Map(loaded.nodes.map((node) => [node.id, node] as const));
  const childrenByParent = new Map<string, string[]>();
  for (const node of loaded.nodes) {
    if (!node.links.parent) {
      continue;
    }
    const existing = childrenByParent.get(node.links.parent) ?? [];
    existing.push(node.id);
    childrenByParent.set(node.links.parent, existing);
  }

  const seedIds = [...new Set([...input.projectIds, ...input.memoryDocIds, ...input.skillNames])];
  const maxRelatedPerSeed =
    Number.isSafeInteger(input.maxRelatedPerSeed) && (input.maxRelatedPerSeed as number) >= 0
      ? Math.min(MAX_RELATED_PROMPT_REFERENCES_PER_SEED, input.maxRelatedPerSeed as number)
      : 2;
  const projectIds = [...input.projectIds];
  const memoryDocIds = [...input.memoryDocIds];
  const skillNames = [...input.skillNames];
  const seen = new Set(seedIds);

  for (const seedId of seedIds) {
    const node = nodesById.get(seedId);
    if (!node) {
      continue;
    }

    const candidateIds = [
      ...(node.links.parent ? [node.links.parent] : []),
      ...node.links.relationships.map((relationship) => relationship.targetId),
      ...(childrenByParent.get(seedId) ?? []),
    ];

    let added = 0;
    for (const candidateId of candidateIds) {
      if (!candidateId || seen.has(candidateId)) {
        continue;
      }

      const candidate = nodesById.get(candidateId);
      if (!candidate) {
        continue;
      }

      seen.add(candidateId);
      added += 1;
      const kind = resolveNodeReferenceKind(candidate);
      if (kind === 'project') {
        projectIds.push(candidateId);
      } else if (kind === 'skill') {
        skillNames.push(candidateId);
      } else {
        memoryDocIds.push(candidateId);
      }

      if (added >= maxRelatedPerSeed) {
        break;
      }
    }
  }

  return {
    projectIds,
    memoryDocIds,
    skillNames,
  };
}

export function pickPromptReferencesInOrder<T extends { id?: string; name?: string }>(ids: string[], items: T[]): T[] {
  const byId = new Map<string, T>();

  for (const item of items) {
    const key = item.id ?? item.name;
    if (!key) {
      continue;
    }

    byId.set(key, item);
  }

  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

export function buildReferencedTasksContext(tasks: PromptReferenceTask[], repoRoot: string): string {
  return [
    'Referenced scheduled tasks:',
    ...tasks.map((task) => {
      const lines = [`- @${task.id}`];

      if (task.title) {
        lines.push(`  title: ${task.title}`);
      }
      if (task.filePath) {
        lines.push(`  path: ${toDisplayPath(repoRoot, task.filePath)}`);
      }
      if (task.cron) {
        lines.push(`  cron: ${task.cron}`);
      }
      if (task.at) {
        lines.push(`  at: ${task.at}`);
      }
      if (task.model) {
        lines.push(`  model: ${task.model}`);
      }

      const statusParts = [task.enabled ? 'enabled' : 'disabled'];
      if (task.running) {
        statusParts.push('running');
      }
      if (task.lastStatus) {
        statusParts.push(`last status ${task.lastStatus}`);
      }
      lines.push(`  status: ${statusParts.join(', ')}`);

      if (task.prompt) {
        lines.push(`  prompt: ${task.prompt}`);
      }

      return lines.join('\n');
    }),
    'These are durable scheduled-task definitions. Read the task file before changing automation behavior, schedules, or runtime settings.',
  ].join('\n');
}

export function buildReferencedMemoryDocsContext(memoryDocs: PromptReferenceMemoryDoc[], repoRoot: string): string {
  return [
    'Referenced note nodes:',
    ...memoryDocs.map((doc) => {
      const lines = [`- @${doc.id}: ${doc.title}`, `  path: ${toDisplayPath(repoRoot, doc.path)}`];

      if (doc.summary) {
        lines.push(`  summary: ${doc.summary}`);
      }
      if (doc.description) {
        lines.push(`  description: ${doc.description}`);
      }
      if (doc.updated) {
        lines.push(`  updated: ${doc.updated}`);
      }

      return lines.join('\n');
    }),
    'These are durable note pages. Read the note markdown file when the user refers to that knowledge, asks for details, or wants the information updated.',
  ].join('\n');
}

export function buildReferencedSkillsContext(skills: PromptReferenceSkill[], repoRoot: string): string {
  return [
    'Referenced skills:',
    ...skills.map((skill) => {
      const lines = [`- @${skill.name}`, `  path: ${toDisplayPath(repoRoot, skill.path)}`, `  source: ${skill.source}`];

      if (skill.description) {
        lines.push(`  description: ${skill.description}`);
      }

      return lines.join('\n');
    }),
    'These are reusable workflow skills. Read the skill file when the user refers to that workflow, asks how it works, or wants it applied.',
  ].join('\n');
}
