import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { parseDocument, stringify } from 'yaml';
import { readProject, type ProjectDocument, type ProjectMilestoneDocument, type ProjectTaskDocument } from './project-artifacts.js';
import { migrateLegacyProfileMemoryDirs } from './memory-docs.js';
import { getDurableNodesDir, getDurableProfilesDir, getDurableProjectsDir, getDurableNotesDir, getDurableSkillsDir } from './runtime/paths.js';

const INDEX_FILE_NAME = 'INDEX.md';
const LEGACY_SKILL_FILE_NAMES = [INDEX_FILE_NAME, 'SKILL.md'] as const;
const FRONTMATTER_DELIMITER = '---';
const NODE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface ResolveNodesOptions {
  profilesRoot?: string;
}

export interface UnifiedNodeParseError {
  filePath: string;
  error: string;
}

export interface UnifiedNodeRelationship {
  type: string;
  targetId: string;
}

export interface UnifiedNodeLinkInfo {
  parent?: string;
  related: string[];
  conversations: string[];
  relationships: UnifiedNodeRelationship[];
}

export interface UnifiedNodeRecord {
  id: string;
  title: string;
  summary: string;
  description?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  type: string;
  kinds: string[];
  tags: string[];
  profiles: string[];
  parentTag?: string;
  links: UnifiedNodeLinkInfo;
  body: string;
  filePath: string;
  dirPath: string;
  searchText: string;
}

export interface LoadUnifiedNodesResult {
  nodesDir: string;
  nodes: UnifiedNodeRecord[];
  parseErrors: UnifiedNodeParseError[];
}

export interface CreateUnifiedNodeInput {
  id: string;
  title: string;
  summary: string;
  description?: string;
  status?: string;
  tags?: string[];
  parent?: string;
  related?: string[];
  relationships?: UnifiedNodeRelationship[];
  body?: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  force?: boolean;
}

export interface CreateUnifiedNodeResult {
  nodesDir: string;
  node: UnifiedNodeRecord;
  overwritten: boolean;
}

export interface UpdateUnifiedNodeInput {
  id: string;
  title?: string;
  summary?: string;
  description?: string | null;
  status?: string;
  addTags?: string[];
  removeTags?: string[];
  parent?: string | null;
  related?: string[];
  relationships?: UnifiedNodeRelationship[];
  body?: string;
}

export interface TagUnifiedNodeInput {
  id: string;
  add?: string[];
  remove?: string[];
}

export interface UnifiedNodeReferenceError {
  filePath: string;
  id: string;
  field: 'parent' | 'related';
  targetId: string;
  error: string;
}

export interface UnifiedNodeDuplicateId {
  id: string;
  files: string[];
}

export interface LintUnifiedNodesResult {
  nodesDir: string;
  checked: number;
  validNodes: number;
  parseErrors: UnifiedNodeParseError[];
  duplicateIds: UnifiedNodeDuplicateId[];
  referenceErrors: UnifiedNodeReferenceError[];
}

export interface LegacyNodeMigrationConflict {
  id: string;
  kinds: string[];
  sources: string[];
}

export interface LegacyNodeMigrationResult {
  nodesDir: string;
  created: string[];
  updated: string[];
  skipped: string[];
  conflicts: LegacyNodeMigrationConflict[];
}

interface FrontmatterSection {
  attributes: Record<string, unknown>;
  body: string;
}

interface LegacyNodeCandidate {
  id: string;
  sourceKind: 'note' | 'project' | 'skill';
  sourceDir: string;
  frontmatter: Record<string, unknown>;
  body: string;
  project?: ProjectDocument;
}

function resolveSyncRoot(options: ResolveNodesOptions = {}): string {
  return dirname(resolve(options.profilesRoot ?? getDurableProfilesDir()));
}

export function resolveUnifiedNodesDir(options: ResolveNodesOptions = {}): string {
  return getDurableNodesDir(resolveSyncRoot(options));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0))];
}

function normalizeTag(value: string): string {
  return value.trim();
}

function normalizeTags(values: string[] | undefined): string[] {
  return [...new Set((values ?? [])
    .map((value) => normalizeTag(String(value)))
    .filter((value) => value.length > 0))]
    .sort((left, right) => left.localeCompare(right));
}

function parseFrontmatterYaml(rawFrontmatter: string): Record<string, unknown> {
  const document = parseDocument(rawFrontmatter, {
    prettyErrors: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    throw new Error(document.errors[0]?.message ?? 'Invalid YAML frontmatter.');
  }

  const parsed = document.toJS({ mapAsMap: false }) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('YAML frontmatter must evaluate to an object.');
  }

  return parsed;
}

function splitFrontmatter(rawContent: string): FrontmatterSection {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines.length === 0 || lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new Error('Node markdown must start with YAML frontmatter.');
  }

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === FRONTMATTER_DELIMITER) {
      endIndex = index;
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error('Missing closing YAML frontmatter delimiter.');
  }

  return {
    attributes: parseFrontmatterYaml(lines.slice(1, endIndex).join('\n')),
    body: lines.slice(endIndex + 1).join('\n').trim(),
  };
}

function stringifyFrontmatter(frontmatter: Record<string, unknown>, body: string): string {
  const rendered = stringify(frontmatter, {
    lineWidth: 0,
    indent: 2,
    minContentWidth: 0,
  }).trimEnd();
  const normalizedBody = body.replace(/\r\n/g, '\n').trim();
  return `---\n${rendered}\n---\n\n${normalizedBody.length > 0 ? `${normalizedBody}\n` : ''}`;
}

function extractMarkdownTitle(body: string): string | undefined {
  const match = body.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() || undefined;
}

function extractFirstParagraph(body: string): string | undefined {
  const paragraphs = body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .filter((paragraph) => !paragraph.startsWith('#'));

  for (const paragraph of paragraphs) {
    const text = paragraph.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) {
      return text;
    }
  }

  return undefined;
}

function humanizeId(id: string): string {
  return id
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeRelationshipType(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : undefined;
}

function readRelationships(value: unknown): UnifiedNodeRelationship[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const relationships: UnifiedNodeRelationship[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    if (typeof entry === 'string') {
      const targetId = readOptionalString(entry)?.toLowerCase();
      if (!targetId) {
        continue;
      }
      const key = `related:${targetId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      relationships.push({ type: 'related', targetId });
      continue;
    }

    if (!isRecord(entry)) {
      continue;
    }

    const type = normalizeRelationshipType(entry.type);
    const targetId = readOptionalString(entry.target)?.toLowerCase() ?? readOptionalString(entry.id)?.toLowerCase();
    if (!type || !targetId) {
      continue;
    }

    const key = `${type}:${targetId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    relationships.push({ type, targetId });
  }

  return relationships.sort((left, right) => left.type.localeCompare(right.type) || left.targetId.localeCompare(right.targetId));
}

function readLinks(attributes: Record<string, unknown>): UnifiedNodeLinkInfo {
  const links = isRecord(attributes.links) ? attributes.links : {};
  const relationships = readRelationships(links.relationships);
  const related = dedupeStrings([
    ...readStringArray(links.related).map((value) => value.toLowerCase()),
    ...relationships.map((relationship) => relationship.targetId),
  ]);
  return {
    parent: readOptionalString(links.parent),
    related,
    conversations: readStringArray(links.conversations),
    relationships,
  };
}

function collectKindsFromTags(tags: string[], fallbackKind?: string): string[] {
  const kinds = tags
    .map((tag) => tag.match(/^type:(.+)$/i)?.[1]?.trim().toLowerCase())
    .filter((value): value is string => Boolean(value));
  if (kinds.length > 0) {
    return [...new Set(kinds)];
  }

  if (fallbackKind) {
    return [fallbackKind.toLowerCase()];
  }

  return ['note'];
}

function collectTagValues(tags: string[], key: string): string[] {
  return tags
    .map((tag) => tag.match(new RegExp(`^${key}:(.+)$`, 'i'))?.[1]?.trim())
    .filter((value): value is string => Boolean(value));
}

function hasTag(tags: string[], expected: string): boolean {
  return tags.some((tag) => tag.toLowerCase() === expected.toLowerCase());
}

function buildSearchText(node: {
  id: string;
  title: string;
  summary: string;
  description?: string;
  status: string;
  tags: string[];
  body: string;
  parent?: string;
  related: string[];
  relationships: UnifiedNodeRelationship[];
}): string {
  return [
    node.id,
    node.title,
    node.summary,
    node.description,
    node.status,
    ...node.tags,
    node.parent,
    ...node.related,
    ...node.relationships.flatMap((relationship) => [relationship.type, relationship.targetId]),
    node.body,
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join('\n')
    .toLowerCase();
}

function resolveNodeDirectoryPath(filePath: string): string {
  const fileName = basename(filePath).toLowerCase();
  if (fileName === INDEX_FILE_NAME.toLowerCase() || fileName === 'skill.md' || fileName === 'project.md') {
    return dirname(filePath);
  }

  const siblingDir = join(dirname(filePath), basename(filePath, '.md'));
  return existsSync(siblingDir) ? siblingDir : dirname(filePath);
}

function inferNodeId(filePath: string, attributes: Record<string, unknown>): string {
  const explicitId = readOptionalString(attributes.id);
  if (explicitId) {
    return explicitId.toLowerCase();
  }

  const fileName = basename(filePath).toLowerCase();
  if (fileName === INDEX_FILE_NAME.toLowerCase() || fileName === 'skill.md' || fileName === 'project.md') {
    return basename(dirname(filePath)).toLowerCase();
  }

  return basename(filePath, '.md').toLowerCase();
}

function parseUnifiedNode(filePath: string): UnifiedNodeRecord {
  const rawContent = readFileSync(filePath, 'utf-8');
  const section = splitFrontmatter(rawContent);
  const attributes = section.attributes;
  const id = inferNodeId(filePath, attributes);

  if (!NODE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid node id: ${id}`);
  }

  const metadata = isRecord(attributes.metadata) ? attributes.metadata : {};
  const metadataTags = [
    ...(readOptionalString(metadata.type) ? [`noteType:${readOptionalString(metadata.type)}`] : []),
    ...(readOptionalString(metadata.area) ? [`area:${readOptionalString(metadata.area)}`] : []),
    ...(readOptionalString(metadata.role) ? [`role:${readOptionalString(metadata.role)}`] : []),
  ];
  const tags = normalizeTags([
    ...readStringArray(attributes.tags),
    ...metadataTags,
  ]);
  const fallbackKind = (readOptionalString(attributes.kind) ?? readOptionalString(attributes.type))?.toLowerCase();
  const kinds = collectKindsFromTags(tags, fallbackKind);
  const type = kinds[0] ?? 'note';
  const links = readLinks(attributes);
  const parentTag = collectTagValues(tags, 'parent')[0] ?? links.parent;
  const title = readOptionalString(attributes.title) ?? extractMarkdownTitle(section.body) ?? humanizeId(id);
  const summary = readOptionalString(attributes.summary) ?? extractFirstParagraph(section.body) ?? `Durable node for ${title}.`;
  const description = readOptionalString(attributes.description);
  const explicitStatus = readOptionalString(attributes.status);
  const tagStatus = collectTagValues(tags, 'status')[0];
  const status = explicitStatus ?? tagStatus ?? 'active';
  const profiles = collectTagValues(tags, 'profile');
  const searchText = buildSearchText({
    id,
    title,
    summary,
    description,
    status,
    tags,
    body: section.body,
    parent: parentTag,
    related: links.related,
    relationships: links.relationships,
  });

  return {
    id,
    title,
    summary,
    ...(description ? { description } : {}),
    status,
    createdAt: readOptionalString(attributes.createdAt),
    updatedAt: readOptionalString(attributes.updatedAt) ?? readOptionalString(attributes.updated),
    createdBy: readOptionalString(attributes.createdBy),
    type,
    kinds,
    tags,
    profiles,
    ...(parentTag ? { parentTag } : {}),
    links: {
      ...links,
      ...(parentTag ? { parent: parentTag } : {}),
    },
    body: section.body,
    filePath,
    dirPath: resolveNodeDirectoryPath(filePath),
    searchText,
  };
}

function parseSkillNode(filePath: string): UnifiedNodeRecord {
  const rawContent = readFileSync(filePath, 'utf-8');
  const section = splitFrontmatter(rawContent);
  const attributes = section.attributes;
  const metadata = isRecord(attributes.metadata) ? attributes.metadata : {};
  const id = (readOptionalString(attributes.name) ?? basename(dirname(filePath))).toLowerCase();

  if (!NODE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid node id: ${id}`);
  }

  const title = readOptionalString(metadata.title) ?? humanizeId(id);
  const description = readOptionalString(attributes.description);
  const summary = readOptionalString(metadata.summary) ?? description ?? extractFirstParagraph(section.body) ?? `Skill package for ${title}.`;
  const status = readOptionalString(metadata.status) ?? 'active';
  const profiles = dedupeStrings([
    ...readStringArray(attributes.profiles).map((value) => value.toLowerCase()),
    ...(readOptionalString(metadata.profile) ? [readOptionalString(metadata.profile) as string] : []),
  ]);
  const tags = normalizeTags([
    'type:skill',
    ...(status ? [`status:${status}`] : []),
    ...profiles.map((profile) => `profile:${profile}`),
  ]);
  const searchText = buildSearchText({
    id,
    title,
    summary,
    description,
    status,
    tags,
    body: section.body,
    related: [],
    relationships: [],
  });

  return {
    id,
    title,
    summary,
    ...(description ? { description } : {}),
    status,
    createdAt: readOptionalString(metadata.createdAt),
    updatedAt: readOptionalString(metadata.updatedAt),
    createdBy: readOptionalString(metadata.createdBy),
    type: 'skill',
    kinds: ['skill'],
    tags,
    profiles,
    links: {
      related: [],
      conversations: [],
      relationships: [],
    },
    body: section.body,
    filePath,
    dirPath: dirname(filePath),
    searchText,
  };
}

function collectMarkdownFiles(rootDir: string, options: { excludeFileNames?: string[]; excludeDirs?: string[] } = {}): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const output: string[] = [];
  const excludedNames = new Set((options.excludeFileNames ?? []).map((value) => value.toLowerCase()));
  const excludedDirs = new Set((options.excludeDirs ?? []).map((value) => value.toLowerCase()));

  const walk = (dirPath: string): void => {
    for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
      const entryPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (excludedDirs.has(entry.name.toLowerCase())) {
          continue;
        }
        walk(entryPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) {
        continue;
      }
      if (excludedNames.has(entry.name.toLowerCase())) {
        continue;
      }
      output.push(entryPath);
    }
  };

  walk(rootDir);
  return output.sort((left, right) => left.localeCompare(right));
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

type QueryPredicate = (node: UnifiedNodeRecord) => boolean;

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
  const matches = (candidate: string | undefined): boolean => {
    if (!candidate) {
      return false;
    }
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
        return wildcard ? node.summary.toLowerCase().includes(value) : node.summary.toLowerCase().includes(value);
      case 'description':
        return wildcard ? (node.description?.toLowerCase().includes(value) ?? false) : (node.description?.toLowerCase().includes(value) ?? false);
      case 'type':
        return node.kinds.some((kind) => matches(kind));
      case 'status':
        return matches(node.status) || hasTag(node.tags, `status:${rawValue}`);
      case 'profile':
      case 'host':
      case 'cwd':
      case 'parent':
        return collectTagValues(node.tags, field).some((candidate) => matches(candidate)) || (field === 'parent' && matches(node.links.parent));
      case 'tag':
        return node.tags.some((tag) => wildcard ? tag.toLowerCase().startsWith(value) : tag.toLowerCase() === value);
      default:
        return node.tags.some((tag) => {
          const prefix = `${field}:`;
          if (!tag.toLowerCase().startsWith(prefix)) {
            return false;
          }
          const candidate = tag.slice(prefix.length);
          return matches(candidate);
        });
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

export function matchesUnifiedNodeQuery(node: UnifiedNodeRecord, query: string | undefined): boolean {
  const normalized = query?.trim();
  if (!normalized) {
    return true;
  }

  const predicate = parseQuery(tokenizeQuery(normalized));
  return predicate(node);
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length > 0))];
}

function normalizeRelationships(relationships: UnifiedNodeRelationship[] | undefined): UnifiedNodeRelationship[] {
  const seen = new Set<string>();
  const normalized: UnifiedNodeRelationship[] = [];

  for (const relationship of relationships ?? []) {
    const type = normalizeRelationshipType(relationship.type);
    const targetId = readOptionalString(relationship.targetId)?.toLowerCase();
    if (!type || !targetId) {
      continue;
    }

    const key = `${type}:${targetId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push({ type, targetId });
  }

  return normalized.sort((left, right) => left.type.localeCompare(right.type) || left.targetId.localeCompare(right.targetId));
}

function buildNodeFrontmatter(input: {
  id: string;
  title: string;
  summary: string;
  description?: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
  tags: string[];
  parent?: string;
  related?: string[];
  relationships?: UnifiedNodeRelationship[];
}): Record<string, unknown> {
  const relationships = normalizeRelationships(input.relationships);
  const related = dedupeStrings([
    ...(input.related ?? []),
    ...relationships.map((relationship) => relationship.targetId),
  ]);
  const tags = normalizeTags([
    ...input.tags,
    ...(input.parent ? [`parent:${input.parent}`] : []),
    ...(input.status ? [`status:${input.status}`] : []),
  ]);

  const links: Record<string, unknown> = {
    ...(input.parent ? { parent: input.parent } : {}),
    ...(related.length > 0 ? { related } : {}),
    ...(relationships.length > 0
      ? {
        relationships: relationships.map((relationship) => ({
          type: relationship.type,
          target: relationship.targetId,
        })),
      }
      : {}),
  };

  return {
    id: input.id,
    title: input.title,
    summary: input.summary,
    ...(input.description ? { description: input.description } : {}),
    status: input.status,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    ...(input.createdBy ? { createdBy: input.createdBy } : {}),
    tags,
    ...(Object.keys(links).length > 0 ? { links } : {}),
  };
}

function writeUnifiedNode(targetPath: string, frontmatter: Record<string, unknown>, body: string): UnifiedNodeRecord {
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, stringifyFrontmatter(frontmatter, body), 'utf-8');
  return parseUnifiedNode(targetPath);
}

function writeSkillNode(targetPath: string, input: {
  id: string;
  title: string;
  summary: string;
  description?: string;
  status: string;
  profiles: string[];
  body: string;
  createdAt?: string;
  updatedAt?: string;
  createdBy?: string;
}): UnifiedNodeRecord {
  mkdirSync(dirname(targetPath), { recursive: true });
  const frontmatter: Record<string, unknown> = {
    name: input.id,
    description: input.description ?? input.summary,
    ...(input.profiles.length > 0 ? { profiles: input.profiles } : {}),
    metadata: {
      title: input.title,
      summary: input.summary,
      status: input.status,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      ...(input.profiles[0] ? { profile: input.profiles[0] } : {}),
    },
  };
  writeFileSync(targetPath, stringifyFrontmatter(frontmatter, input.body), 'utf-8');
  return parseSkillNode(targetPath);
}

export function validateUnifiedNodeId(id: string): void {
  if (!NODE_ID_PATTERN.test(id)) {
    throw new Error(`Invalid node id "${id}". Node ids must use lowercase letters, numbers, and dashes.`);
  }
}

export function loadUnifiedNodes(options: ResolveNodesOptions = {}): LoadUnifiedNodesResult {
  const syncRoot = resolveSyncRoot(options);
  migrateLegacyProfileMemoryDirs({ profilesRoot: options.profilesRoot });
  const notesDir = getDurableNotesDir(syncRoot);
  const projectsDir = getDurableProjectsDir(syncRoot);
  const skillsDir = getDurableSkillsDir(syncRoot);

  const nodes: UnifiedNodeRecord[] = [];
  const parseErrors: UnifiedNodeParseError[] = [];

  for (const filePath of collectMarkdownFiles(notesDir, {
    excludeDirs: ['references', 'assets', 'scripts', 'templates'],
  })) {
    try {
      nodes.push(parseUnifiedNode(filePath));
    } catch (error) {
      parseErrors.push({
        filePath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const projectDir = join(projectsDir, entry.name);
      const projectFile = join(projectDir, 'project.md');
      if (!existsSync(projectFile)) {
        continue;
      }

      try {
        nodes.push(parseUnifiedNode(projectFile));
      } catch (error) {
        parseErrors.push({
          filePath: projectFile,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      for (const childFile of collectMarkdownFiles(projectDir, {
        excludeFileNames: ['project.md'],
        excludeDirs: ['references', 'assets', 'scripts', 'templates'],
      })) {
        try {
          nodes.push(parseUnifiedNode(childFile));
        } catch (error) {
          parseErrors.push({
            filePath: childFile,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const skillFile = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) {
        continue;
      }
      try {
        nodes.push(parseSkillNode(skillFile));
      } catch (error) {
        parseErrors.push({
          filePath: skillFile,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  nodes.sort((left, right) => left.id.localeCompare(right.id));
  return { nodesDir: syncRoot, nodes, parseErrors };
}

export function findUnifiedNodeById(nodes: UnifiedNodeRecord[], id: string): UnifiedNodeRecord {
  const normalized = id.trim().toLowerCase();
  const match = nodes.find((node) => node.id === normalized);
  if (!match) {
    throw new Error(`No node found with id: ${normalized}`);
  }
  return match;
}

export function findUnifiedNodes(nodes: UnifiedNodeRecord[], query?: string): UnifiedNodeRecord[] {
  return nodes.filter((node) => matchesUnifiedNodeQuery(node, query));
}

export function createUnifiedNode(input: CreateUnifiedNodeInput, options: ResolveNodesOptions = {}): CreateUnifiedNodeResult {
  validateUnifiedNodeId(input.id);
  const id = input.id.trim().toLowerCase();
  const title = input.title.trim();
  const summary = input.summary.trim();
  if (!title) {
    throw new Error('title is required');
  }
  if (!summary) {
    throw new Error('summary is required');
  }

  const syncRoot = resolveSyncRoot(options);
  const tags = normalizeTags(input.tags);
  const kinds = collectKindsFromTags(tags);
  const primaryKind = kinds[0] ?? 'note';
  const overwrite = input.force === true;
  const body = input.body?.trim() || `# ${title}\n\n${summary}`;
  const description = input.description?.trim() || undefined;
  const status = input.status?.trim() || 'active';
  const updatedAt = input.updatedAt ?? new Date().toISOString();

  let targetPath: string;
  let node: UnifiedNodeRecord;

  if (primaryKind === 'project') {
    targetPath = join(getDurableProjectsDir(syncRoot), id, 'project.md');
    if (existsSync(targetPath) && !overwrite) {
      throw new Error(`Node already exists at ${targetPath}. Pass force=true to overwrite.`);
    }
    node = writeUnifiedNode(targetPath, buildNodeFrontmatter({
      id,
      title,
      summary,
      description,
      status,
      createdAt: input.createdAt,
      updatedAt,
      createdBy: input.createdBy,
      tags,
      parent: input.parent?.trim() || undefined,
      related: input.related,
      relationships: input.relationships,
    }), body);
  } else if (primaryKind === 'skill') {
    targetPath = join(getDurableSkillsDir(syncRoot), id, 'SKILL.md');
    if (existsSync(targetPath) && !overwrite) {
      throw new Error(`Node already exists at ${targetPath}. Pass force=true to overwrite.`);
    }
    node = writeSkillNode(targetPath, {
      id,
      title,
      summary,
      description,
      status,
      profiles: collectTagValues(tags, 'profile'),
      body,
      createdAt: input.createdAt,
      updatedAt,
      createdBy: input.createdBy,
    });
  } else {
    targetPath = join(getDurableNotesDir(syncRoot), `${id}.md`);
    if (existsSync(targetPath) && !overwrite) {
      throw new Error(`Node already exists at ${targetPath}. Pass force=true to overwrite.`);
    }
    node = writeUnifiedNode(targetPath, buildNodeFrontmatter({
      id,
      title,
      summary,
      description,
      status,
      createdAt: input.createdAt,
      updatedAt,
      createdBy: input.createdBy,
      tags,
      parent: input.parent?.trim() || undefined,
      related: input.related,
      relationships: input.relationships,
    }), body);
  }

  return { nodesDir: syncRoot, node, overwritten: overwrite };
}

function readNodeFrontmatter(filePath: string): { frontmatter: Record<string, unknown>; body: string } {
  const raw = readFileSync(filePath, 'utf-8');
  const section = splitFrontmatter(raw);
  return { frontmatter: section.attributes, body: section.body };
}

export function updateUnifiedNode(input: UpdateUnifiedNodeInput, options: ResolveNodesOptions = {}): UnifiedNodeRecord {
  validateUnifiedNodeId(input.id);
  const id = input.id.trim().toLowerCase();
  const current = findUnifiedNodeById(loadUnifiedNodes(options).nodes, id);
  const filePath = current.filePath;
  if (!existsSync(filePath)) {
    throw new Error(`Node not found: ${id}`);
  }

  const parsed = readNodeFrontmatter(filePath);
  const nextTags = normalizeTags([
    ...current.tags.filter((tag) => !hasTag((input.removeTags ?? []).map((value) => value.trim()), tag)),
    ...(input.addTags ?? []),
  ]);
  const related = input.related ?? current.links.related;
  const relationships = input.relationships ?? current.links.relationships;
  const nextFrontmatter = buildNodeFrontmatter({
    id,
    title: input.title?.trim() || current.title,
    summary: input.summary?.trim() || current.summary,
    description: input.description === null ? undefined : (input.description?.trim() || current.description),
    status: input.status?.trim() || current.status,
    createdAt: readOptionalString(parsed.frontmatter.createdAt) ?? current.createdAt,
    updatedAt: new Date().toISOString(),
    createdBy: readOptionalString(parsed.frontmatter.createdBy) ?? current.createdBy,
    tags: nextTags.filter((tag) => !/^status:/i.test(tag) && !/^parent:/i.test(tag)),
    parent: input.parent === null ? undefined : (input.parent?.trim() || current.links.parent),
    related,
    relationships,
  });

  return writeUnifiedNode(filePath, nextFrontmatter, input.body?.trim() ?? current.body);
}

export function deleteUnifiedNode(id: string, options: ResolveNodesOptions = {}): { ok: true; id: string } {
  validateUnifiedNodeId(id);
  const normalized = id.trim().toLowerCase();
  const current = findUnifiedNodeById(loadUnifiedNodes(options).nodes, normalized);
  if (!existsSync(current.filePath)) {
    throw new Error(`Node not found: ${normalized}`);
  }
  rmSync(current.filePath, { force: false });
  return { ok: true, id: normalized };
}

export function tagUnifiedNode(input: TagUnifiedNodeInput, options: ResolveNodesOptions = {}): UnifiedNodeRecord {
  return updateUnifiedNode({
    id: input.id,
    addTags: input.add,
    removeTags: input.remove,
  }, options);
}

export function collectDuplicateUnifiedNodeIds(nodes: UnifiedNodeRecord[]): UnifiedNodeDuplicateId[] {
  const seen = new Map<string, string[]>();
  for (const node of nodes) {
    const files = seen.get(node.id) ?? [];
    files.push(node.filePath);
    seen.set(node.id, files);
  }

  return [...seen.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([id, files]) => ({ id, files: [...files].sort() }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function collectUnifiedNodeReferenceErrors(nodes: UnifiedNodeRecord[]): UnifiedNodeReferenceError[] {
  const ids = new Set(nodes.map((node) => node.id));
  const errors: UnifiedNodeReferenceError[] = [];

  for (const node of nodes) {
    if (node.links.parent) {
      if (node.links.parent === node.id) {
        errors.push({ filePath: node.filePath, id: node.id, field: 'parent', targetId: node.links.parent, error: 'parent must not reference the same node' });
      } else if (!ids.has(node.links.parent)) {
        errors.push({ filePath: node.filePath, id: node.id, field: 'parent', targetId: node.links.parent, error: 'parent does not match any node id' });
      }
    }

    for (const relatedId of node.links.related) {
      if (relatedId === node.id) {
        errors.push({ filePath: node.filePath, id: node.id, field: 'related', targetId: relatedId, error: 'related must not reference the same node' });
        continue;
      }
      if (!ids.has(relatedId)) {
        errors.push({ filePath: node.filePath, id: node.id, field: 'related', targetId: relatedId, error: 'related does not match any node id' });
      }
    }
  }

  return errors.sort((left, right) => left.id.localeCompare(right.id) || left.field.localeCompare(right.field) || left.targetId.localeCompare(right.targetId));
}

export function lintUnifiedNodes(options: ResolveNodesOptions = {}): LintUnifiedNodesResult {
  const loaded = loadUnifiedNodes(options);
  return {
    nodesDir: loaded.nodesDir,
    checked: loaded.nodes.length + loaded.parseErrors.length,
    validNodes: loaded.nodes.length,
    parseErrors: loaded.parseErrors,
    duplicateIds: collectDuplicateUnifiedNodeIds(loaded.nodes),
    referenceErrors: collectUnifiedNodeReferenceErrors(loaded.nodes),
  };
}

function maybeCopyDir(sourceDir: string, targetDir: string, name: string): void {
  const sourcePath = join(sourceDir, name);
  if (!existsSync(sourcePath)) {
    return;
  }
  cpSync(sourcePath, join(targetDir, name), { recursive: true, force: true });
}

function normalizeLegacyTags(tags: string[]): string[] {
  return normalizeTags(tags.filter((tag) => !/^status:/i.test(tag) && !/^parent:/i.test(tag)));
}

function parseLegacyMarkdown(filePath: string): { frontmatter: Record<string, unknown>; body: string } {
  const raw = readFileSync(filePath, 'utf-8');
  if (!raw.startsWith('---\n')) {
    return { frontmatter: {}, body: raw.trim() };
  }
  const section = splitFrontmatter(raw);
  return { frontmatter: section.attributes, body: section.body };
}

function buildProjectTasksMarkdown(tasks: ProjectTaskDocument[]): string {
  if (tasks.length === 0) {
    return '- [ ] No tasks yet';
  }

  return tasks.map((task) => {
    const done = task.status === 'done' || task.status === 'completed';
    const statusSuffix = !done && task.status !== 'pending' && task.status !== 'todo' && task.status !== 'in_progress'
      ? ` (status: ${task.status})`
      : '';
    const milestoneSuffix = task.milestoneId ? ` (milestone: ${task.milestoneId})` : '';
    return `- [${done ? 'x' : ' '}] ${task.title}${milestoneSuffix}${statusSuffix}`;
  }).join('\n');
}

function buildProjectMilestonesMarkdown(milestones: ProjectMilestoneDocument[]): string {
  if (milestones.length === 0) {
    return '- pending: No milestones yet';
  }

  return milestones.map((milestone) => `- ${milestone.status}: ${milestone.title}${milestone.summary ? ` — ${milestone.summary}` : ''}`).join('\n');
}

function sectionBlock(title: string, body: string | undefined): string {
  const normalized = body?.trim();
  if (!normalized) {
    return '';
  }
  return `## ${title}\n\n${normalized}`;
}

function buildProjectNodeBody(candidate: LegacyNodeCandidate): string {
  const project = candidate.project as ProjectDocument;
  const parts = [
    readOptionalString(candidate.frontmatter.description) || candidate.body || project.description,
    sectionBlock('Goal', project.requirements.goal),
    sectionBlock('Acceptance Criteria', project.requirements.acceptanceCriteria.map((item) => `- ${item}`).join('\n')),
    sectionBlock('Status', project.currentFocus || project.status),
    sectionBlock('Tasks', buildProjectTasksMarkdown(project.plan.tasks ?? [])),
    sectionBlock('Milestones', buildProjectMilestonesMarkdown(project.plan.milestones ?? [])),
    sectionBlock('Blockers', project.blockers.map((item) => `- ${item}`).join('\n')),
    sectionBlock('Progress', project.recentProgress.map((item) => `- ${item}`).join('\n')),
    sectionBlock('Plan Summary', project.planSummary),
    sectionBlock('Completion Summary', project.completionSummary),
  ].filter((part) => part && part.trim().length > 0);

  return parts.join('\n\n');
}

function copyLegacyNodeCandidate(candidate: LegacyNodeCandidate, nodesDir: string, existingKinds: string[] = []): { action: 'created' | 'updated' | 'skipped'; conflict?: LegacyNodeMigrationConflict } {
  const targetDir = join(nodesDir, candidate.id);
  const targetPath = join(targetDir, INDEX_FILE_NAME);
  const sourceTags = readStringArray(candidate.frontmatter.tags);
  const relatedLinks = readLinks(candidate.frontmatter).related;
  const parentLink = readLinks(candidate.frontmatter).parent;

  const nextTags = candidate.sourceKind === 'note'
    ? normalizeLegacyTags([
      'type:note',
      ...sourceTags,
      ...(readOptionalString((isRecord(candidate.frontmatter.metadata) ? candidate.frontmatter.metadata.type : undefined)) ? [`noteType:${String((candidate.frontmatter.metadata as Record<string, unknown>).type).trim()}`] : []),
      ...(readOptionalString((isRecord(candidate.frontmatter.metadata) ? candidate.frontmatter.metadata.area : undefined)) ? [`area:${String((candidate.frontmatter.metadata as Record<string, unknown>).area).trim()}`] : []),
      ...(readOptionalString((isRecord(candidate.frontmatter.metadata) ? candidate.frontmatter.metadata.role : undefined)) ? [`role:${String((candidate.frontmatter.metadata as Record<string, unknown>).role).trim()}`] : []),
    ])
    : candidate.sourceKind === 'skill'
      ? normalizeLegacyTags([
        'type:skill',
        'profile:shared',
        ...sourceTags,
        ...readStringArray(candidate.frontmatter.profiles).map((profile) => `profile:${profile}`),
      ])
      : normalizeLegacyTags([
        'type:project',
        ...(candidate.project?.ownerProfile ? [`profile:${candidate.project.ownerProfile}`] : []),
        ...(candidate.project?.repoRoot ? [`cwd:${candidate.project.repoRoot}`] : []),
        ...sourceTags,
      ]);

  const title = readOptionalString(candidate.frontmatter.title) ?? candidate.project?.title ?? extractMarkdownTitle(candidate.body) ?? humanizeId(candidate.id);
  const summary = readOptionalString(candidate.frontmatter.summary) ?? candidate.project?.summary ?? extractFirstParagraph(candidate.body) ?? `Durable node for ${title}.`;
  const description = candidate.sourceKind === 'project'
    ? undefined
    : readOptionalString(candidate.frontmatter.description);
  const status = readOptionalString(candidate.frontmatter.status) ?? candidate.project?.status ?? 'active';
  const createdAt = readOptionalString(candidate.frontmatter.createdAt) ?? candidate.project?.createdAt;
  const updatedAt = readOptionalString(candidate.frontmatter.updatedAt) ?? candidate.project?.updatedAt ?? new Date().toISOString();
  const createdBy = readOptionalString(candidate.frontmatter.createdBy);
  const body = candidate.sourceKind === 'project' ? buildProjectNodeBody(candidate) : candidate.body;

  const mergedKinds = normalizeTags([...existingKinds.map((kind) => `type:${kind}`), ...nextTags]);
  const mergedRelated = dedupeStrings(relatedLinks);
  const frontmatter = buildNodeFrontmatter({
    id: candidate.id,
    title,
    summary,
    description,
    status,
    createdAt,
    updatedAt,
    createdBy,
    tags: mergedKinds,
    parent: parentLink,
    related: mergedRelated,
  });

  mkdirSync(targetDir, { recursive: true });
  maybeCopyDir(candidate.sourceDir, targetDir, 'references');
  maybeCopyDir(candidate.sourceDir, targetDir, 'documents');
  maybeCopyDir(candidate.sourceDir, targetDir, 'attachments');
  maybeCopyDir(candidate.sourceDir, targetDir, 'scripts');
  maybeCopyDir(candidate.sourceDir, targetDir, 'artifacts');
  maybeCopyDir(candidate.sourceDir, targetDir, 'assets');
  maybeCopyDir(candidate.sourceDir, targetDir, 'templates');
  maybeCopyDir(candidate.sourceDir, targetDir, 'notes');

  if (existsSync(targetPath)) {
    const existing = parseUnifiedNode(targetPath);
    const existingKindsSet = new Set(existing.kinds);
    if (existingKindsSet.has(candidate.sourceKind)) {
      return { action: 'skipped' };
    }

    const combinedBody = candidate.sourceKind === 'project'
      ? `${existing.body}\n\n${sectionBlock('Legacy Project State', body)}`.trim()
      : `${existing.body}\n\n${sectionBlock(candidate.sourceKind === 'note' ? 'Merged Note' : 'Merged Skill', body)}`.trim();
    const mergedFrontmatter = buildNodeFrontmatter({
      id: existing.id,
      title: existing.title,
      summary: existing.summary,
      description: existing.description,
      status: existing.status,
      createdAt: existing.createdAt,
      updatedAt,
      createdBy: existing.createdBy,
      tags: normalizeTags([...existing.tags.filter((tag) => !/^status:/i.test(tag) && !/^parent:/i.test(tag)), ...nextTags]),
      parent: existing.links.parent ?? parentLink,
      related: dedupeStrings([...existing.links.related, ...mergedRelated]),
      relationships: normalizeRelationships([
        ...existing.links.relationships,
        ...readLinks(candidate.frontmatter).relationships,
      ]),
    });
    writeUnifiedNode(targetPath, mergedFrontmatter, combinedBody);
    return {
      action: 'updated',
      conflict: {
        id: candidate.id,
        kinds: [...new Set([...existing.kinds, candidate.sourceKind])].sort(),
        sources: [existing.filePath, join(candidate.sourceDir, INDEX_FILE_NAME)],
      },
    };
  }

  if (candidate.project) {
    const legacyStatePath = join(candidate.sourceDir, 'state.yaml');
    if (existsSync(legacyStatePath)) {
      mkdirSync(join(targetDir, 'documents'), { recursive: true });
      writeFileSync(join(targetDir, 'documents', 'legacy-state.yaml'), readFileSync(legacyStatePath, 'utf-8'), 'utf-8');
    }
  }

  writeUnifiedNode(targetPath, frontmatter, body);
  return { action: 'created' };
}

function collectLegacyCandidates(options: ResolveNodesOptions = {}): LegacyNodeCandidate[] {
  const syncRoot = resolveSyncRoot(options);
  const notesDir = getDurableNotesDir(syncRoot);
  const projectsDir = getDurableProjectsDir(syncRoot);
  const skillsDir = getDurableSkillsDir(syncRoot);
  const output: LegacyNodeCandidate[] = [];

  if (existsSync(notesDir)) {
    for (const entry of readdirSync(notesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const indexPath = join(notesDir, entry.name, INDEX_FILE_NAME);
      if (!existsSync(indexPath)) continue;
      const parsed = parseLegacyMarkdown(indexPath);
      const id = (readOptionalString(parsed.frontmatter.id) ?? entry.name).toLowerCase();
      output.push({ id, sourceKind: 'note', sourceDir: join(notesDir, entry.name), frontmatter: parsed.frontmatter, body: parsed.body });
    }
  }

  if (existsSync(skillsDir)) {
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const indexPath = LEGACY_SKILL_FILE_NAMES
        .map((fileName) => join(skillsDir, entry.name, fileName))
        .find((filePath) => existsSync(filePath));
      if (!indexPath) continue;
      const parsed = parseLegacyMarkdown(indexPath);
      const id = (readOptionalString(parsed.frontmatter.id) ?? readOptionalString(parsed.frontmatter.name) ?? entry.name).toLowerCase();
      output.push({ id, sourceKind: 'skill', sourceDir: join(skillsDir, entry.name), frontmatter: parsed.frontmatter, body: parsed.body });
    }
  }

  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const indexPath = join(projectsDir, entry.name, INDEX_FILE_NAME);
      const statePath = join(projectsDir, entry.name, 'state.yaml');
      if (!existsSync(indexPath) || !existsSync(statePath)) continue;
      const parsed = parseLegacyMarkdown(indexPath);
      output.push({
        id: entry.name.toLowerCase(),
        sourceKind: 'project',
        sourceDir: join(projectsDir, entry.name),
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        project: readProject(statePath),
      });
    }
  }

  output.sort((left, right) => left.id.localeCompare(right.id) || left.sourceKind.localeCompare(right.sourceKind));
  return output;
}

export function migrateLegacyNodes(options: ResolveNodesOptions = {}): LegacyNodeMigrationResult {
  void copyLegacyNodeCandidate;
  void collectLegacyCandidates;
  return {
    nodesDir: resolveUnifiedNodesDir(options),
    created: [],
    updated: [],
    skipped: [],
    conflicts: [],
  };
}

export function listUnifiedSkillNodeDirs(profile: string, options: ResolveNodesOptions = {}): string[] {
  const loaded = loadUnifiedNodes(options);
  const normalizedProfile = profile.trim().toLowerCase();
  return loaded.nodes
    .filter((node) => node.kinds.includes('skill'))
    .filter((node) => node.profiles.length === 0 || node.profiles.some((value) => value.toLowerCase() === normalizedProfile || value.toLowerCase() === 'shared'))
    .map((node) => node.dirPath)
    .sort((left, right) => left.localeCompare(right));
}
