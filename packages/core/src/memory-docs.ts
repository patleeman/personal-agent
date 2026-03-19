import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { parseDocument, stringify } from 'yaml';
import { getProfilesRoot } from './runtime/paths.js';

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

function resolveProfilesRootForMemory(options: ResolveMemoryDocsOptions = {}): string {
  return resolve(options.profilesRoot ?? getProfilesRoot());
}

export function getMemoryDocsDir(options: ResolveMemoryDocsOptions = {}): string {
  return join(resolveProfilesRootForMemory(options), '_memory');
}

function listLegacyProfileMemoryDirs(profilesRoot: string): string[] {
  if (!existsSync(profilesRoot)) {
    return [];
  }

  return readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_memory')
    .map((entry) => join(profilesRoot, entry.name, 'agent', 'memory'))
    .filter((dirPath) => existsSync(dirPath))
    .sort();
}

function listFlatGlobalMemoryFiles(memoryDir: string): string[] {
  if (!existsSync(memoryDir)) {
    return [];
  }

  return readdirSync(memoryDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => join(memoryDir, entry.name))
    .sort();
}

function removeDirIfEmpty(path: string): void {
  if (!existsSync(path)) {
    return;
  }

  if (readdirSync(path).length > 0) {
    return;
  }

  rmSync(path, { recursive: true, force: true });
}

function resolveMigrationConflictBackupPath(filePath: string): string {
  let candidate = `${filePath}.migration-conflict.bak`;
  let suffix = 2;

  while (existsSync(candidate)) {
    candidate = `${filePath}.migration-conflict.${suffix}.bak`;
    suffix += 1;
  }

  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function splitFrontmatter(rawContent: string): { frontmatter?: string; body: string } {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) {
    return { body: normalized };
  }

  return {
    frontmatter: match[1] ?? '',
    body: match[2] ?? '',
  };
}

function parseFrontmatterObject(rawContent: string): Record<string, unknown> | null {
  const split = splitFrontmatter(rawContent);
  if (!split.frontmatter) {
    return null;
  }

  const document = parseDocument(split.frontmatter, {
    prettyErrors: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    return null;
  }

  const parsed = document.toJS({ mapAsMap: false }) as unknown;
  return isRecord(parsed) ? parsed : null;
}

function trimOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function stringifyMemoryMarkdown(frontmatter: Record<string, unknown>, body: string): string {
  const frontmatterText = stringify(frontmatter).trimEnd();
  const normalizedBody = body.replace(/^\n+/, '');
  return `---\n${frontmatterText}\n---\n\n${normalizedBody.replace(/\s*$/, '\n')}`;
}

function normalizeLegacyMemoryMarkdown(rawContent: string, fallbackName: string): { packageName: string; content: string } {
  const frontmatter = parseFrontmatterObject(rawContent);
  if (!frontmatter) {
    return {
      packageName: fallbackName,
      content: rawContent,
    };
  }

  const newName = trimOptionalString(frontmatter.name);
  const newDescription = trimOptionalString(frontmatter.description);
  if (newName && newDescription) {
    return {
      packageName: newName,
      content: rawContent,
    };
  }

  const legacyId = trimOptionalString(frontmatter.id);
  const legacySummary = trimOptionalString(frontmatter.summary);
  if (!legacyId || !legacySummary) {
    return {
      packageName: fallbackName,
      content: rawContent,
    };
  }

  const legacyTitle = trimOptionalString(frontmatter.title);
  const split = splitFrontmatter(rawContent);
  const metadata: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(frontmatter)) {
    if (key === 'id' || key === 'summary') {
      continue;
    }

    if (key === 'title') {
      if (legacyTitle) {
        metadata.title = legacyTitle;
      }
      continue;
    }

    metadata[key] = value;
  }

  const nextFrontmatter: Record<string, unknown> = {
    name: legacyId,
    description: legacySummary,
  };

  if (Object.keys(metadata).length > 0) {
    nextFrontmatter.metadata = metadata;
  }

  const body = split.body.trim().length > 0
    ? split.body.replace(/^\n+/, '')
    : `# ${legacyTitle ?? legacyId}\n\n${legacySummary}\n`;

  return {
    packageName: legacyId,
    content: stringifyMemoryMarkdown(nextFrontmatter, body),
  };
}

function collectLegacyMemoryFiles(profilesRoot: string): Array<{ filePath: string; sourceDir?: string }> {
  const memoryDir = getMemoryDocsDir({ profilesRoot });
  const files: Array<{ filePath: string; sourceDir?: string }> = [];

  for (const legacyDir of listLegacyProfileMemoryDirs(profilesRoot)) {
    const entries = readdirSync(legacyDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => ({ filePath: join(legacyDir, entry.name), sourceDir: legacyDir }));
    files.push(...entries);
  }

  files.push(...listFlatGlobalMemoryFiles(memoryDir).map((filePath) => ({ filePath })));

  return files.sort((left, right) => left.filePath.localeCompare(right.filePath));
}

function readMemoryPackageInfo(memoryFile: string): { name: string; role?: string; parent?: string } | null {
  if (!existsSync(memoryFile)) {
    return null;
  }

  const frontmatter = parseFrontmatterObject(readFileSync(memoryFile, 'utf-8'));
  if (!frontmatter) {
    return null;
  }

  const metadata = isRecord(frontmatter.metadata) ? frontmatter.metadata : frontmatter;
  const name = trimOptionalString(frontmatter.name) ?? basename(dirname(memoryFile));
  if (!name) {
    return null;
  }

  return {
    name,
    role: trimOptionalString((metadata as Record<string, unknown>).role),
    parent: trimOptionalString((metadata as Record<string, unknown>).parent),
  };
}

function relocateNestedMemoryPackages(memoryDir: string): LegacyMemoryMigrationRecord[] {
  if (!existsSync(memoryDir)) {
    return [];
  }

  const packageDirs = readdirSync(memoryDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(memoryDir, entry.name))
    .sort();
  const migratedFiles: LegacyMemoryMigrationRecord[] = [];

  for (const packageDir of packageDirs) {
    const memoryFile = join(packageDir, 'MEMORY.md');
    const info = readMemoryPackageInfo(memoryFile);
    if (!info || (info.role !== 'canonical' && info.role !== 'capture') || !info.parent) {
      continue;
    }

    const parentMemoryFile = join(memoryDir, info.parent, 'MEMORY.md');
    if (!existsSync(parentMemoryFile)) {
      continue;
    }

    const targetPath = join(memoryDir, info.parent, 'references', `${info.name}.md`);
    const sourceContent = readFileSync(memoryFile, 'utf-8');

    if (existsSync(targetPath)) {
      const targetContent = readFileSync(targetPath, 'utf-8');
      if (targetContent !== sourceContent) {
        writeFileSync(resolveMigrationConflictBackupPath(memoryFile), sourceContent, 'utf-8');
      }
      rmSync(packageDir, { recursive: true, force: true });
      migratedFiles.push({ from: memoryFile, to: targetPath });
      continue;
    }

    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, sourceContent, 'utf-8');
    rmSync(packageDir, { recursive: true, force: true });
    migratedFiles.push({ from: memoryFile, to: targetPath });
  }

  return migratedFiles;
}

export function migrateLegacyProfileMemoryDirs(options: ResolveMemoryDocsOptions = {}): LegacyMemoryMigrationResult {
  const profilesRoot = resolveProfilesRootForMemory(options);
  const memoryDir = getMemoryDocsDir({ profilesRoot });
  const migratedFiles: LegacyMemoryMigrationRecord[] = [];
  const legacyFiles = collectLegacyMemoryFiles(profilesRoot);

  mkdirSync(memoryDir, { recursive: true });

  for (const { filePath, sourceDir } of legacyFiles) {
    const rawContent = readFileSync(filePath, 'utf-8');
    const normalized = normalizeLegacyMemoryMarkdown(rawContent, basename(filePath, '.md'));
    const packageDir = join(memoryDir, normalized.packageName);
    const targetPath = join(packageDir, 'MEMORY.md');

    if (resolve(filePath) === resolve(targetPath)) {
      if (normalized.content !== rawContent) {
        writeFileSync(targetPath, normalized.content, 'utf-8');
      }
      continue;
    }

    if (existsSync(targetPath)) {
      const targetContent = readFileSync(targetPath, 'utf-8');

      if (targetContent === normalized.content) {
        rmSync(filePath, { force: true });
        if (sourceDir) {
          removeDirIfEmpty(sourceDir);
        }
        continue;
      }

      const backupPath = resolveMigrationConflictBackupPath(filePath);
      writeFileSync(backupPath, rawContent, 'utf-8');
      rmSync(filePath, { force: true });
      if (sourceDir) {
        removeDirIfEmpty(sourceDir);
      }
      continue;
    }

    mkdirSync(packageDir, { recursive: true });
    writeFileSync(targetPath, normalized.content, 'utf-8');
    rmSync(filePath, { force: true });
    migratedFiles.push({ from: filePath, to: targetPath });

    if (sourceDir) {
      removeDirIfEmpty(sourceDir);
    }
  }

  migratedFiles.push(...relocateNestedMemoryPackages(memoryDir));

  return {
    memoryDir,
    migratedFiles,
  };
}
