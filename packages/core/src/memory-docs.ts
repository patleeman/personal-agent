import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { parseDocument, stringify } from 'yaml';
import { getDurableNotesDir, getDurableProfilesDir } from './runtime/paths.js';

export interface ResolveMemoryDocsOptions {
  profilesRoot?: string;
}

export interface LegacyMemoryMigrationRecord {
  from: string;
  to: string;
}

export interface LegacyMemoryMigrationResult {
  memoryDir: string;
  migratedFiles: LegacyMemoryMigrationRecord[];
}

interface ParsedFrontmatter {
  attributes: Record<string, unknown>;
  body: string;
}

function resolveProfilesRootForMemory(options: ResolveMemoryDocsOptions = {}): string {
  return resolve(options.profilesRoot ?? getDurableProfilesDir());
}

export function getMemoryDocsDir(options: ResolveMemoryDocsOptions = {}): string {
  return getDurableNotesDir(dirname(resolveProfilesRootForMemory(options)));
}

function resolveLegacyMemoryDir(options: ResolveMemoryDocsOptions = {}): string {
  return join(dirname(resolveProfilesRootForMemory(options)), 'memory');
}

function parseFrontmatter(rawContent: string): ParsedFrontmatter | null {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return null;
  }

  const document = parseDocument(match[1] ?? '', {
    prettyErrors: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    return null;
  }

  const parsed = document.toJS({ mapAsMap: false }) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  return {
    attributes: parsed as Record<string, unknown>,
    body: (match[2] ?? '').replace(/^\n+/, ''),
  };
}

function stringifyMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const frontmatterText = stringify(frontmatter, {
    lineWidth: 0,
    indent: 2,
    minContentWidth: 0,
  }).trimEnd();
  const normalizedBody = body.replace(/\r\n/g, '\n').trim();
  return `---\n${frontmatterText}\n---\n\n${normalizedBody.length > 0 ? `${normalizedBody}\n` : ''}`;
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

function humanizeId(value: string): string {
  return value
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeNoteNodeMarkdown(rawContent: string, fallbackId: string): { id: string; content: string } {
  const parsed = parseFrontmatter(rawContent);
  if (!parsed) {
    const title = humanizeId(fallbackId);
    const summary = extractFirstParagraph(rawContent) ?? `Durable note for ${title}.`;
    return {
      id: fallbackId,
      content: stringifyMarkdown({
        id: fallbackId,
        kind: 'note',
        title,
        summary,
        status: 'active',
      }, rawContent.trim().length > 0 ? rawContent : `# ${title}\n\n${summary}`),
    };
  }

  const attributes = parsed.attributes;
  const metadataValue = attributes.metadata;
  const metadata = metadataValue && typeof metadataValue === 'object' && !Array.isArray(metadataValue)
    ? { ...(metadataValue as Record<string, unknown>) }
    : {};

  if (readOptionalString(attributes.kind) === 'note') {
    const id = readOptionalString(attributes.id) ?? fallbackId;
    const title = readOptionalString(attributes.title) ?? extractMarkdownTitle(parsed.body) ?? humanizeId(id);
    const summary = readOptionalString(attributes.summary) ?? extractFirstParagraph(parsed.body) ?? `Durable note for ${title}.`;
    const status = readOptionalString(attributes.status) ?? 'active';
    const updatedAt = readOptionalString(attributes.updatedAt);
    const frontmatter: Record<string, unknown> = {
      ...attributes,
      id,
      kind: 'note',
      title,
      summary,
      status,
      ...(updatedAt ? { updatedAt } : {}),
      ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
    };
    delete frontmatter.links;
    delete frontmatter.parent;
    delete frontmatter.related;
    return {
      id,
      content: stringifyMarkdown(frontmatter, parsed.body.trim().length > 0 ? parsed.body : `# ${title}\n\n${summary}`),
    };
  }

  const legacyId = readOptionalString(attributes.name)
    ?? readOptionalString(attributes.id)
    ?? fallbackId;
  const legacySummary = readOptionalString(attributes.description)
    ?? readOptionalString(attributes.summary)
    ?? extractFirstParagraph(parsed.body)
    ?? `Durable note for ${humanizeId(legacyId)}.`;
  const legacyTitle = readOptionalString(metadata.title)
    ?? readOptionalString(attributes.title)
    ?? extractMarkdownTitle(parsed.body)
    ?? humanizeId(legacyId);
  const legacyStatus = readOptionalString(metadata.status)
    ?? readOptionalString(attributes.status)
    ?? 'active';
  const legacyType = readOptionalString(metadata.type)
    ?? readOptionalString(attributes.type);
  const legacyArea = readOptionalString(metadata.area)
    ?? readOptionalString(attributes.area);
  const legacyRole = readOptionalString(metadata.role)
    ?? readOptionalString(attributes.role);
  const updatedAt = readOptionalString(metadata.updated)
    ?? readOptionalString(attributes.updatedAt)
    ?? readOptionalString(attributes.updated);

  const extraMetadata = { ...metadata };
  delete extraMetadata.title;
  delete extraMetadata.status;
  delete extraMetadata.type;
  delete extraMetadata.area;
  delete extraMetadata.role;
  delete extraMetadata.parent;
  delete extraMetadata.related;
  delete extraMetadata.tags;
  delete extraMetadata.updated;

  const nextMetadata: Record<string, unknown> = {
    ...(legacyType ? { type: legacyType } : {}),
    ...(legacyArea ? { area: legacyArea } : {}),
    ...(legacyRole ? { role: legacyRole === 'hub' ? 'structure' : legacyRole } : {}),
    ...extraMetadata,
  };

  return {
    id: legacyId,
    content: stringifyMarkdown({
      id: legacyId,
      kind: 'note',
      title: legacyTitle,
      summary: legacySummary,
      status: legacyStatus,
      ...(updatedAt ? { updatedAt } : {}),
      ...(Object.keys(nextMetadata).length > 0 ? { metadata: nextMetadata } : {}),
    }, parsed.body.trim().length > 0 ? parsed.body : `# ${legacyTitle}\n\n${legacySummary}`),
  };
}

function listLegacyProfileMemoryFiles(profilesRoot: string): string[] {
  if (!existsSync(profilesRoot)) {
    return [];
  }

  return readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_memory')
    .flatMap((entry) => {
      const memoryDir = join(profilesRoot, entry.name, 'agent', 'memory');
      if (!existsSync(memoryDir)) {
        return [];
      }

      return readdirSync(memoryDir, { withFileTypes: true })
        .filter((file) => file.isFile() && file.name.endsWith('.md'))
        .map((file) => join(memoryDir, file.name));
    })
    .sort();
}

function listFlatLegacySharedMemoryFiles(memoryDir: string): string[] {
  if (!existsSync(memoryDir)) {
    return [];
  }

  return readdirSync(memoryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(memoryDir, entry.name))
    .sort();
}

function removeDirIfEmpty(path: string): void {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return;
  }

  if (readdirSync(path).length === 0) {
    rmSync(path, { recursive: true, force: true });
  }
}

function migrateLegacyMemoryPackageDir(sourceDir: string, notesDir: string): LegacyMemoryMigrationRecord | null {
  const memoryFile = join(sourceDir, 'MEMORY.md');
  if (!existsSync(memoryFile)) {
    return null;
  }

  const normalized = normalizeNoteNodeMarkdown(readFileSync(memoryFile, 'utf-8'), basename(sourceDir));
  const targetDir = join(notesDir, normalized.id);
  const targetIndex = join(targetDir, 'INDEX.md');

  if (!existsSync(targetDir)) {
    mkdirSync(dirname(targetDir), { recursive: true });
    renameSync(sourceDir, targetDir);
  } else {
    mkdirSync(targetDir, { recursive: true });
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      if (entry.name === 'MEMORY.md') {
        continue;
      }

      const sourcePath = join(sourceDir, entry.name);
      const targetPath = join(targetDir, entry.name);
      if (existsSync(targetPath)) {
        continue;
      }

      cpSync(sourcePath, targetPath, { recursive: true });
    }
    rmSync(sourceDir, { recursive: true, force: true });
  }

  const migratedLegacyIndex = join(targetDir, 'MEMORY.md');
  if (existsSync(migratedLegacyIndex)) {
    rmSync(migratedLegacyIndex, { force: true });
  }

  writeFileSync(targetIndex, normalized.content, 'utf-8');
  return { from: memoryFile, to: targetIndex };
}

function migrateLooseLegacyMemoryFile(sourcePath: string, notesDir: string): LegacyMemoryMigrationRecord | null {
  const normalized = normalizeNoteNodeMarkdown(readFileSync(sourcePath, 'utf-8'), basename(sourcePath, '.md'));
  const targetDir = join(notesDir, normalized.id);
  const targetIndex = join(targetDir, 'INDEX.md');
  mkdirSync(targetDir, { recursive: true });
  writeFileSync(targetIndex, normalized.content, 'utf-8');
  rmSync(sourcePath, { force: true });
  removeDirIfEmpty(dirname(sourcePath));
  return { from: sourcePath, to: targetIndex };
}

export function migrateLegacyProfileMemoryDirs(options: ResolveMemoryDocsOptions = {}): LegacyMemoryMigrationResult {
  const profilesRoot = resolveProfilesRootForMemory(options);
  const notesDir = getMemoryDocsDir({ profilesRoot });
  const legacySyncMemoryDir = resolveLegacyMemoryDir({ profilesRoot });
  const migratedFiles: LegacyMemoryMigrationRecord[] = [];

  mkdirSync(notesDir, { recursive: true });

  if (existsSync(legacySyncMemoryDir) && resolve(legacySyncMemoryDir) !== resolve(notesDir)) {
    const legacyPackages = readdirSync(legacySyncMemoryDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(legacySyncMemoryDir, entry.name))
      .sort();

    for (const packageDir of legacyPackages) {
      const migrated = migrateLegacyMemoryPackageDir(packageDir, notesDir);
      if (migrated) {
        migratedFiles.push(migrated);
      }
    }

    for (const filePath of listFlatLegacySharedMemoryFiles(legacySyncMemoryDir)) {
      const migrated = migrateLooseLegacyMemoryFile(filePath, notesDir);
      if (migrated) {
        migratedFiles.push(migrated);
      }
    }

    removeDirIfEmpty(legacySyncMemoryDir);
  }

  for (const filePath of listLegacyProfileMemoryFiles(profilesRoot)) {
    const migrated = migrateLooseLegacyMemoryFile(filePath, notesDir);
    if (migrated) {
      migratedFiles.push(migrated);
    }
  }

  return {
    memoryDir: notesDir,
    migratedFiles,
  };
}
