import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { basename, join } from 'path';
import { parseDocument } from 'yaml';
import { resolveResourceProfile } from '@personal-agent/resources';
import { readConfig } from './config.js';
import { bullet, dim, formatHint, keyValue, section, success, warning } from './ui.js';

const MEMORY_FRONTMATTER_DELIMITER = '---';

interface MemoryDocParseError {
  filePath: string;
  error: string;
}

interface ParsedMemoryDoc {
  filePath: string;
  fileName: string;
  id: string;
  title: string;
  summary: string;
  type: string;
  status: string;
  tags: string[];
  updated: string;
  body: string;
}

interface MemoryFrontmatterSection {
  attributes: Record<string, unknown>;
  body: string;
}

interface ResolvedMemoryContext {
  profileName: string;
  memoryDir?: string;
}

function resolveProfileName(): string {
  return readConfig().defaultProfile;
}

function memoryUsageText(): string {
  return 'Usage: pa memory [list|find|show|new|lint] [args...]';
}

function memoryListUsageText(): string {
  return 'Usage: pa memory list [--profile <name>] [--json]';
}

function memoryFindUsageText(): string {
  return 'Usage: pa memory find [--profile <name>] [--tag <tag>] [--type <type>] [--status <status>] [--text <query>] [--json]';
}

function memoryShowUsageText(): string {
  return 'Usage: pa memory show <id> [--profile <name>] [--json]';
}

function memoryNewUsageText(): string {
  return 'Usage: pa memory new <id> --title <title> --summary <summary> --tags <tag1,tag2> [--type <type>] [--status <status>] [--profile <name>] [--force] [--json]';
}

function memoryLintUsageText(): string {
  return 'Usage: pa memory lint [--profile <name>] [--json]';
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

function validateMemoryDocId(id: string): void {
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

function loadMemoryDocs(memoryDir: string): {
  docs: ParsedMemoryDoc[];
  parseErrors: MemoryDocParseError[];
} {
  const files = listMemoryDocFiles(memoryDir);
  const docs: ParsedMemoryDoc[] = [];
  const parseErrors: MemoryDocParseError[] = [];

  for (const filePath of files) {
    try {
      const doc = parseMemoryDoc(filePath, readFileSync(filePath, 'utf-8'));
      docs.push(doc);
    } catch (error) {
      parseErrors.push({
        filePath,
        error: (error as Error).message,
      });
    }
  }

  docs.sort((left, right) => left.id.localeCompare(right.id) || left.filePath.localeCompare(right.filePath));

  return {
    docs,
    parseErrors,
  };
}

function resolveMemoryContext(profileName: string): ResolvedMemoryContext {
  const resolvedProfile = resolveResourceProfile(profileName);

  if (resolvedProfile.name === 'shared') {
    return {
      profileName: resolvedProfile.name,
      memoryDir: undefined,
    };
  }

  const profileLayer = [...resolvedProfile.layers]
    .reverse()
    .find((layer) => layer.name === resolvedProfile.name);

  const profileAgentDir = profileLayer?.agentDir ?? join(resolvedProfile.profilesRoot, resolvedProfile.name, 'agent');

  return {
    profileName: resolvedProfile.name,
    memoryDir: join(profileAgentDir, 'memory'),
  };
}

function parseMemoryProfileOption(
  args: string[],
  index: number,
  usage: string,
): { profileName: string; nextIndex: number } {
  const arg = args[index];
  if (!arg) {
    throw new Error(usage);
  }

  if (arg === '--profile') {
    const value = args[index + 1];
    if (!value || value.startsWith('-')) {
      throw new Error(usage);
    }

    return {
      profileName: value,
      nextIndex: index + 1,
    };
  }

  if (arg.startsWith('--profile=')) {
    const value = arg.slice('--profile='.length).trim();
    if (value.length === 0) {
      throw new Error(usage);
    }

    return {
      profileName: value,
      nextIndex: index,
    };
  }

  throw new Error(usage);
}

function formatMemoryTags(tags: string[]): string {
  return tags.length > 0 ? tags.join(', ') : 'none';
}

function resolveMemoryDocById(docs: ParsedMemoryDoc[], id: string): ParsedMemoryDoc {
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

function collectDuplicateMemoryDocIds(docs: ParsedMemoryDoc[]): Array<{ id: string; files: string[] }> {
  const index = new Map<string, string[]>();

  for (const doc of docs) {
    const existing = index.get(doc.id) ?? [];
    existing.push(doc.filePath);
    index.set(doc.id, existing);
  }

  const duplicates: Array<{ id: string; files: string[] }> = [];

  for (const [id, files] of index.entries()) {
    if (files.length > 1) {
      duplicates.push({
        id,
        files,
      });
    }
  }

  duplicates.sort((left, right) => left.id.localeCompare(right.id));
  return duplicates;
}

function splitMemoryTagValues(rawValues: string[]): string[] {
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

function currentDateYyyyMmDd(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function toYamlQuotedString(value: string): string {
  return JSON.stringify(value);
}

function buildMemoryDocTemplate(options: {
  id: string;
  title: string;
  summary: string;
  type: string;
  status: string;
  tags: string[];
  updated: string;
}): string {
  const tagLines = options.tags.map((tag) => `  - ${toYamlQuotedString(tag)}`).join('\n');

  return `---
id: ${options.id}
title: ${toYamlQuotedString(options.title)}
summary: ${toYamlQuotedString(options.summary)}
type: ${toYamlQuotedString(options.type)}
status: ${toYamlQuotedString(options.status)}
tags:
${tagLines}
updated: ${options.updated}
---

# ${options.title}

${options.summary}

TODO: add details.
`;
}

export async function memoryCommand(args: string[]): Promise<number> {
  const [subcommand, ...rest] = args;

  if (!subcommand) {
    console.log(section('Memory commands'));
    console.log('');
    console.log(`Usage: pa memory [list|find|show|new|lint]

Commands:
  list [--profile <name>] [--json]
                           List parsed memory docs for one profile
  find [--profile <name>] [--tag <tag>] [--type <type>] [--status <status>] [--text <query>] [--json]
                           Filter memory docs by metadata fields
  show <id> [--profile <name>] [--json]
                           Show one memory doc and metadata
  new <id> --title <title> --summary <summary> --tags <tag1,tag2> [--type <type>] [--status <status>] [--profile <name>] [--force] [--json]
                           Create a new memory doc template with YAML frontmatter
  lint [--profile <name>] [--json]
                           Validate memory doc frontmatter and duplicate ids
`);

    console.log(keyValue('Default profile', resolveProfileName()));
    return 0;
  }

  if (subcommand === 'list') {
    let profileName = resolveProfileName();
    let jsonMode = false;

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      if (arg === '--profile' || arg.startsWith('--profile=')) {
        const parsed = parseMemoryProfileOption(rest, index, memoryListUsageText());
        profileName = parsed.profileName;
        index = parsed.nextIndex;
        continue;
      }

      throw new Error(memoryListUsageText());
    }

    const context = resolveMemoryContext(profileName);
    const loaded = context.memoryDir ? loadMemoryDocs(context.memoryDir) : { docs: [], parseErrors: [] };

    const payload = {
      profile: context.profileName,
      memoryDir: context.memoryDir ?? null,
      docs: loaded.docs,
      parseErrors: loaded.parseErrors,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section('Profile memory docs'));
    console.log(keyValue('Profile', context.profileName));
    console.log(keyValue('Memory dir', context.memoryDir ?? 'none (shared profile has no memory dir)'));

    if (!context.memoryDir) {
      console.log(dim('Shared profile does not have a profile-local memory directory.'));
    } else if (loaded.docs.length === 0) {
      console.log(dim('No memory docs found.'));
    }

    for (const doc of loaded.docs) {
      console.log('');
      console.log(bullet(`${doc.id}: ${doc.title}`));
      console.log(keyValue('Type', doc.type, 4));
      console.log(keyValue('Status', doc.status, 4));
      console.log(keyValue('Updated', doc.updated, 4));
      console.log(keyValue('Tags', formatMemoryTags(doc.tags), 4));
      console.log(keyValue('Summary', doc.summary, 4));
      console.log(keyValue('File', doc.filePath, 4));
    }

    if (loaded.parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${loaded.parseErrors.length} memory doc(s) failed to parse`));
      for (const issue of loaded.parseErrors) {
        console.log(keyValue('Parse error', `${issue.filePath}: ${issue.error}`, 4));
      }
    }

    return loaded.parseErrors.length > 0 ? 1 : 0;
  }

  if (subcommand === 'find') {
    let profileName = resolveProfileName();
    let jsonMode = false;
    let typeFilter: string | undefined;
    let statusFilter: string | undefined;
    let textFilter: string | undefined;
    const tagFilters: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      if (arg === '--profile' || arg.startsWith('--profile=')) {
        const parsed = parseMemoryProfileOption(rest, index, memoryFindUsageText());
        profileName = parsed.profileName;
        index = parsed.nextIndex;
        continue;
      }

      if (arg === '--tag') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryFindUsageText());
        }

        tagFilters.push(value.trim().toLowerCase());
        index += 1;
        continue;
      }

      if (arg.startsWith('--tag=')) {
        const value = arg.slice('--tag='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryFindUsageText());
        }

        tagFilters.push(value.toLowerCase());
        continue;
      }

      if (arg === '--type') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryFindUsageText());
        }

        typeFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--type=')) {
        const value = arg.slice('--type='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryFindUsageText());
        }

        typeFilter = value.toLowerCase();
        continue;
      }

      if (arg === '--status') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryFindUsageText());
        }

        statusFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--status=')) {
        const value = arg.slice('--status='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryFindUsageText());
        }

        statusFilter = value.toLowerCase();
        continue;
      }

      if (arg === '--text') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryFindUsageText());
        }

        textFilter = value.trim().toLowerCase();
        index += 1;
        continue;
      }

      if (arg.startsWith('--text=')) {
        const value = arg.slice('--text='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryFindUsageText());
        }

        textFilter = value.toLowerCase();
        continue;
      }

      throw new Error(memoryFindUsageText());
    }

    const context = resolveMemoryContext(profileName);
    const loaded = context.memoryDir ? loadMemoryDocs(context.memoryDir) : { docs: [], parseErrors: [] };

    const filteredDocs = loaded.docs.filter((doc) => {
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

      if (textFilter) {
        const haystack = [doc.id, doc.title, doc.summary, ...doc.tags].join(' ').toLowerCase();
        if (!haystack.includes(textFilter)) {
          return false;
        }
      }

      return true;
    });

    const payload = {
      profile: context.profileName,
      memoryDir: context.memoryDir ?? null,
      filters: {
        tags: tagFilters,
        type: typeFilter ?? null,
        status: statusFilter ?? null,
        text: textFilter ?? null,
      },
      docs: filteredDocs,
      parseErrors: loaded.parseErrors,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section('Memory doc search'));
    console.log(keyValue('Profile', context.profileName));
    console.log(keyValue('Memory dir', context.memoryDir ?? 'none (shared profile has no memory dir)'));
    console.log(keyValue('Tag filters', tagFilters.length > 0 ? tagFilters.join(', ') : 'none'));
    console.log(keyValue('Type filter', typeFilter ?? 'none'));
    console.log(keyValue('Status filter', statusFilter ?? 'none'));
    console.log(keyValue('Text filter', textFilter ?? 'none'));

    if (!context.memoryDir) {
      console.log(dim('Shared profile does not have a profile-local memory directory.'));
    } else if (filteredDocs.length === 0) {
      console.log(dim('No memory docs matched the supplied filters.'));
    }

    for (const doc of filteredDocs) {
      console.log('');
      console.log(bullet(`${doc.id}: ${doc.title}`));
      console.log(keyValue('Type', doc.type, 4));
      console.log(keyValue('Status', doc.status, 4));
      console.log(keyValue('Updated', doc.updated, 4));
      console.log(keyValue('Tags', formatMemoryTags(doc.tags), 4));
      console.log(keyValue('Summary', doc.summary, 4));
      console.log(keyValue('File', doc.filePath, 4));
    }

    if (loaded.parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${loaded.parseErrors.length} memory doc(s) failed to parse`));
      for (const issue of loaded.parseErrors) {
        console.log(keyValue('Parse error', `${issue.filePath}: ${issue.error}`, 4));
      }
    }

    return loaded.parseErrors.length > 0 ? 1 : 0;
  }

  if (subcommand === 'show') {
    let profileName = resolveProfileName();
    let jsonMode = false;
    const positional: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      if (arg === '--profile' || arg.startsWith('--profile=')) {
        const parsed = parseMemoryProfileOption(rest, index, memoryShowUsageText());
        profileName = parsed.profileName;
        index = parsed.nextIndex;
        continue;
      }

      if (arg.startsWith('-')) {
        throw new Error(memoryShowUsageText());
      }

      positional.push(arg);
    }

    if (positional.length !== 1) {
      throw new Error(memoryShowUsageText());
    }

    const context = resolveMemoryContext(profileName);

    if (!context.memoryDir) {
      throw new Error('Shared profile has no profile-local memory directory');
    }

    const loaded = loadMemoryDocs(context.memoryDir);
    const doc = resolveMemoryDocById(loaded.docs, positional[0] as string);

    const payload = {
      profile: context.profileName,
      memoryDir: context.memoryDir,
      doc,
      parseErrors: loaded.parseErrors,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return loaded.parseErrors.length > 0 ? 1 : 0;
    }

    console.log(section(`Memory doc: ${doc.id}`));
    console.log(keyValue('Profile', context.profileName));
    console.log(keyValue('Title', doc.title));
    console.log(keyValue('Type', doc.type));
    console.log(keyValue('Status', doc.status));
    console.log(keyValue('Updated', doc.updated));
    console.log(keyValue('Tags', formatMemoryTags(doc.tags)));
    console.log(keyValue('Summary', doc.summary));
    console.log(keyValue('File', doc.filePath));

    console.log('');
    console.log(section('Body'));
    console.log(doc.body);

    if (loaded.parseErrors.length > 0) {
      console.log('');
      console.log(warning(`${loaded.parseErrors.length} memory doc(s) failed to parse`));
      for (const issue of loaded.parseErrors) {
        console.log(keyValue('Parse error', `${issue.filePath}: ${issue.error}`, 4));
      }
    }

    return loaded.parseErrors.length > 0 ? 1 : 0;
  }

  if (subcommand === 'new') {
    let profileName = resolveProfileName();
    let jsonMode = false;
    let force = false;
    let title: string | undefined;
    let summary: string | undefined;
    let type = 'note';
    let status = 'active';
    const rawTagValues: string[] = [];
    const positional: string[] = [];

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      if (arg === '--force') {
        force = true;
        continue;
      }

      if (arg === '--profile' || arg.startsWith('--profile=')) {
        const parsed = parseMemoryProfileOption(rest, index, memoryNewUsageText());
        profileName = parsed.profileName;
        index = parsed.nextIndex;
        continue;
      }

      if (arg === '--title') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryNewUsageText());
        }

        title = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--title=')) {
        const value = arg.slice('--title='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        title = value;
        continue;
      }

      if (arg === '--summary') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryNewUsageText());
        }

        summary = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--summary=')) {
        const value = arg.slice('--summary='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        summary = value;
        continue;
      }

      if (arg === '--type') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryNewUsageText());
        }

        type = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--type=')) {
        const value = arg.slice('--type='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        type = value;
        continue;
      }

      if (arg === '--status') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryNewUsageText());
        }

        status = value.trim();
        index += 1;
        continue;
      }

      if (arg.startsWith('--status=')) {
        const value = arg.slice('--status='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        status = value;
        continue;
      }

      if (arg === '--tags' || arg === '--tag') {
        const value = rest[index + 1];
        if (!value || value.startsWith('-')) {
          throw new Error(memoryNewUsageText());
        }

        rawTagValues.push(value.trim());
        index += 1;
        continue;
      }

      if (arg.startsWith('--tags=')) {
        const value = arg.slice('--tags='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        rawTagValues.push(value);
        continue;
      }

      if (arg.startsWith('--tag=')) {
        const value = arg.slice('--tag='.length).trim();
        if (value.length === 0) {
          throw new Error(memoryNewUsageText());
        }

        rawTagValues.push(value);
        continue;
      }

      if (arg.startsWith('-')) {
        throw new Error(memoryNewUsageText());
      }

      positional.push(arg);
    }

    if (positional.length !== 1) {
      throw new Error(memoryNewUsageText());
    }

    if (!title || title.length === 0 || !summary || summary.length === 0) {
      throw new Error(memoryNewUsageText());
    }

    const id = (positional[0] as string).trim();
    validateMemoryDocId(id);

    const tags = splitMemoryTagValues(rawTagValues);
    if (tags.length === 0) {
      throw new Error(memoryNewUsageText());
    }

    const context = resolveMemoryContext(profileName);
    if (!context.memoryDir) {
      throw new Error('Shared profile has no profile-local memory directory');
    }

    mkdirSync(context.memoryDir, { recursive: true });

    const targetPath = join(context.memoryDir, `${id}.md`);
    const loaded = loadMemoryDocs(context.memoryDir);
    const existingDoc = loaded.docs.find((doc) => doc.id === id);
    const targetExists = existsSync(targetPath);

    if (!force) {
      if (targetExists) {
        throw new Error(`Memory doc already exists: ${targetPath} (use --force to overwrite)`);
      }

      if (existingDoc && existingDoc.filePath !== targetPath) {
        throw new Error(`Memory doc id already exists in another file: ${existingDoc.filePath} (use --force to overwrite ${targetPath})`);
      }
    }

    const updated = currentDateYyyyMmDd();
    const content = buildMemoryDocTemplate({
      id,
      title,
      summary,
      type,
      status,
      tags,
      updated,
    });

    writeFileSync(targetPath, content, 'utf-8');

    const payload = {
      profile: context.profileName,
      memoryDir: context.memoryDir,
      filePath: targetPath,
      id,
      title,
      summary,
      type,
      status,
      tags,
      updated,
      overwritten: targetExists,
    };

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return 0;
    }

    console.log(section(`Memory doc ${targetExists ? 'updated' : 'created'}`));
    console.log(keyValue('Profile', context.profileName));
    console.log(keyValue('ID', id));
    console.log(keyValue('File', targetPath));
    console.log(keyValue('Type', type));
    console.log(keyValue('Status', status));
    console.log(keyValue('Tags', formatMemoryTags(tags)));
    console.log(keyValue('Updated', updated));

    console.log('');
    console.log(success(`Memory doc ${targetExists ? 'updated' : 'created'}:`, id));
    console.log(`  ${formatHint(`Edit ${targetPath} to add details`)}`);
    return 0;
  }

  if (subcommand === 'lint') {
    let profileName = resolveProfileName();
    let jsonMode = false;

    for (let index = 0; index < rest.length; index += 1) {
      const arg = rest[index] as string;

      if (arg === '--json') {
        jsonMode = true;
        continue;
      }

      if (arg === '--profile' || arg.startsWith('--profile=')) {
        const parsed = parseMemoryProfileOption(rest, index, memoryLintUsageText());
        profileName = parsed.profileName;
        index = parsed.nextIndex;
        continue;
      }

      throw new Error(memoryLintUsageText());
    }

    const context = resolveMemoryContext(profileName);
    const loaded = context.memoryDir ? loadMemoryDocs(context.memoryDir) : { docs: [], parseErrors: [] };
    const duplicates = collectDuplicateMemoryDocIds(loaded.docs);

    const payload = {
      profile: context.profileName,
      memoryDir: context.memoryDir ?? null,
      checked: loaded.docs.length + loaded.parseErrors.length,
      validDocs: loaded.docs.length,
      parseErrors: loaded.parseErrors,
      duplicateIds: duplicates,
    };

    const hasIssues = loaded.parseErrors.length > 0 || duplicates.length > 0;

    if (jsonMode) {
      console.log(JSON.stringify(payload, null, 2));
      return hasIssues ? 1 : 0;
    }

    console.log(section('Memory validation'));
    console.log(keyValue('Profile', context.profileName));
    console.log(keyValue('Memory dir', context.memoryDir ?? 'none (shared profile has no memory dir)'));
    console.log(keyValue('Docs parsed', loaded.docs.length));
    console.log(keyValue('Parse errors', loaded.parseErrors.length));
    console.log(keyValue('Duplicate ids', duplicates.length));

    if (!context.memoryDir) {
      console.log(dim('Shared profile does not have a profile-local memory directory.'));
      return 0;
    }

    if (loaded.parseErrors.length === 0 && duplicates.length === 0) {
      console.log('');
      console.log(success('All memory docs are valid'));
      return 0;
    }

    if (loaded.parseErrors.length > 0) {
      console.log('');
      console.log(warning('Parse errors'));
      for (const issue of loaded.parseErrors) {
        console.log(keyValue('Parse error', `${issue.filePath}: ${issue.error}`, 4));
      }
    }

    if (duplicates.length > 0) {
      console.log('');
      console.log(warning('Duplicate ids'));
      for (const duplicate of duplicates) {
        console.log(keyValue('Duplicate', `${duplicate.id} -> ${duplicate.files.join(', ')}`, 4));
      }
    }

    return 1;
  }

  throw new Error(`${memoryUsageText()}\nUnknown memory subcommand: ${subcommand}`);
}
