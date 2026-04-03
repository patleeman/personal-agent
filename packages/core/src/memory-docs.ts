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
import { getDurableNotesDir, getDurableProfilesDir, getPiAgentRuntimeDir } from './runtime/paths.js';

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

function resolveLegacyRuntimeNotesDir(options: ResolveMemoryDocsOptions = {}): string {
  return join(getPiAgentRuntimeDir(dirname(dirname(resolveProfilesRootForMemory(options)))), 'notes');
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
        title,
        summary,
        status: 'active',
        tags: ['status:active', 'type:note'],
      }, rawContent.trim().length > 0 ? rawContent : `# ${title}\n\n${summary}`),
    };
  }

  const attributes = parsed.attributes;
  const metadataValue = attributes.metadata;
  const metadata = metadataValue && typeof metadataValue === 'object' && !Array.isArray(metadataValue)
    ? { ...(metadataValue as Record<string, unknown>) }
    : {};
  const linksValue = attributes.links;
  const links = linksValue && typeof linksValue === 'object' && !Array.isArray(linksValue)
    ? { ...(linksValue as Record<string, unknown>) }
    : {};
  const legacyTags = Array.isArray(attributes.tags)
    ? (attributes.tags as unknown[])
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    : [];

  const id = readOptionalString(attributes.id)
    ?? readOptionalString(attributes.name)
    ?? fallbackId;
  const title = readOptionalString(attributes.title)
    ?? readOptionalString(metadata.title)
    ?? extractMarkdownTitle(parsed.body)
    ?? humanizeId(id);
  const summary = readOptionalString(attributes.summary)
    ?? readOptionalString(attributes.description)
    ?? extractFirstParagraph(parsed.body)
    ?? `Durable note for ${title}.`;
  const description = readOptionalString(attributes.description);
  const rawRole = readOptionalString(metadata.role) ?? readOptionalString(attributes.role);
  const role = rawRole === 'hub' ? 'structure' : rawRole;
  const status = readOptionalString(attributes.status)
    ?? readOptionalString(metadata.status)
    ?? 'active';
  const noteType = readOptionalString(metadata.type)
    ?? readOptionalString(attributes.type);
  const area = readOptionalString(metadata.area)
    ?? readOptionalString(attributes.area);
  const updatedAt = readOptionalString(metadata.updated)
    ?? readOptionalString(attributes.updatedAt)
    ?? readOptionalString(attributes.updated);

  const tags = [...new Set([
    ...legacyTags.filter((tag) => !/^type:/i.test(tag) && !/^status:/i.test(tag) && !/^noteType:/i.test(tag) && !/^area:/i.test(tag) && !/^role:/i.test(tag)),
    'type:note',
    `status:${status}`,
    ...(noteType ? [`noteType:${noteType}`] : []),
    ...(area ? [`area:${area}`] : []),
    ...(role ? [`role:${role}`] : []),
  ])].sort((left, right) => left.localeCompare(right));

  return {
    id,
    content: stringifyMarkdown({
      id,
      title,
      summary,
      ...(description ? { description } : {}),
      status,
      ...(updatedAt ? { updatedAt } : {}),
      tags,
      ...(Object.keys(links).length > 0 ? { links } : {}),
    }, parsed.body.trim().length > 0 ? parsed.body : `# ${title}\n\n${summary}`),
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

function migrateLegacyRuntimeNoteFile(sourcePath: string, notesDir: string): LegacyMemoryMigrationRecord | null {
  const normalized = normalizeNoteNodeMarkdown(readFileSync(sourcePath, 'utf-8'), basename(sourcePath, '.md'));
  const targetPath = join(notesDir, `${normalized.id}.md`);

  if (existsSync(targetPath)) {
    const existingNormalized = normalizeNoteNodeMarkdown(readFileSync(targetPath, 'utf-8'), basename(targetPath, '.md'));
    if (existingNormalized.content === normalized.content) {
      rmSync(sourcePath, { force: true });
      removeDirIfEmpty(dirname(sourcePath));
    }
    return null;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, normalized.content, 'utf-8');
  rmSync(sourcePath, { force: true });
  removeDirIfEmpty(dirname(sourcePath));
  return { from: sourcePath, to: targetPath };
}

export function migrateLegacyProfileMemoryDirs(options: ResolveMemoryDocsOptions = {}): LegacyMemoryMigrationResult {
  const profilesRoot = resolveProfilesRootForMemory(options);
  const notesDir = getMemoryDocsDir({ profilesRoot });
  const legacySyncMemoryDir = resolveLegacyMemoryDir({ profilesRoot });
  const legacyRuntimeNotesDir = resolveLegacyRuntimeNotesDir({ profilesRoot });
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

  if (existsSync(legacyRuntimeNotesDir)) {
    const runtimeFiles = readdirSync(legacyRuntimeNotesDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(legacyRuntimeNotesDir, entry.name))
      .sort();

    for (const filePath of runtimeFiles) {
      const migrated = migrateLegacyRuntimeNoteFile(filePath, notesDir);
      if (migrated) {
        migratedFiles.push(migrated);
      }
    }

    removeDirIfEmpty(legacyRuntimeNotesDir);
  }

  return {
    memoryDir: notesDir,
    migratedFiles,
  };
}
