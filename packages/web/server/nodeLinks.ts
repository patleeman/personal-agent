import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, normalize } from 'node:path';
import { listProjectIds, loadMemoryDocs, loadMemoryPackageReferences } from '@personal-agent/core';
import { resolveResourceProfile } from '@personal-agent/resources';
import { readProjectDetailFromProject, readProjectSource } from './projects.js';

export type NodeLinkKind = 'note' | 'project' | 'skill';

export interface NodeLinkSummary {
  kind: NodeLinkKind;
  id: string;
  title: string;
  summary?: string;
}

export interface NodeLinks {
  outgoing: NodeLinkSummary[];
  incoming: NodeLinkSummary[];
  unresolved: string[];
}

interface NodeReferenceTarget {
  id: string;
  kindHint?: NodeLinkKind;
}

interface NodeDocument {
  kind: NodeLinkKind;
  id: string;
  title: string;
  summary?: string;
  path: string;
  contentParts: string[];
  explicitTargets: NodeReferenceTarget[];
}

const EMPTY_NODE_LINKS: NodeLinks = {
  outgoing: [],
  incoming: [],
  unresolved: [],
};

function humanizeId(id: string): string {
  return id
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseFrontmatter(filePath: string): Record<string, unknown> {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      return {};
    }

    const result: Record<string, unknown> = {};
    const lines = (match[1] ?? '').split('\n');
    let index = 0;

    while (index < lines.length) {
      const line = lines[index] ?? '';
      const kv = line.match(/^([\w-]+):\s*(.*)$/);
      if (!kv) {
        index += 1;
        continue;
      }

      const key = kv[1] ?? '';
      const value = (kv[2] ?? '').trim();
      if (!key) {
        index += 1;
        continue;
      }

      if (value === '') {
        const items: string[] = [];
        index += 1;
        while (index < lines.length && /^\s+-\s+/.test(lines[index] ?? '')) {
          items.push(String(lines[index] ?? '').replace(/^\s+-\s+/, '').trim());
          index += 1;
        }
        result[key] = items;
        continue;
      }

      result[key] = value.replace(/^['"]|['"]$/g, '');
      index += 1;
    }

    return result;
  } catch {
    return {};
  }
}

function isSkillDefinitionFile(filePath: string): boolean {
  const fileName = basename(filePath);
  if (fileName === 'SKILL.md') {
    return true;
  }

  if (fileName !== 'INDEX.md') {
    return false;
  }

  const frontmatter = parseFrontmatter(filePath);
  const kind = typeof frontmatter.kind === 'string' ? frontmatter.kind.trim().toLowerCase() : '';
  if (kind === 'skill') {
    return true;
  }

  return typeof frontmatter.name === 'string' && typeof frontmatter.description === 'string';
}

function listSkillDefinitionFiles(skillDir: string): string[] {
  if (!existsSync(skillDir)) {
    return [];
  }

  const output: string[] = [];
  const stack = [normalize(skillDir)];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && isSkillDefinitionFile(fullPath)) {
        output.push(fullPath);
      }
    }
  }

  output.sort();
  return output;
}

function extractNodeReferenceIds(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const regex = /@[a-zA-Z0-9][a-zA-Z0-9-_]*/g;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0] ?? '';
    const start = match.index;
    const previous = start > 0 ? text[start - 1] : '';
    if (start > 0 && /[\w./+-]/.test(previous)) {
      continue;
    }

    const id = raw.slice(1);
    if (!id || seen.has(id)) {
      continue;
    }

    seen.add(id);
    ids.push(id);
  }

  return ids;
}

function uniqueTargets(targets: NodeReferenceTarget[]): NodeReferenceTarget[] {
  const seen = new Set<string>();
  const result: NodeReferenceTarget[] = [];

  for (const target of targets) {
    const key = `${target.kindHint ?? '*'}:${target.id}`;
    if (!target.id || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(target);
  }

  return result;
}

function sortNodeLinks(items: NodeLinkSummary[]): NodeLinkSummary[] {
  const kindOrder: Record<NodeLinkKind, number> = {
    project: 0,
    note: 1,
    skill: 2,
  };

  return [...items].sort((left, right) => {
    if (kindOrder[left.kind] !== kindOrder[right.kind]) {
      return kindOrder[left.kind] - kindOrder[right.kind];
    }

    return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
  });
}

export function buildNodeLinksFromDocuments(documents: NodeDocument[]): Map<string, NodeLinks> {
  const documentsByKey = new Map<string, NodeDocument>();
  const documentsById = new Map<string, NodeDocument[]>();

  for (const document of documents) {
    const key = `${document.kind}:${document.id}`;
    documentsByKey.set(key, document);
    const existing = documentsById.get(document.id) ?? [];
    existing.push(document);
    documentsById.set(document.id, existing);
  }

  const outgoingByKey = new Map<string, NodeLinkSummary[]>();
  const incomingByKey = new Map<string, NodeLinkSummary[]>();
  const unresolvedByKey = new Map<string, string[]>();

  for (const document of documents) {
    const sourceKey = `${document.kind}:${document.id}`;
    const outgoing: NodeLinkSummary[] = [];
    const unresolved: string[] = [];
    const seenOutgoing = new Set<string>();
    const seenUnresolved = new Set<string>();

    const explicitTargets = uniqueTargets(document.explicitTargets);
    const mentionTargets = uniqueTargets(document.contentParts.flatMap((content) => extractNodeReferenceIds(content)).map((id) => ({ id })));

    for (const target of [...explicitTargets, ...mentionTargets]) {
      const candidates = (documentsById.get(target.id) ?? [])
        .filter((candidate) => !target.kindHint || candidate.kind === target.kindHint);

      if (candidates.length === 1) {
        const candidate = candidates[0] as NodeDocument;
        const candidateKey = `${candidate.kind}:${candidate.id}`;
        if (candidateKey === sourceKey || seenOutgoing.has(candidateKey)) {
          continue;
        }

        seenOutgoing.add(candidateKey);
        outgoing.push({
          kind: candidate.kind,
          id: candidate.id,
          title: candidate.title,
          ...(candidate.summary ? { summary: candidate.summary } : {}),
        });
        continue;
      }

      if (!seenUnresolved.has(target.id)) {
        seenUnresolved.add(target.id);
        unresolved.push(target.id);
      }
    }

    outgoingByKey.set(sourceKey, sortNodeLinks(outgoing));
    unresolvedByKey.set(sourceKey, [...unresolved].sort((left, right) => left.localeCompare(right)));
  }

  for (const [sourceKey, outgoing] of outgoingByKey.entries()) {
    const source = documentsByKey.get(sourceKey);
    if (!source) {
      continue;
    }

    for (const target of outgoing) {
      const targetKey = `${target.kind}:${target.id}`;
      const incoming = incomingByKey.get(targetKey) ?? [];
      incoming.push({
        kind: source.kind,
        id: source.id,
        title: source.title,
        ...(source.summary ? { summary: source.summary } : {}),
      });
      incomingByKey.set(targetKey, sortNodeLinks(incoming));
    }
  }

  const result = new Map<string, NodeLinks>();
  for (const document of documents) {
    const key = `${document.kind}:${document.id}`;
    result.set(key, {
      outgoing: outgoingByKey.get(key) ?? [],
      incoming: incomingByKey.get(key) ?? [],
      unresolved: unresolvedByKey.get(key) ?? [],
    });
  }

  return result;
}

function readNoteDocuments(profilesRoot: string): NodeDocument[] {
  const loaded = loadMemoryDocs({ profilesRoot });

  return loaded.docs.map((doc) => {
    const references = loadMemoryPackageReferences(dirname(doc.filePath));
    return {
      kind: 'note' as const,
      id: doc.id,
      title: doc.title,
      summary: doc.summary,
      path: doc.filePath,
      contentParts: [
        readFileSync(doc.filePath, 'utf-8'),
        ...references.map((reference) => reference.body),
      ],
      explicitTargets: [
        ...(doc.parent ? [{ id: doc.parent, kindHint: 'note' as const }] : []),
        ...doc.related.map((id) => ({ id, kindHint: 'note' as const })),
      ],
    } satisfies NodeDocument;
  });
}

function readSkillDocuments(options: { repoRoot: string; profilesRoot: string; profile: string }): NodeDocument[] {
  const resolved = resolveResourceProfile(options.profile, {
    repoRoot: options.repoRoot,
    profilesRoot: options.profilesRoot,
  });
  const documents: NodeDocument[] = [];
  const seenPaths = new Set<string>();

  for (const dir of resolved.skillDirs) {
    for (const skillPath of listSkillDefinitionFiles(dir)) {
      const normalizedPath = normalize(skillPath);
      if (seenPaths.has(normalizedPath)) {
        continue;
      }
      seenPaths.add(normalizedPath);

      const frontmatter = parseFrontmatter(skillPath);
      const id = typeof frontmatter.id === 'string' && frontmatter.id.trim().length > 0
        ? frontmatter.id.trim()
        : (typeof frontmatter.name === 'string' && frontmatter.name.trim().length > 0
          ? frontmatter.name.trim()
          : basename(dirname(skillPath)));
      const title = typeof frontmatter.title === 'string' && frontmatter.title.trim().length > 0
        ? frontmatter.title.trim()
        : humanizeId(id);
      const summary = typeof frontmatter.summary === 'string' && frontmatter.summary.trim().length > 0
        ? frontmatter.summary.trim()
        : (typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '');

      documents.push({
        kind: 'skill',
        id,
        title,
        ...(summary ? { summary } : {}),
        path: skillPath,
        contentParts: [readFileSync(skillPath, 'utf-8')],
        explicitTargets: [],
      });
    }
  }

  return documents;
}

function buildProjectText(detail: ReturnType<typeof readProjectDetailFromProject>, rawState: string): string[] {
  const record = detail.project;

  return [
    rawState,
    record.title,
    record.description,
    record.summary,
    record.requirements.goal,
    ...record.requirements.acceptanceCriteria,
    record.planSummary ?? '',
    record.completionSummary ?? '',
    record.currentFocus ?? '',
    ...record.blockers,
    ...record.recentProgress,
    detail.brief?.content ?? '',
    ...detail.notes.map((note) => note.body),
  ].filter((value) => value.trim().length > 0);
}

function readProjectDocuments(options: { repoRoot: string; profile: string }): NodeDocument[] {
  return listProjectIds({ repoRoot: options.repoRoot, profile: options.profile }).flatMap((projectId) => {
    try {
      const detail = readProjectDetailFromProject({
        repoRoot: options.repoRoot,
        profile: options.profile,
        projectId,
      });
      const source = readProjectSource({
        repoRoot: options.repoRoot,
        profile: options.profile,
        projectId,
      });

      return [{
        kind: 'project' as const,
        id: detail.project.id,
        title: detail.project.title,
        summary: detail.project.summary || detail.project.description,
        path: source.path,
        contentParts: buildProjectText(detail, source.content),
        explicitTargets: [],
      } satisfies NodeDocument];
    } catch {
      return [];
    }
  });
}

function buildAllNodeDocuments(options: { repoRoot: string; profilesRoot: string; profile: string }): NodeDocument[] {
  return [
    ...readProjectDocuments({ repoRoot: options.repoRoot, profile: options.profile }),
    ...readNoteDocuments(options.profilesRoot),
    ...readSkillDocuments(options),
  ];
}

export function readNodeLinks(options: {
  repoRoot: string;
  profilesRoot: string;
  profile: string;
  kind: NodeLinkKind;
  id: string;
}): NodeLinks {
  const documents = buildAllNodeDocuments(options);
  const links = buildNodeLinksFromDocuments(documents).get(`${options.kind}:${options.id}`);
  return links ?? EMPTY_NODE_LINKS;
}
