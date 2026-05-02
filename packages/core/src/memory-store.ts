import { existsSync, readdirSync, readFileSync } from 'fs';
import { basename, join } from 'path';
import { parseDocument, stringify } from 'yaml';

import { getMemoryDocsDir, type ResolveMemoryDocsOptions } from './memory-docs.js';
import { createUnifiedNode, loadUnifiedNodes, type UnifiedNodeRecord } from './nodes.js';
import { getVaultRoot } from './runtime/paths.js';

const FRONTMATTER_DELIMITER = '---';
const MEMORY_DOC_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface MemoryDocParseError {
  filePath: string;
  error: string;
}

export interface ParsedMemoryDoc {
  filePath: string;
  dirPath: string;
  fileName: string;
  packageId: string;
  packagePath: string;
  id: string;
  title: string;
  summary: string;
  description?: string;
  type: string;
  status: string;
  area?: string;
  role?: string;
  parent?: string;
  related: string[];
  updated: string;
  body: string;
  metadata: Record<string, unknown>;
  referencePaths: string[];
}

export interface ParsedMemoryReference {
  filePath: string;
  fileName: string;
  relativePath: string;
  id: string;
  title: string;
  summary: string;
  updated: string;
  body: string;
  metadata: Record<string, unknown>;
}

interface MemoryFrontmatterSection {
  attributes: Record<string, unknown>;
  body: string;
}

export interface LoadMemoryDocsOptions extends ResolveMemoryDocsOptions {}

export interface LoadMemoryDocsResult {
  memoryDir: string;
  docs: ParsedMemoryDoc[];
  parseErrors: MemoryDocParseError[];
}

export interface FindMemoryDocsFilters {
  type?: string;
  status?: string;
  area?: string;
  role?: string;
  parent?: string;
  text?: string;
}

export interface MemoryDocDuplicateId {
  id: string;
  files: string[];
}

export interface CreateMemoryDocInput {
  id: string;
  title: string;
  summary: string;
  description?: string;
  type?: string;
  status?: string;
  area?: string;
  role?: string;
  parent?: string;
  related?: string[];
  updated?: string;
  force?: boolean;
}

export interface CreateMemoryDocResult {
  memoryDir: string;
  filePath: string;
  id: string;
  title: string;
  summary: string;
  description?: string;
  type: string;
  status: string;
  area?: string;
  role?: string;
  parent?: string;
  related: string[];
  updated: string;
  overwritten: boolean;
}

export interface MemoryDocReferenceError {
  filePath: string;
  id: string;
  field: 'parent' | 'related';
  targetId: string;
  error: string;
}

export interface LintMemoryDocsResult {
  memoryDir: string;
  checked: number;
  validDocs: number;
  parseErrors: MemoryDocParseError[];
  duplicateIds: MemoryDocDuplicateId[];
  referenceErrors: MemoryDocReferenceError[];
}

function resolveMemoryContext(options: ResolveMemoryDocsOptions = {}): { memoryDir: string; vaultRoot: string } {
  const vaultRoot = options.vaultRoot ?? getVaultRoot();

  return {
    memoryDir: getMemoryDocsDir({ vaultRoot }),
    vaultRoot,
  };
}

function extractTagValue(tags: string[], key: string): string | undefined {
  return tags
    .map((tag) => tag.match(new RegExp(`^${key}:(.+)$`, 'i'))?.[1]?.trim())
    .find((value): value is string => typeof value === 'string' && value.length > 0);
}

function isNoteNode(node: UnifiedNodeRecord): boolean {
  return node.kinds.includes('note') || (!node.kinds.includes('project') && !node.kinds.includes('skill'));
}

function mapUnifiedNodeToMemoryDoc(node: UnifiedNodeRecord): ParsedMemoryDoc {
  return {
    filePath: node.filePath,
    dirPath: node.dirPath,
    fileName: basename(node.filePath),
    packageId: node.id,
    packagePath: node.dirPath,
    id: node.id,
    title: node.title,
    summary: node.summary,
    description: node.description,
    type: extractTagValue(node.tags, 'noteType') ?? node.type,
    status: node.status,
    area: extractTagValue(node.tags, 'area'),
    role: extractTagValue(node.tags, 'role') ?? extractTagValue(node.tags, 'noteType'),
    parent: node.links.parent,
    related: node.links.related,
    updated: node.updatedAt ?? currentDateYyyyMmDd(),
    body: node.body,
    metadata: {},
    referencePaths: loadMemoryPackageReferences(node.dirPath).map((reference) => reference.filePath),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseFrontmatterYaml(rawFrontmatter: string): Record<string, unknown> {
  const document = parseDocument(rawFrontmatter, {
    prettyErrors: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    const firstError = document.errors[0];
    throw new Error(`Invalid YAML frontmatter: ${firstError?.message ?? 'unknown parse error'}`);
  }

  const parsed = document.toJS({ mapAsMap: false }) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('YAML frontmatter must evaluate to an object');
  }

  return parsed;
}

function splitFrontmatter(rawContent: string): MemoryFrontmatterSection {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines.length === 0 || lines[0]?.trim() !== FRONTMATTER_DELIMITER) {
    throw new Error('Note node markdown must start with YAML frontmatter');
  }

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === FRONTMATTER_DELIMITER) {
      endIndex = index;
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error('Missing closing YAML frontmatter delimiter');
  }

  return {
    attributes: parseFrontmatterYaml(lines.slice(1, endIndex).join('\n')),
    body: lines
      .slice(endIndex + 1)
      .join('\n')
      .trim(),
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

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function extractMarkdownTitle(body: string): string | undefined {
  const match = body.match(/^#\s+(.+)$/m);
  const title = match?.[1]?.trim();
  return title && title.length > 0 ? title : undefined;
}

function extractFirstParagraph(body: string): string | undefined {
  const paragraphs = body
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .filter((paragraph) => !paragraph.startsWith('#'));

  for (const paragraph of paragraphs) {
    const text = paragraph
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

function collectReferenceFiles(rootDir: string): string[] {
  if (!existsSync(rootDir)) {
    return [];
  }

  const output: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.md')) {
        output.push(fullPath);
      }
    }
  }

  output.sort();
  return output;
}

function parseReferenceFile(filePath: string, rootDir: string): ParsedMemoryReference {
  const rawContent = readFileSync(filePath, 'utf-8');
  const parsed = rawContent.startsWith('---\n') ? splitFrontmatter(rawContent) : null;
  const attributes = parsed?.attributes ?? {};
  const metadata = normalizeMetadata(attributes.metadata);
  const body = parsed?.body ?? rawContent.trim();
  const id = readOptionalString(attributes.id) ?? basename(filePath, '.md');
  const title =
    readOptionalString(attributes.title) ??
    readOptionalString(attributes.name) ??
    readOptionalString(metadata.title) ??
    extractMarkdownTitle(body) ??
    humanizeId(id);
  const summary = readOptionalString(attributes.summary) ?? readOptionalString(attributes.description) ?? extractFirstParagraph(body) ?? '';
  const updated =
    readOptionalString(attributes.updatedAt) ??
    readOptionalString(attributes.updated) ??
    readOptionalString(metadata.updated) ??
    currentDateYyyyMmDd();

  return {
    filePath,
    fileName: basename(filePath),
    relativePath: filePath.slice(rootDir.length + 1).replace(/\\/g, '/'),
    id,
    title,
    summary,
    updated,
    body,
    metadata,
  };
}

export function validateMemoryDocId(id: string): void {
  if (!MEMORY_DOC_ID_PATTERN.test(id)) {
    throw new Error(`Invalid note id "${id}". Note ids must use lowercase letters, numbers, and dashes.`);
  }
}

export function loadMemoryDocs(options: LoadMemoryDocsOptions = {}): LoadMemoryDocsResult {
  const { memoryDir, vaultRoot } = resolveMemoryContext(options);
  const loaded = loadUnifiedNodes({ vaultRoot });

  const docs = loaded.nodes
    .filter((node) => isNoteNode(node))
    .map((node) => mapUnifiedNodeToMemoryDoc(node))
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    memoryDir,
    docs,
    parseErrors: loaded.parseErrors,
  };
}

export function loadMemoryPackageReferences(packagePath: string): ParsedMemoryReference[] {
  const referencesDir = join(packagePath, 'references');
  return collectReferenceFiles(referencesDir)
    .map((filePath) => parseReferenceFile(filePath, packagePath))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

export function resolveMemoryDocById(docs: ParsedMemoryDoc[], id: string): ParsedMemoryDoc {
  const normalizedId = id.trim().toLowerCase();
  const match = docs.find((doc) => doc.id === normalizedId);
  if (!match) {
    throw new Error(`No note node found with id: ${normalizedId}`);
  }

  return match;
}

export function collectDuplicateMemoryDocIds(docs: ParsedMemoryDoc[]): MemoryDocDuplicateId[] {
  const seen = new Map<string, string[]>();

  for (const doc of docs) {
    const files = seen.get(doc.id) ?? [];
    files.push(doc.filePath);
    seen.set(doc.id, files);
  }

  return [...seen.entries()]
    .filter(([, files]) => files.length > 1)
    .map(([id, files]) => ({ id, files: [...files].sort() }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function collectMemoryDocReferenceErrors(docs: ParsedMemoryDoc[]): MemoryDocReferenceError[] {
  const ids = new Set(docs.map((doc) => doc.id));
  const errors: MemoryDocReferenceError[] = [];

  for (const doc of docs) {
    if (doc.parent) {
      if (doc.parent === doc.id) {
        errors.push({
          filePath: doc.filePath,
          id: doc.id,
          field: 'parent',
          targetId: doc.parent,
          error: 'parent must not reference the same note node',
        });
      } else if (!ids.has(doc.parent)) {
        errors.push({
          filePath: doc.filePath,
          id: doc.id,
          field: 'parent',
          targetId: doc.parent,
          error: 'parent does not match any note node id',
        });
      }
    }

    for (const relatedId of doc.related) {
      if (relatedId === doc.id) {
        errors.push({
          filePath: doc.filePath,
          id: doc.id,
          field: 'related',
          targetId: relatedId,
          error: 'related must not reference the same note node',
        });
        continue;
      }

      if (!ids.has(relatedId)) {
        errors.push({
          filePath: doc.filePath,
          id: doc.id,
          field: 'related',
          targetId: relatedId,
          error: 'related does not match any note node id',
        });
      }
    }
  }

  return errors.sort((left, right) => {
    return left.id.localeCompare(right.id) || left.field.localeCompare(right.field) || left.targetId.localeCompare(right.targetId);
  });
}

export function filterMemoryDocs(docs: ParsedMemoryDoc[], filters: FindMemoryDocsFilters = {}): ParsedMemoryDoc[] {
  const normalizedType = filters.type?.trim().toLowerCase();
  const normalizedStatus = filters.status?.trim().toLowerCase();
  const normalizedArea = filters.area?.trim().toLowerCase();
  const normalizedRole = filters.role?.trim().toLowerCase();
  const normalizedParent = filters.parent?.trim().toLowerCase();
  const normalizedText = filters.text?.trim().toLowerCase();

  return docs.filter((doc) => {
    if (normalizedType && doc.type.toLowerCase() !== normalizedType) {
      return false;
    }

    if (normalizedStatus && doc.status.toLowerCase() !== normalizedStatus) {
      return false;
    }

    if (normalizedArea && (doc.area?.toLowerCase() ?? '') !== normalizedArea) {
      return false;
    }

    if (normalizedRole && (doc.role?.toLowerCase() ?? '') !== normalizedRole) {
      return false;
    }

    if (normalizedParent && (doc.parent?.toLowerCase() ?? '') !== normalizedParent) {
      return false;
    }

    if (normalizedText) {
      const haystack = [
        doc.id,
        doc.title,
        doc.summary,
        doc.description,
        doc.type,
        doc.status,
        doc.area,
        doc.role,
        doc.parent,
        ...doc.related,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('\n')
        .toLowerCase();

      if (!haystack.includes(normalizedText)) {
        return false;
      }
    }

    return true;
  });
}

export function normalizeCsvValues(rawValues: string[]): string[] {
  return [
    ...new Set(
      rawValues
        .flatMap((value) => String(value).split(','))
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
    ),
  ];
}

export function currentDateYyyyMmDd(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function buildMemoryDocTemplate(options: {
  id: string;
  title: string;
  summary: string;
  description?: string;
  type?: string;
  status?: string;
  area?: string;
  role?: string;
  parent?: string;
  related?: string[];
  updated?: string;
}): string {
  const description = options.description?.trim();
  const normalizedRole = options.role?.trim().toLowerCase();
  const parent = options.parent?.trim();
  const related = normalizeCsvValues(options.related ?? []);
  const links: Record<string, unknown> = {
    ...(parent ? { parent } : {}),
    ...(related.length > 0 ? { related } : {}),
  };
  const tags = [
    'type:note',
    `status:${options.status?.trim() || 'active'}`,
    ...(options.type?.trim() ? [`noteType:${options.type.trim()}`] : []),
    ...(options.area?.trim() ? [`area:${options.area.trim()}`] : []),
    ...(normalizedRole ? [`role:${normalizedRole === 'hub' ? 'structure' : normalizedRole}`] : []),
  ];

  return stringifyFrontmatter(
    {
      id: options.id,
      title: options.title,
      summary: options.summary,
      ...(description ? { description } : {}),
      status: options.status?.trim() || 'active',
      updatedAt: options.updated?.trim() || currentDateYyyyMmDd(),
      tags,
      ...(Object.keys(links).length > 0 ? { links } : {}),
    },
    `# ${options.title}\n\n${options.summary}`,
  );
}

export function createMemoryDoc(input: CreateMemoryDocInput, options: ResolveMemoryDocsOptions = {}): CreateMemoryDocResult {
  validateMemoryDocId(input.id);

  const id = input.id.trim().toLowerCase();
  const title = input.title.trim();
  const summary = input.summary.trim();
  if (title.length === 0) {
    throw new Error('title is required');
  }
  if (summary.length === 0) {
    throw new Error('summary is required');
  }

  const { memoryDir, vaultRoot } = resolveMemoryContext(options);
  const role = input.role?.trim().toLowerCase();
  const created = createUnifiedNode(
    {
      id,
      title,
      summary,
      description: input.description?.trim() || undefined,
      status: input.status?.trim() || 'active',
      tags: [
        'type:note',
        ...(input.type?.trim() ? [`noteType:${input.type.trim()}`] : []),
        ...(input.area?.trim() ? [`area:${input.area.trim()}`] : []),
        ...(role ? [`role:${role === 'hub' ? 'structure' : role}`] : []),
      ],
      parent: input.parent?.trim() || undefined,
      related: input.related,
      updatedAt: input.updated?.trim() || currentDateYyyyMmDd(),
      force: input.force,
    },
    { vaultRoot },
  );

  const doc = mapUnifiedNodeToMemoryDoc(created.node);
  return {
    memoryDir,
    filePath: doc.filePath,
    id: doc.id,
    title: doc.title,
    summary: doc.summary,
    description: doc.description,
    type: doc.type,
    status: doc.status,
    area: doc.area,
    role: doc.role,
    parent: doc.parent,
    related: doc.related,
    updated: doc.updated,
    overwritten: created.overwritten,
  };
}

export function lintMemoryDocs(options: ResolveMemoryDocsOptions = {}): LintMemoryDocsResult {
  const loaded = loadMemoryDocs(options);
  const duplicateIds = collectDuplicateMemoryDocIds(loaded.docs);
  const referenceErrors = collectMemoryDocReferenceErrors(loaded.docs);

  return {
    memoryDir: loaded.memoryDir,
    checked: loaded.docs.length + loaded.parseErrors.length,
    validDocs: loaded.docs.length,
    parseErrors: loaded.parseErrors,
    duplicateIds,
    referenceErrors,
  };
}
