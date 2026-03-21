import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, dirname, join, relative } from 'path';
import { parseDocument, stringify } from 'yaml';
import { getDurableProfilesDir } from './runtime/paths.js';
import { getMemoryDocsDir, migrateLegacyProfileMemoryDirs, type ResolveMemoryDocsOptions } from './memory-docs.js';

const MEMORY_FRONTMATTER_DELIMITER = '---';

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
  type: string;
  status: string;
  area?: string;
  role?: string;
  parent?: string;
  related: string[];
  tags: string[];
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
  tags: string[];
  updated: string;
  body: string;
  metadata: Record<string, unknown>;
}

interface MemoryFrontmatterSection {
  attributes: Record<string, unknown>;
  body: string;
}

export interface LoadMemoryDocsOptions extends ResolveMemoryDocsOptions {
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
  const profilesRoot = options.profilesRoot ?? getDurableProfilesDir();

  return {
    memoryDir: getMemoryDocsDir({ profilesRoot }),
  };
}

function isMemoryRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function readOptionalMemoryRecord(attributes: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = getMemoryAttribute(attributes, key);
  if (value === undefined || value === null) {
    return {};
  }

  if (!isMemoryRecord(value)) {
    throw new Error(`Frontmatter key ${key} must be an object`);
  }

  return { ...value };
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

function readOptionalMemoryTags(attributes: Record<string, unknown>): string[] {
  const rawTags = getMemoryAttribute(attributes, 'tags');
  if (rawTags === undefined || rawTags === null) {
    return [];
  }

  if (!Array.isArray(rawTags)) {
    throw new Error('Frontmatter key tags must be a string array');
  }

  const tags = rawTags.map((tag) => {
    if (typeof tag !== 'string') {
      throw new Error('Frontmatter key tags must be a string array');
    }

    const trimmed = tag.trim();
    if (trimmed.length === 0) {
      throw new Error('Frontmatter key tags must not include empty values');
    }

    return trimmed;
  });

  return [...new Set(tags)];
}

function readLooseString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readLooseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value
    .map((item) => readLooseString(item))
    .filter((item): item is string => Boolean(item)))];
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

  const first = paragraphs[0];
  if (!first) {
    return undefined;
  }

  const cleaned = first
    .replace(/\s+/g, ' ')
    .replace(/^[-*]\s+/, '')
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function humanizeReferenceName(value: string): string {
  return value
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function listReferenceMarkdownFiles(memoryDir: string): string[] {
  const referencesDir = join(memoryDir, 'references');
  if (!existsSync(referencesDir)) {
    return [];
  }

  const files: string[] = [];
  const stack = [referencesDir];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    const entries = readdirSync(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  return files.sort((left, right) => left.localeCompare(right));
}

export function validateMemoryDocId(id: string): void {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || id.endsWith('-') || id.includes('--')) {
    throw new Error('Memory name must match skill-style rules: lowercase letters, numbers, hyphens, no trailing hyphen, no consecutive hyphens, max 64 chars');
  }
}

function validateMemoryUpdated(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Frontmatter key metadata.updated must use YYYY-MM-DD format');
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error('Frontmatter key metadata.updated must be a valid calendar date');
  }
}

interface MemoryDocFileLocation {
  filePath: string;
  packageId: string;
  packagePath: string;
}

function buildParsedMemoryDoc(options: {
  filePath: string;
  packageId: string;
  packagePath: string;
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
  metadata: Record<string, unknown>;
  referencePaths: string[];
}): ParsedMemoryDoc {
  const dirPath = dirname(options.filePath);

  return {
    filePath: options.filePath,
    dirPath,
    fileName: basename(options.filePath),
    packageId: options.packageId,
    packagePath: options.packagePath,
    id: options.id,
    title: options.title,
    summary: options.summary,
    type: options.type,
    status: options.status,
    ...(options.area ? { area: options.area } : {}),
    ...(options.role ? { role: options.role } : {}),
    ...(options.parent ? { parent: options.parent } : {}),
    related: options.related,
    tags: options.tags,
    updated: options.updated,
    body: options.body,
    metadata: options.metadata,
    referencePaths: options.referencePaths,
  };
}

function parseNewMemoryDoc(location: MemoryDocFileLocation, attributes: Record<string, unknown>, body: string): ParsedMemoryDoc {
  const id = readRequiredMemoryString(attributes, 'name');
  validateMemoryDocId(id);

  if (id !== location.packageId) {
    throw new Error(`Frontmatter key name must match package directory (${location.packageId})`);
  }

  const metadata = readOptionalMemoryRecord(attributes, 'metadata');
  const updated = readOptionalMemoryString(metadata, 'updated') ?? '';
  if (updated) {
    validateMemoryUpdated(updated);
  }

  const area = readOptionalMemoryString(metadata, 'area');
  if (area) {
    validateMemoryDocId(area);
  }

  const role = readOptionalMemoryString(metadata, 'role') ?? 'hub';
  if (role !== 'hub') {
    throw new Error('Top-level memory packages must use metadata.role=hub when role is provided');
  }

  const parent = readOptionalMemoryString(metadata, 'parent');
  if (parent) {
    throw new Error('Top-level memory packages must not declare metadata.parent');
  }

  const related = readOptionalMemoryStringArray(metadata, 'related');
  for (const relatedId of related) {
    validateMemoryDocId(relatedId);
  }

  return buildParsedMemoryDoc({
    filePath: location.filePath,
    packageId: location.packageId,
    packagePath: location.packagePath,
    id,
    title: readOptionalMemoryString(metadata, 'title') ?? extractMarkdownTitle(body) ?? id,
    summary: readRequiredMemoryString(attributes, 'description'),
    type: readOptionalMemoryString(metadata, 'type') ?? 'note',
    status: readOptionalMemoryString(metadata, 'status') ?? 'active',
    ...(area ? { area } : {}),
    ...(role ? { role } : {}),
    ...(parent ? { parent } : {}),
    related,
    tags: readOptionalMemoryTags(metadata),
    updated,
    body,
    metadata,
    referencePaths: listReferenceMarkdownFiles(location.packagePath),
  });
}

function parseMemoryDoc(location: MemoryDocFileLocation, rawContent: string): ParsedMemoryDoc {
  const section = splitMemoryFrontmatter(rawContent);
  const attributes = section.attributes;
  const body = section.body.trim();
  if (body.length === 0) {
    throw new Error('Memory markdown body must not be empty');
  }

  return parseNewMemoryDoc(location, attributes, body);
}

function listMemoryDocFiles(memoryDir: string): MemoryDocFileLocation[] {
  if (!existsSync(memoryDir)) {
    return [];
  }

  const entries = readdirSync(memoryDir, { withFileTypes: true });
  const files: MemoryDocFileLocation[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageId = entry.name;
    const packagePath = join(memoryDir, packageId);
    const memoryFile = join(packagePath, 'MEMORY.md');
    if (!existsSync(memoryFile)) {
      continue;
    }

    files.push({
      filePath: memoryFile,
      packageId,
      packagePath,
    });
  }

  return files.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

export function loadMemoryDocs(options: LoadMemoryDocsOptions = {}): LoadMemoryDocsResult {
  migrateLegacyProfileMemoryDirs(options);
  const context = resolveMemoryContext(options);
  const files = listMemoryDocFiles(context.memoryDir);
  const docs: ParsedMemoryDoc[] = [];
  const parseErrors: MemoryDocParseError[] = [];

  for (const file of files) {
    try {
      docs.push(parseMemoryDoc(file, readFileSync(file.filePath, 'utf-8')));
    } catch (error) {
      parseErrors.push({
        filePath: file.filePath,
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

function splitOptionalMemoryFrontmatter(rawContent: string): { attributes: Record<string, unknown> | null; body: string } {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  if (!normalized.startsWith(`${MEMORY_FRONTMATTER_DELIMITER}\n`)) {
    return { attributes: null, body: normalized.trim() };
  }

  try {
    const section = splitMemoryFrontmatter(normalized);
    return {
      attributes: section.attributes,
      body: section.body.trim(),
    };
  } catch {
    return { attributes: null, body: normalized.trim() };
  }
}

function parseMemoryReference(filePath: string, packagePath: string): ParsedMemoryReference {
  const rawContent = readFileSync(filePath, 'utf-8');
  const section = splitOptionalMemoryFrontmatter(rawContent);
  const attributes = section.attributes ?? {};
  const metadata = isMemoryRecord(attributes.metadata) ? { ...(attributes.metadata as Record<string, unknown>) } : {};
  const basenameWithoutExt = basename(filePath, '.md');
  const title = readLooseString(metadata.title)
    ?? readLooseString(attributes.title)
    ?? extractMarkdownTitle(section.body)
    ?? humanizeReferenceName(basenameWithoutExt);
  const summary = readLooseString(attributes.description)
    ?? readLooseString(metadata.summary)
    ?? extractFirstParagraph(section.body)
    ?? title;
  const updated = readLooseString(metadata.updated) ?? '';

  return {
    filePath,
    fileName: basename(filePath),
    relativePath: relative(packagePath, filePath).replace(/\\/g, '/'),
    id: readLooseString(attributes.name) ?? basenameWithoutExt,
    title,
    summary,
    tags: readLooseStringArray(metadata.tags),
    updated,
    body: section.body,
    metadata,
  };
}

export function loadMemoryPackageReferences(packagePath: string): ParsedMemoryReference[] {
  return listReferenceMarkdownFiles(packagePath)
    .map((filePath) => parseMemoryReference(filePath, packagePath))
    .sort((left, right) => right.updated.localeCompare(left.updated) || left.title.localeCompare(right.title));
}

export function resolveMemoryDocById(docs: ParsedMemoryDoc[], id: string): ParsedMemoryDoc {
  const normalizedId = id.trim();
  const matches = docs.filter((doc) => doc.id === normalizedId);

  if (matches.length === 0) {
    throw new Error(`No memory package found with id: ${normalizedId}`);
  }

  if (matches.length > 1) {
    const files = matches.map((doc) => doc.filePath).join(', ');
    throw new Error(`Memory package id is ambiguous (${normalizedId}). Matches: ${files}`);
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
          error: 'parent must not reference the same memory package',
        });
      } else if (!ids.has(doc.parent)) {
        errors.push({
          filePath: doc.filePath,
          id: doc.id,
          field: 'parent',
          targetId: doc.parent,
          error: 'parent does not match any memory package id',
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
          error: 'related must not reference the same memory package',
        });
        continue;
      }

      if (!ids.has(relatedId)) {
        errors.push({
          filePath: doc.filePath,
          id: doc.id,
          field: 'related',
          targetId: relatedId,
          error: 'related does not match any memory package id',
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
      const referenceText = doc.referencePaths
        .map((filePath) => {
          try {
            return readFileSync(filePath, 'utf-8');
          } catch {
            return '';
          }
        })
        .join(' ');
      const haystack = [
        doc.id,
        doc.title,
        doc.summary,
        doc.type,
        doc.status,
        doc.area,
        doc.role,
        doc.parent,
        doc.body,
        referenceText,
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

function stringifyMemoryMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const frontmatterText = stringify(frontmatter).trimEnd();
  const normalizedBody = body.replace(/^\n+/, '');
  return `---\n${frontmatterText}\n---\n\n${normalizedBody.replace(/\s*$/, '\n')}`;
}

function buildMemoryFrontmatter(options: {
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
}): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    title: options.title,
    type: options.type,
    status: options.status,
    tags: options.tags,
    updated: options.updated,
  };

  if (options.area) {
    metadata.area = options.area;
  }

  if (options.role) {
    metadata.role = options.role;
  }

  if (options.parent) {
    metadata.parent = options.parent;
  }

  if (options.related.length > 0) {
    metadata.related = options.related;
  }

  return {
    name: options.id,
    description: options.summary,
    metadata,
  };
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
  return stringifyMemoryMarkdown(
    buildMemoryFrontmatter(options),
    `# ${options.title}\n\n${options.summary}\n\nTODO: add details.`,
  );
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
  if (role && role !== 'hub') {
    throw new Error('Top-level memory packages must use role=hub when role is provided.');
  }

  const parent = input.parent?.trim();
  if (parent) {
    throw new Error('Top-level memory packages must not set parent.');
  }

  const related = [...new Set((input.related ?? []).map((value) => value.trim()).filter((value) => value.length > 0))];
  for (const relatedId of related) {
    validateMemoryDocId(relatedId);
  }

  const updated = input.updated?.trim() || currentDateYyyyMmDd();
  validateMemoryUpdated(updated);

  migrateLegacyProfileMemoryDirs(options);

  const context = resolveMemoryContext(options);
  mkdirSync(context.memoryDir, { recursive: true });

  const targetDir = join(context.memoryDir, id);
  const targetPath = join(targetDir, 'MEMORY.md');
  const loaded = loadMemoryDocs(options);
  const existingDoc = loaded.docs.find((doc) => doc.id === id);
  const targetExists = existsSync(targetPath);

  if (!input.force) {
    if (targetExists) {
      throw new Error(`Memory package already exists: ${targetPath} (use --force to overwrite)`);
    }

    if (existingDoc && existingDoc.filePath !== targetPath) {
      throw new Error(`Memory package id already exists in another file: ${existingDoc.filePath} (use --force to overwrite ${targetPath})`);
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

  mkdirSync(targetDir, { recursive: true });
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
    role: role ?? 'hub',
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
