import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { resolveProjectNodePaths } from './projects.js';

export type LegacyProjectFileSourceKind = 'file' | 'attachment' | 'artifact';

export interface ProjectDocumentRecord {
  path: string;
  content: string;
  updatedAt: string;
}

export interface ProjectFileRecord {
  id: string;
  kind?: 'attachment' | 'artifact';
  path: string;
  title: string;
  description?: string;
  originalName: string;
  mimeType?: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  downloadPath: string;
  sourceKind?: LegacyProjectFileSourceKind;
}

interface StoredProjectFileMetadata {
  id: string;
  title: string;
  description?: string;
  originalName: string;
  mimeType?: string;
  createdAt: string;
  updatedAt: string;
  sourceKind?: LegacyProjectFileSourceKind;
}

interface ResolveProjectResourceOptions {
  repoRoot?: string;
  profile: string;
  projectId: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function readRequiredString(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${label} must not be empty.`);
  }

  return normalized;
}

function readOptionalString(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function slugifyIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function trimTrailingHyphens(value: string): string {
  return value.replace(/-+$/g, '');
}

function generateUniqueId(title: string, existingIds: string[], fallbackBase: string): string {
  const rawBase = slugifyIdentifier(title) || fallbackBase;
  const base = trimTrailingHyphens(rawBase.slice(0, 48)) || fallbackBase;
  const used = new Set(existingIds);

  if (!used.has(base)) {
    return base;
  }

  for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
    const suffix = `-${index}`;
    const trimmedBase = trimTrailingHyphens(base.slice(0, Math.max(1, 48 - suffix.length))) || fallbackBase;
    const candidate = `${trimmedBase}${suffix}`;
    if (!used.has(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Unable to generate a unique ${fallbackBase} id.`);
}

function resolveFilesDir(options: ResolveProjectResourceOptions): string {
  return resolveProjectNodePaths(options).filesDir;
}

function resolveLegacyFileRoots(options: ResolveProjectResourceOptions): Array<{ dir: string; sourceKind: LegacyProjectFileSourceKind }> {
  const paths = resolveProjectNodePaths(options);
  return [
    { dir: resolveFilesDir(options), sourceKind: 'file' },
    { dir: paths.attachmentsDir, sourceKind: 'attachment' },
    { dir: paths.artifactsDir, sourceKind: 'artifact' },
  ];
}

function resolveProjectFileMetadataPath(entryDir: string): string {
  return join(entryDir, 'metadata.json');
}

function resolveProjectFileBlobPath(entryDir: string): string {
  return join(entryDir, 'blob');
}

function readProjectFileMetadata(path: string): StoredProjectFileMetadata {
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<StoredProjectFileMetadata>;
  return {
    id: readRequiredString(parsed.id, 'Project file id'),
    title: readRequiredString(parsed.title, 'Project file title'),
    description: readOptionalString(parsed.description),
    originalName: readRequiredString(parsed.originalName, 'Project file originalName'),
    mimeType: readOptionalString(parsed.mimeType),
    createdAt: readRequiredString(parsed.createdAt, 'Project file createdAt'),
    updatedAt: readRequiredString(parsed.updatedAt, 'Project file updatedAt'),
    sourceKind: parsed.sourceKind === 'attachment' || parsed.sourceKind === 'artifact' ? parsed.sourceKind : 'file',
  };
}

function writeProjectFileMetadata(path: string, metadata: StoredProjectFileMetadata): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(metadata, null, 2) + '\n');
}

function buildDownloadPath(projectId: string, fileId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}/download`;
}

function listEntryDirectories(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((entryPath) => statSync(entryPath).isDirectory())
    .sort((left, right) => basename(left).localeCompare(basename(right)));
}

export function readProjectDocument(options: ResolveProjectResourceOptions): ProjectDocumentRecord | null {
  const { documentFile, projectFile } = resolveProjectNodePaths(options);
  if (existsSync(documentFile)) {
    const stats = statSync(documentFile);
    return {
      path: documentFile,
      content: readFileSync(documentFile, 'utf-8'),
      updatedAt: stats.mtime.toISOString(),
    };
  }

  if (!existsSync(projectFile)) {
    return null;
  }

  const raw = readFileSync(projectFile, 'utf-8').replace(/\r\n/g, '\n');
  const match = raw.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  const stats = statSync(projectFile);
  return {
    path: projectFile,
    content: (match?.[1] ?? raw).trim(),
    updatedAt: stats.mtime.toISOString(),
  };
}

export function saveProjectDocument(options: ResolveProjectResourceOptions & { content: string }): ProjectDocumentRecord {
  const paths = resolveProjectNodePaths(options);
  mkdirSync(dirname(paths.documentFile), { recursive: true });
  writeFileSync(paths.documentFile, `${options.content.replace(/\r\n/g, '\n').trim()}\n`, 'utf-8');
  return readProjectDocument(options) as ProjectDocumentRecord;
}

function listResolvedProjectFiles(options: ResolveProjectResourceOptions): Array<ProjectFileRecord & { entryDir: string }> {
  const files: Array<ProjectFileRecord & { entryDir: string }> = [];
  const seenIds = new Set<string>();

  for (const { dir, sourceKind } of resolveLegacyFileRoots(options)) {
    for (const entryDir of listEntryDirectories(dir)) {
      const metadataPath = resolveProjectFileMetadataPath(entryDir);
      const blobPath = resolveProjectFileBlobPath(entryDir);

      if (!existsSync(metadataPath) || !existsSync(blobPath)) {
        continue;
      }

      const metadata = readProjectFileMetadata(metadataPath);
      const stats = statSync(blobPath);
      if (seenIds.has(metadata.id)) {
        continue;
      }
      seenIds.add(metadata.id);

      const resolvedSourceKind = metadata.sourceKind ?? sourceKind;
      files.push({
        id: metadata.id,
        ...(resolvedSourceKind === 'attachment' || resolvedSourceKind === 'artifact' ? { kind: resolvedSourceKind } : {}),
        path: blobPath,
        title: metadata.title,
        description: metadata.description,
        originalName: metadata.originalName,
        mimeType: metadata.mimeType,
        sizeBytes: stats.size,
        createdAt: metadata.createdAt,
        updatedAt: metadata.updatedAt,
        downloadPath: buildDownloadPath(options.projectId, metadata.id),
        sourceKind: resolvedSourceKind,
        entryDir,
      });
    }
  }

  files.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return files;
}

export function listProjectFiles(options: ResolveProjectResourceOptions & { kind?: 'attachment' | 'artifact' }): ProjectFileRecord[] {
  const files = listResolvedProjectFiles(options).map(({ entryDir: _entryDir, ...file }) => file);
  if (!options.kind) {
    return files;
  }

  return files.filter((file) => file.sourceKind === options.kind || file.kind === options.kind);
}

export function uploadProjectFile(options: ResolveProjectResourceOptions & {
  kind?: 'attachment' | 'artifact';
  name: string;
  mimeType?: string;
  title?: string;
  description?: string;
  data: string;
}): ProjectFileRecord {
  const originalName = readRequiredString(options.name, 'Project file name');
  const title = readOptionalString(options.title) ?? originalName;
  const description = readOptionalString(options.description);
  const mimeType = readOptionalString(options.mimeType);
  const existingIds = listProjectFiles(options).map((file) => file.id);
  const fileId = generateUniqueId(title, existingIds, 'file');
  const entryDir = join(resolveFilesDir(options), fileId);
  const blobPath = resolveProjectFileBlobPath(entryDir);
  const metadataPath = resolveProjectFileMetadataPath(entryDir);
  const timestamp = nowIso();

  let buffer: Buffer;
  try {
    buffer = Buffer.from(options.data, 'base64');
  } catch {
    throw new Error('Project file data must be valid base64.');
  }

  mkdirSync(entryDir, { recursive: true });
  writeFileSync(blobPath, buffer);
  writeProjectFileMetadata(metadataPath, {
    id: fileId,
    title,
    description,
    originalName,
    mimeType,
    createdAt: timestamp,
    updatedAt: timestamp,
    sourceKind: options.kind ?? 'file',
  });

  return listProjectFiles(options).find((file) => file.id === fileId) as ProjectFileRecord;
}

export function readProjectFileDownload(options: ResolveProjectResourceOptions & { kind?: 'attachment' | 'artifact'; fileId: string }): {
  file: ProjectFileRecord;
  filePath: string;
} {
  const record = listResolvedProjectFiles(options).find((file) => file.id === options.fileId);
  if (!record) {
    throw new Error(`Project file not found: ${options.fileId}`);
  }

  const { entryDir, ...file } = record;
  void entryDir;
  return {
    file,
    filePath: record.path,
  };
}

export function deleteProjectFileRecord(options: ResolveProjectResourceOptions & { kind?: 'attachment' | 'artifact'; fileId: string }): { ok: true; fileId: string } {
  const record = listResolvedProjectFiles(options).find((file) => file.id === options.fileId);
  if (!record) {
    throw new Error(`Project file not found: ${options.fileId}`);
  }

  rmSync(record.entryDir, { recursive: true, force: false });
  return { ok: true, fileId: options.fileId };
}
