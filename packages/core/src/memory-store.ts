import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { parseDocument } from 'yaml';
import { getProfilesRoot } from './runtime/paths.js';
import { getMemoryDocsDir, migrateLegacyProfileMemoryDirs, type ResolveMemoryDocsOptions } from './memory-docs.js';

const MEMORY_FRONTMATTER_DELIMITER = '---';

export interface MemoryDocParseError {
  filePath: string;
  error: string;
}

export interface ParsedMemoryDoc {
  filePath: string;
  fileName: string;
  id: string;
  title: string;
  summary: string;
  type: string;
  status: string;
  area?: string;
  role?: string;
  parent?: string;
  related: string[];
  tags: string[];
  updated: string;
  body: string;
}

interface MemoryFrontmatterSection {
  attributes: Record<string, unknown>;
  body: string;
}

export interface LoadMemoryDocsResult {
  memoryDir: string;
  docs: ParsedMemoryDoc[];
  parseErrors: MemoryDocParseError[];
}

export interface FindMemoryDocsFilters {
  tags?: string[];
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
  tags: string[];
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
  type: string;
  status: string;
  area?: string;
  role?: string;
  parent?: string;
  related: string[];
  tags: string[];
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

function resolveMemoryContext(options: ResolveMemoryDocsOptions = {}): { memoryDir: string } {
  const profilesRoot = options.profilesRoot ?? getProfilesRoot();
  migrateLegacyProfileMemoryDirs({ profilesRoot });

  return {
    memoryDir: getMemoryDocsDir({ profilesRoot }),
  };
}

function isMemoryRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseMemoryFrontmatterYaml(rawFrontmatter: string): Record<string, unknown> {
  const document = parseDocument(rawFrontmatter, {
    prettyErrors: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    const firstError = document.errors[0];
    throw new Error(`Invalid YAML frontmatter: ${firstError?.message ?? 'unknown parse error'}`);
  }

  const parsed = document.toJS({ mapAsMap: false }) as unknown;
  if (!isMemoryRecord(parsed)) {
    throw new Error('YAML frontmatter must evaluate to an object');
  }

  return parsed;
}

function splitMemoryFrontmatter(rawContent: string): MemoryFrontmatterSection {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');

  if (lines.length === 0 || lines[0]?.trim() !== MEMORY_FRONTMATTER_DELIMITER) {
    throw new Error('Memory markdown must start with YAML frontmatter');
  }

  let endIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === MEMORY_FRONTMATTER_DELIMITER) {
      endIndex = index;
      break;
    }
  }

  if (endIndex === -1) {
    throw new Error('Missing closing YAML frontmatter delimiter');
  }

  const rawFrontmatter = lines.slice(1, endIndex).join('\n');
  const body = lines.slice(endIndex + 1).join('\n').trim();

  return {
    attributes: parseMemoryFrontmatterYaml(rawFrontmatter),
    body,
  };
}

function getMemoryAttribute(attributes: Record<string, unknown>, key: string): unknown {
  if (Object.prototype.hasOwnProperty.call(attributes, key)) {
    return attributes[key];
  }

  const lowerKey = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(attributes, lowerKey)) {
    return attributes[lowerKey];
  }

  return undefined;
}

function readRequiredMemoryString(attributes: Record<string, unknown>, key: string): string {
  const value = getMemoryAttribute(attributes, key);
  if (typeof value !== 'string') {
    throw new Error(`Frontmatter key ${key} is required and must be a string`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`Frontmatter key ${key} is required and must be a non-empty string`);
  }

  return trimmed;
}

function readOptionalMemoryString(attributes: Record<string, unknown>, key: string): string | undefined {
  const value = getMemoryAttribute(attributes, key);
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`Frontmatter key ${key} must be a string`);
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readOptionalMemoryStringArray(attributes: Record<string, unknown>, key: string): string[] {
  const rawValues = getMemoryAttribute(attributes, key);
  if (rawValues === undefined || rawValues === null) {
    return [];
  }

  if (!Array.isArray(rawValues)) {
    throw new Error(`Frontmatter key ${key} must be a string array`);
  }

  const values = rawValues.map((value) => {
    if (typeof value !== 'string') {
      throw new Error(`Frontmatter key ${key} must be a string array`);
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new Error(`Frontmatter key ${key} must not include empty values`);
    }

    return trimmed;
  });

  return [...new Set(values)];
}

function readRequiredMemoryTags(attributes: Record<string, unknown>): string[] {
  const rawTags = getMemoryAttribute(attributes, 'tags');
  if (!Array.isArray(rawTags)) {
    throw new Error('Frontmatter key tags is required and must be a string array');
  }

  const tags = rawTags.map((tag) => {
    if (typeof tag !== 'string') {
      throw new Error('Frontmatter key tags is required and must be a string array');
    }

    const trimmed = tag.trim();
    if (trimmed.length === 0) {
      throw new Error('Frontmatter key tags must not include empty values');
    }

    return trimmed;
  });

  return [...new Set(tags)];
}

export function validateMemoryDocId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    throw new Error('Frontmatter key id must match ^[a-z0-9][a-z0-9-]*$');
  }
}

function validateMemoryUpdated(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Frontmatter key updated must use YYYY-MM-DD format');
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Frontmatter key updated must be a valid calendar date');
  }
}

function parseMemoryDoc(filePath: string, rawContent: string): ParsedMemoryDoc {
  const section = splitMemoryFrontmatter(rawContent);
  const attributes = section.attributes;

  const id = readRequiredMemoryString(attributes, 'id');
  validateMemoryDocId(id);

  const updated = readRequiredMemoryString(attributes, 'updated');
  validateMemoryUpdated(updated);

  const area = readOptionalMemoryString(attributes, 'area');
  if (area) {
    validateMemoryDocId(area);
  }

  const role = readOptionalMemoryString(attributes, 'role');

  const parent = readOptionalMemoryString(attributes, 'parent');
  if (parent) {
    validateMemoryDocId(parent);
  }

  const related = readOptionalMemoryStringArray(attributes, 'related');
  for (const relatedId of related) {
    validateMemoryDocId(relatedId);
  }

  const body = section.body.trim();
  if (body.length === 0) {
    throw new Error('Memory markdown body must not be empty');
  }

  return {
    filePath,
    fileName: basename(filePath),
    id,
    title: readRequiredMemoryString(attributes, 'title'),
    summary: readRequiredMemoryString(attributes, 'summary'),
    type: readOptionalMemoryString(attributes, 'type') ?? 'note',
    status: readOptionalMemoryString(attributes, 'status') ?? 'active',
    ...(area ? { area } : {}),
    ...(role ? { role } : {}),
    ...(parent ? { parent } : {}),
    related,
    tags: readRequiredMemoryTags(attributes),
    updated,
    body,
  };
}

function listMemoryDocFiles(memoryDir: string): string[] {
  if (!existsSync(memoryDir)) {
    return [];
  }

  const entries = readdirSync(memoryDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(memoryDir, entry.name));

  files.sort();
  return files;
}

export function loadMemoryDocs(options: ResolveMemoryDocsOptions = {}): LoadMemoryDocsResult {
  const context = resolveMemoryContext(options);
  const files = listMemoryDocFiles(context.memoryDir);
  const docs: ParsedMemoryDoc[] = [];
  const parseErrors: MemoryDocParseError[] = [];

  for (const filePath of files) {
    try {
      docs.push(parseMemoryDoc(filePath, readFileSync(filePath, 'utf-8')));
    } catch (error) {
      parseErrors.push({
        filePath,
        error: (error as Error).message,
      });
    }
  }

  docs.sort((left, right) => left.id.localeCompare(right.id) || left.filePath.localeCompare(right.filePath));

  return {
    memoryDir: context.memoryDir,
    docs,
    parseErrors,
  };
}

export function resolveMemoryDocById(docs: ParsedMemoryDoc[], id: string): ParsedMemoryDoc {
  const normalizedId = id.trim();
  const matches = docs.filter((doc) => doc.id === normalizedId);

  if (matches.length === 0) {
    throw new Error(`No memory doc found with id: ${normalizedId}`);
  }

  if (matches.length > 1) {
    const files = matches.map((doc) => doc.filePath).join(', ');
    throw new Error(`Memory doc id is ambiguous (${normalizedId}). Matches: ${files}`);
  }

  return matches[0] as ParsedMemoryDoc;
}

export function collectDuplicateMemoryDocIds(docs: ParsedMemoryDoc[]): MemoryDocDuplicateId[] {
  const index = new Map<string, string[]>();

  for (const doc of docs) {
    const existing = index.get(doc.id) ?? [];
    existing.push(doc.filePath);
    index.set(doc.id, existing);
  }

  const duplicates: MemoryDocDuplicateId[] = [];
  for (const [id, files] of index.entries()) {
    if (files.length > 1) {
      duplicates.push({ id, files });
    }
  }

  duplicates.sort((left, right) => left.id.localeCompare(right.id));
  return duplicates;
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
          error: 'parent must not reference the same memory doc',
        });
      } else if (!ids.has(doc.parent)) {
        errors.push({
          filePath: doc.filePath,
          id: doc.id,
          field: 'parent',
          targetId: doc.parent,
          error: 'parent does not match any memory doc id',
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
          error: 'related must not reference the same memory doc',
        });
        continue;
      }

      if (!ids.has(relatedId)) {
        errors.push({
          filePath: doc.filePath,
          id: doc.id,
          field: 'related',
          targetId: relatedId,
          error: 'related does not match any memory doc id',
        });
      }
    }
  }

  errors.sort((left, right) => left.id.localeCompare(right.id)
    || left.field.localeCompare(right.field)
    || left.targetId.localeCompare(right.targetId)
    || left.filePath.localeCompare(right.filePath));

  return errors;
}

export function filterMemoryDocs(docs: ParsedMemoryDoc[], filters: FindMemoryDocsFilters = {}): ParsedMemoryDoc[] {
  const tagFilters = (filters.tags ?? [])
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag.length > 0);
  const typeFilter = filters.type?.trim().toLowerCase();
  const statusFilter = filters.status?.trim().toLowerCase();
  const areaFilter = filters.area?.trim().toLowerCase();
  const roleFilter = filters.role?.trim().toLowerCase();
  const parentFilter = filters.parent?.trim().toLowerCase();
  const textFilter = filters.text?.trim().toLowerCase();

  return docs.filter((doc) => {
    if (tagFilters.length > 0) {
      const lowerTags = doc.tags.map((tag) => tag.toLowerCase());
      for (const tagFilter of tagFilters) {
        if (!lowerTags.includes(tagFilter)) {
          return false;
        }
      }
    }

    if (typeFilter && doc.type.toLowerCase() !== typeFilter) {
      return false;
    }

    if (statusFilter && doc.status.toLowerCase() !== statusFilter) {
      return false;
    }

    if (areaFilter && doc.area?.toLowerCase() !== areaFilter) {
      return false;
    }

    if (roleFilter && doc.role?.toLowerCase() !== roleFilter) {
      return false;
    }

    if (parentFilter && doc.parent?.toLowerCase() !== parentFilter) {
      return false;
    }

    if (textFilter) {
      const haystack = [
        doc.id,
        doc.title,
        doc.summary,
        doc.type,
        doc.status,
        doc.area,
        doc.role,
        doc.parent,
        ...doc.related,
        ...doc.tags,
      ]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(textFilter)) {
        return false;
      }
    }

    return true;
  });
}

export function splitMemoryTagValues(rawValues: string[]): string[] {
  const tags: string[] = [];

  for (const rawValue of rawValues) {
    const split = rawValue
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);

    tags.push(...split);
  }

  return [...new Set(tags)];
}

export function currentDateYyyyMmDd(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function toYamlQuotedString(value: string): string {
  return JSON.stringify(value);
}

export function buildMemoryDocTemplate(options: {
  id: string;
  title: string;
  summary: string;
  type: string;
  status: string;
  area?: string;
  role?: string;
  parent?: string;
  related: string[];
  tags: string[];
  updated: string;
}): string {
  const lines = [
    '---',
    `id: ${options.id}`,
    `title: ${toYamlQuotedString(options.title)}`,
    `summary: ${toYamlQuotedString(options.summary)}`,
    `type: ${toYamlQuotedString(options.type)}`,
    `status: ${toYamlQuotedString(options.status)}`,
  ];

  if (options.area) {
    lines.push(`area: ${options.area}`);
  }

  if (options.role) {
    lines.push(`role: ${toYamlQuotedString(options.role)}`);
  }

  if (options.parent) {
    lines.push(`parent: ${options.parent}`);
  }

  if (options.related.length > 0) {
    lines.push('related:');
    for (const relatedId of options.related) {
      lines.push(`  - ${toYamlQuotedString(relatedId)}`);
    }
  }

  lines.push('tags:');
  for (const tag of options.tags) {
    lines.push(`  - ${toYamlQuotedString(tag)}`);
  }

  lines.push(`updated: ${options.updated}`, '---', '', `# ${options.title}`, '', options.summary, '', 'TODO: add details.', '');
  return `${lines.join('\n')}`;
}

export function createMemoryDoc(input: CreateMemoryDocInput, options: ResolveMemoryDocsOptions = {}): CreateMemoryDocResult {
  const id = input.id.trim();
  validateMemoryDocId(id);

  const title = input.title.trim();
  if (title.length === 0) {
    throw new Error('title is required.');
  }

  const summary = input.summary.trim();
  if (summary.length === 0) {
    throw new Error('summary is required.');
  }

  const tags = [...new Set(input.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))];
  if (tags.length === 0) {
    throw new Error('At least one tag is required.');
  }

  const type = input.type?.trim() || 'note';
  const status = input.status?.trim() || 'active';
  const area = input.area?.trim();
  if (area) {
    validateMemoryDocId(area);
  }

  const role = input.role?.trim() || undefined;

  const parent = input.parent?.trim();
  if (parent) {
    validateMemoryDocId(parent);
  }

  const related = [...new Set((input.related ?? []).map((value) => value.trim()).filter((value) => value.length > 0))];
  for (const relatedId of related) {
    validateMemoryDocId(relatedId);
  }

  const updated = input.updated?.trim() || currentDateYyyyMmDd();
  validateMemoryUpdated(updated);

  const context = resolveMemoryContext(options);
  mkdirSync(context.memoryDir, { recursive: true });

  const targetPath = join(context.memoryDir, `${id}.md`);
  const loaded = loadMemoryDocs(options);
  const existingDoc = loaded.docs.find((doc) => doc.id === id);
  const targetExists = existsSync(targetPath);

  if (!input.force) {
    if (targetExists) {
      throw new Error(`Memory doc already exists: ${targetPath} (use --force to overwrite)`);
    }

    if (existingDoc && existingDoc.filePath !== targetPath) {
      throw new Error(`Memory doc id already exists in another file: ${existingDoc.filePath} (use --force to overwrite ${targetPath})`);
    }
  }

  const content = buildMemoryDocTemplate({
    id,
    title,
    summary,
    type,
    status,
    ...(area ? { area } : {}),
    ...(role ? { role } : {}),
    ...(parent ? { parent } : {}),
    related,
    tags,
    updated,
  });

  writeFileSync(targetPath, content, 'utf-8');

  return {
    memoryDir: context.memoryDir,
    filePath: targetPath,
    id,
    title,
    summary,
    type,
    status,
    ...(area ? { area } : {}),
    ...(role ? { role } : {}),
    ...(parent ? { parent } : {}),
    related,
    tags,
    updated,
    overwritten: targetExists,
  };
}

export function lintMemoryDocs(options: ResolveMemoryDocsOptions = {}): LintMemoryDocsResult {
  const loaded = loadMemoryDocs(options);
  const duplicates = collectDuplicateMemoryDocIds(loaded.docs);
  const referenceErrors = collectMemoryDocReferenceErrors(loaded.docs);

  return {
    memoryDir: loaded.memoryDir,
    checked: loaded.docs.length + loaded.parseErrors.length,
    validDocs: loaded.docs.length,
    parseErrors: loaded.parseErrors,
    duplicateIds: duplicates,
    referenceErrors,
  };
}
