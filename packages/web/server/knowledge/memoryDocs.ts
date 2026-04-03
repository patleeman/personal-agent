/**
 * Memory docs service
 *
 * Shared helpers for memory browsing and note operations.
 * Extracted from index.ts so route modules can use them.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import {
  createUnifiedNode,
  getDurableNotesDir,
  getDurableSkillsDir,
  getProfilesRoot,
  loadMemoryPackageReferences,
  loadUnifiedNodes,
} from '@personal-agent/core';
import { resolveResourceProfile } from '@personal-agent/resources';
import { parseDocument, stringify as stringifyYaml } from 'yaml';
import { readNodeLinks, type NodeLinks } from './nodeLinks.js';

// ── Memory path utilities ─────────────────────────────────────────────────────

export function normalizeMemoryPath(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    return normalize(value.trim());
  } catch {
    return '';
  }
}

export function isEditableMemoryFilePath(filePath: string, profile: string): boolean {
  if (!filePath || typeof filePath !== 'string') return false;
  const normalized = normalizeMemoryPath(filePath);
  if (!normalized) return false;

  const profilesRoot = getProfilesRoot();
  const sharedRoot = dirname(profilesRoot);
  const noteDir = normalizeMemoryPath(getDurableNotesDir(sharedRoot));
  const profileDir = normalizeMemoryPath(join(profilesRoot, profile));
  const legacyAgentDir = normalizeMemoryPath(join(profilesRoot, profile, 'agent'));
  const sharedSkillsDir = normalizeMemoryPath(getDurableSkillsDir(sharedRoot));

  return normalized.startsWith(`${noteDir}/`)
    || normalized.startsWith(`${profileDir}/`)
    || normalized.startsWith(`${legacyAgentDir}/`)
    || normalized.startsWith(`${sharedSkillsDir}/`);
}

// ── Memory docs ───────────────────────────────────────────────────────────────

interface MemoryDocFrontmatter {
  id?: string;
  title?: string;
  summary?: string;
  description?: string;
  updatedAt?: string;
  status?: string;
  [key: string]: unknown;
}

export interface MemoryDocItem {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  path: string;
  type?: string;
  status?: string;
  area?: string;
  role?: string;
  parent?: string;
  related?: string[];
  updated?: string;
  searchText?: string;
  referenceCount?: number;
  recentSessionCount?: number;
  lastUsedAt?: string | null;
  usedInLastSession?: boolean;
}

export interface MemoryReferenceItem {
  title: string;
  summary: string;
  path: string;
  relativePath: string;
  updated?: string;
}

export interface MemoryDocDetail {
  memory: MemoryDocItem;
  content: string;
  references: MemoryReferenceItem[];
  links?: NodeLinks;
}

function extractTagValue(tags: string[], key: string): string | undefined {
  return tags
    .map((tag) => tag.match(new RegExp(`^${key}:(.+)$`, 'i'))?.[1]?.trim())
    .find((value): value is string => typeof value === 'string' && value.length > 0);
}

function countReferenceFiles(dirPath: string): number {
  const referencesDir = join(dirPath, 'references');
  try {
    return loadMemoryPackageReferences(dirPath).length;
  } catch {
    return existsSync(referencesDir) ? 1 : 0;
  }
}

function mapLoadedMemoryDoc(doc: ReturnType<typeof loadUnifiedNodes>['nodes'][number], includeSearchText = false): MemoryDocItem {
  const searchText = includeSearchText ? doc.searchText : undefined;

  return {
    id: doc.id,
    title: doc.title,
    summary: doc.summary,
    description: doc.description,
    path: doc.filePath,
    type: extractTagValue(doc.tags, 'noteType') ?? doc.type,
    status: doc.status,
    area: extractTagValue(doc.tags, 'area'),
    role: extractTagValue(doc.tags, 'role') ?? extractTagValue(doc.tags, 'noteType'),
    parent: doc.links.parent,
    related: [...doc.links.related],
    updated: doc.updatedAt,
    ...(searchText ? { searchText } : {}),
    referenceCount: countReferenceFiles(doc.dirPath),
  };
}

function resolveMemoryDocsDir(): string {
  const profilesRoot = getProfilesRoot();
  return getDurableNotesDir(dirname(profilesRoot));
}

export function ensureMemoryDocsDir(): string {
  return resolveMemoryDocsDir();
}

export function clearMemoryBrowserCaches(): void {
}

export function warmMemoryBrowserCaches(profile: string): void {
  void listMemoryDocs();
  void listSkillsForProfile(profile);
}

export interface RecentReadUsageEntry {
  recentSessionCount: number;
  lastUsedAt: string | null;
  usedInLastSession: boolean;
}

export function buildRecentReadUsage(_paths: string[]): Map<string, RecentReadUsageEntry> {
  return new Map();
}

export function listMemoryDocs(options: { includeSearchText?: boolean } = {}): MemoryDocItem[] {
  const docs = loadUnifiedNodes({ profilesRoot: getProfilesRoot() }).nodes
    .filter((doc) => doc.kinds.includes('note') || (!doc.kinds.includes('project') && !doc.kinds.includes('skill')))
    .map((doc) => mapLoadedMemoryDoc(doc, options.includeSearchText === true));

  docs.sort((left, right) => {
    return String(right.updated ?? '').localeCompare(String(left.updated ?? ''))
      || left.title.localeCompare(right.title)
      || left.id.localeCompare(right.id);
  });

  return docs;
}

export function findMemoryDocById(
  memoryId: string,
  options: { includeSearchText?: boolean } = {},
): MemoryDocItem | null {
  return listMemoryDocs(options).find((doc) => doc.id === memoryId) ?? null;
}

// ── Skills ────────────────────────────────────────────────────────────────────

function inferSkillSource(filePath: string, profile: string): string {
  const profilesRoot = getProfilesRoot();
  const sharedRoot = dirname(profilesRoot);
  const profileSkillDir = normalizeMemoryPath(join(profilesRoot, profile, 'skills'));
  const profileLegacySkillDir = normalizeMemoryPath(join(profilesRoot, profile, 'agent', 'skills'));
  const profileLegacyHiddenSkillDir = normalizeMemoryPath(join(profilesRoot, profile, 'agent', '.skills'));
  const sharedSkillsDir = normalizeMemoryPath(getDurableSkillsDir(sharedRoot));
  const normalizedFilePath = normalizeMemoryPath(filePath);

  if (
    normalizedFilePath.startsWith(`${profileSkillDir}/`)
    || normalizedFilePath.startsWith(`${profileLegacySkillDir}/`)
    || normalizedFilePath.startsWith(`${profileLegacyHiddenSkillDir}/`)
  ) {
    return 'profile';
  }
  if (normalizedFilePath.startsWith(`${sharedSkillsDir}/`)) {
    return 'global';
  }
  return 'project';
}

function listSkillFiles(skillDir: string): string[] {
  if (!existsSync(skillDir)) return [];
  const candidates = [join(skillDir, 'INDEX.md'), join(skillDir, 'SKILL.md')];
  return candidates.filter((filePath) => existsSync(filePath));
}

function parseSkillFrontmatter(filePath: string): Record<string, unknown> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) {
      return {};
    }
    const document = parseDocument(match[1], { prettyErrors: true, uniqueKeys: true });
    if (document.errors.length > 0) {
      return {};
    }
    const parsed = document.toJS() as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function skillMatchesProfile(frontmatter: Record<string, unknown>, profile: string): boolean {
  const profiles = frontmatter.profiles;
  if (!Array.isArray(profiles) || profiles.length === 0) {
    return true;
  }

  return profiles.some((entry) => typeof entry === 'string' && entry.trim() === profile);
}

export interface SkillItem {
  name: string;
  source: string;
  description: string;
  path: string;
  recentSessionCount?: number;
  lastUsedAt?: string | null;
  usedInLastSession?: boolean;
}

export interface CreatedSkillDoc {
  name: string;
  title: string;
  description: string;
  body?: string;
  profile: string;
  force?: boolean;
}

export function listSkillsForProfile(profile: string): SkillItem[] {
  const profilesRoot = getProfilesRoot();
  const resolved = resolveResourceProfile(profile, {
    repoRoot: process.cwd(),
    profilesRoot,
  });

  const seenPaths = new Set<string>();
  const seenNames = new Set<string>();
  const skills: SkillItem[] = [];

  for (const skillDir of resolved.skillDirs) {
    for (const filePath of listSkillFiles(skillDir)) {
      const normalizedPath = normalizeMemoryPath(filePath);
      if (!normalizedPath || seenPaths.has(normalizedPath)) {
        continue;
      }
      seenPaths.add(normalizedPath);

      const frontmatter = parseSkillFrontmatter(filePath);
      if (!skillMatchesProfile(frontmatter, profile)) {
        continue;
      }

      const name = typeof frontmatter.id === 'string' && frontmatter.id.trim().length > 0
        ? frontmatter.id.trim()
        : (typeof frontmatter.name === 'string' && frontmatter.name.trim().length > 0
          ? frontmatter.name.trim()
          : normalizedPath.replace(/\\/g, '/').split('/').pop()?.replace(/\.md$/, '') ?? '');
      if (!name || seenNames.has(name)) {
        continue;
      }
      seenNames.add(name);

      const description = typeof frontmatter.summary === 'string' && frontmatter.summary.trim().length > 0
        ? frontmatter.summary.trim()
        : (typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '');

      skills.push({
        name,
        source: inferSkillSource(filePath, profile),
        description,
        path: filePath,
      });
    }
  }

  skills.sort((a, b) => a.name.localeCompare(b.name));
  return skills;
}

export function readSkillDetailForProfile(skillName: string, profile: string): SkillItem | null {
  return listSkillsForProfile(profile).find((skill) => skill.name === skillName) ?? null;
}

export function readSkillWorkspaceDetailForProfile(skillName: string, profile: string): {
  skill: SkillItem;
  content: string;
  references: Array<{
    title: string;
    summary?: string;
    path: string;
    relativePath: string;
    updated?: string;
  }>;
  links?: NodeLinks;
} | null {
  const skill = readSkillDetailForProfile(skillName, profile);
  if (!skill) {
    return null;
  }

  const content = readFileSync(skill.path, 'utf-8');
  const references = loadMemoryPackageReferences(dirname(skill.path)).map((reference) => ({
    title: reference.title,
    summary: reference.summary,
    path: reference.filePath,
    relativePath: reference.relativePath,
    updated: reference.updated,
  }));

  let links: NodeLinks | undefined;
  try {
    links = readNodeLinks({
      repoRoot: process.cwd(),
      profilesRoot: getProfilesRoot(),
      profile,
      kind: 'skill',
      id: skill.name,
    });
  } catch {
    links = undefined;
  }

  return {
    skill,
    content,
    references,
    ...(links ? { links } : {}),
  };
}

export function createSkillDoc(input: CreatedSkillDoc): SkillItem {
  const profile = input.profile.trim();
  const title = input.title.trim();
  const description = input.description.trim();
  const created = createUnifiedNode({
    id: input.name.trim().toLowerCase(),
    title,
    summary: description || `Skill for ${title}.`,
    body: input.body?.trim() || `# ${title}\n\n${description || `Use this skill for ${title}.`}`,
    tags: ['type:skill', `profile:${profile}`],
    force: input.force,
  }, {
    profilesRoot: getProfilesRoot(),
  });

  return {
    name: created.node.id,
    source: 'project',
    description: created.node.summary,
    path: created.node.filePath,
  };
}

// ── Notes ─────────────────────────────────────────────────────────────────────

const MAX_CREATED_NOTE_ID_LENGTH = 52;

export function normalizeCreatedNoteTitle(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeCreatedNoteSummary(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeCreatedNoteDescription(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function normalizeNoteBody(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r\n/g, '\n').trim();
}

export function extractNoteSummaryFromBody(content: string): string {
  for (const paragraph of content.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    const text = paragraph.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (text && !text.startsWith('#')) return text;
  }
  return '';
}

function parseNoteFrontmatter(rawContent: string): { frontmatter: Record<string, unknown>; body: string } {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: normalized.trim() };
  const document = parseDocument(match[1], { prettyErrors: true, uniqueKeys: true });
  if (document.errors.length > 0) throw new Error(document.errors[0]?.message ?? 'Invalid note frontmatter.');
  const parsed = document.toJS() as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Note frontmatter must be an object.');
  }
  return { frontmatter: parsed as Record<string, unknown>, body: (match[2] ?? '').replace(/^\n+/, '') };
}

function stringifyNoteMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const text = stringifyYaml(frontmatter, { lineWidth: 0, indent: 2, minContentWidth: 0 }).trimEnd();
  const normalizedBody = body.replace(/\r\n/g, '\n').trim();
  return `---\n${text}\n---\n\n${normalizedBody.length > 0 ? `${normalizedBody}\n` : ''}`;
}

export function buildStructuredNoteMarkdown(rawContent: string, input: {
  noteId: string;
  title: string;
  summary?: string;
  description?: string;
  descriptionProvided?: boolean;
  body: string;
}): string {
  const title = normalizeCreatedNoteTitle(input.title);
  if (title.length === 0) throw new Error('title required');

  const editableBody = normalizeNoteBody(input.body);
  const summary = normalizeCreatedNoteSummary(input.summary)
    || extractNoteSummaryFromBody(editableBody)
    || `Personal note about ${title}.`;
  const parsed = parseNoteFrontmatter(rawContent);
  const description = input.descriptionProvided
    ? normalizeCreatedNoteDescription(input.description)
    : normalizeCreatedNoteDescription(parsed.frontmatter.description as string);

  const existingTags = Array.isArray(parsed.frontmatter.tags)
    ? parsed.frontmatter.tags.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter((entry) => entry.length > 0)
    : [];
  const nextTags = [...new Set([
    ...existingTags.filter((tag) => !/^type:/i.test(tag) && !/^status:/i.test(tag)),
    'type:note',
    `status:${(typeof parsed.frontmatter.status === 'string' && parsed.frontmatter.status.trim().length > 0) ? parsed.frontmatter.status.trim() : 'active'}`,
  ])].sort((left, right) => left.localeCompare(right));

  const frontmatter: MemoryDocFrontmatter = {
    ...parsed.frontmatter,
    id: (typeof parsed.frontmatter.id === 'string' && parsed.frontmatter.id.trim().length > 0)
      ? parsed.frontmatter.id.trim()
      : input.noteId,
    title,
    summary,
    status: (typeof parsed.frontmatter.status === 'string' && parsed.frontmatter.status.trim().length > 0)
      ? parsed.frontmatter.status.trim()
      : 'active',
    updatedAt: new Date().toISOString(),
    tags: nextTags,
  };

  if (description) {
    frontmatter.description = description;
  } else {
    delete frontmatter.description;
  }

  const markdownBody = editableBody.length > 0 ? `# ${title}\n\n${editableBody}` : `# ${title}`;
  return stringifyNoteMarkdown(frontmatter, markdownBody);
}

function slugifyNoteId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-').slice(0, MAX_CREATED_NOTE_ID_LENGTH).replace(/-+$/g, '') || 'note';
}

export function generateCreatedNoteId(title: string): string {
  const existingIds = new Set(listMemoryDocs().map((doc) => doc.id));
  const base = slugifyNoteId(title);
  if (!existingIds.has(base)) return base;
  for (let i = 2; i < Number.MAX_SAFE_INTEGER; i += 1) {
    const suffix = `-${i}`;
    const candidate = `${base.slice(0, MAX_CREATED_NOTE_ID_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export interface CreatedMemoryDoc {
  id: string;
  filePath?: string;
  title: string;
  summary?: string;
  description?: string;
  status: string;
  type?: string;
  area?: string;
  role?: string;
  parent?: string;
  related?: string[];
  force?: boolean;
  updated?: string;
}

export function createMemoryDoc(input: CreatedMemoryDoc): CreatedMemoryDoc {
  const tags = [
    'type:note',
    ...(input.type ? [`noteType:${input.type}`] : []),
    ...(input.area ? [`area:${input.area}`] : []),
    ...(input.role ? [`role:${input.role}`] : []),
  ];
  const created = createUnifiedNode({
    id: input.id,
    title: input.title,
    summary: normalizeCreatedNoteSummary(input.summary) || `Personal note about ${normalizeCreatedNoteTitle(input.title) || input.id}.`,
    description: normalizeCreatedNoteDescription(input.description) || undefined,
    status: input.status,
    tags,
    parent: input.parent,
    related: input.related,
    force: input.force,
    updatedAt: input.updated,
  }, {
    profilesRoot: getProfilesRoot(),
  });

  return {
    id: created.node.id,
    filePath: created.node.filePath,
    title: created.node.title,
    summary: created.node.summary,
    description: created.node.description,
    status: created.node.status,
    type: created.node.type,
    area: extractTagValue(created.node.tags, 'area'),
    role: extractTagValue(created.node.tags, 'role') ?? extractTagValue(created.node.tags, 'noteType'),
    parent: created.node.links.parent,
    related: created.node.links.related,
    updated: created.node.updatedAt,
  };
}

export function readNoteDetail(memoryId: string, profile: string): MemoryDocDetail {
  const loaded = loadUnifiedNodes({ profilesRoot: getProfilesRoot() });
  const doc = loaded.nodes.find((entry) => entry.id === memoryId && (entry.kinds.includes('note') || (!entry.kinds.includes('project') && !entry.kinds.includes('skill'))));
  if (!doc) throw new Error('Note not found.');

  const content = readFileSync(doc.filePath, 'utf-8');
  const references = loadMemoryPackageReferences(doc.dirPath).map((reference) => ({
    title: reference.title,
    summary: reference.summary,
    path: reference.filePath,
    relativePath: reference.relativePath,
    updated: reference.updated,
  }));

  let links: NodeLinks | undefined;
  try {
    links = readNodeLinks({
      repoRoot: process.cwd(),
      profilesRoot: getProfilesRoot(),
      profile,
      kind: 'note',
      id: doc.id,
    });
  } catch {
    links = undefined;
  }

  return {
    memory: mapLoadedMemoryDoc(doc, true),
    content,
    references,
    ...(links ? { links } : {}),
  };
}
