import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { readProject, readProjectIndexBody, resolveProjectPaths, writeProjectIndexBody } from '@personal-agent/core';

export type ProjectNoteKind = 'note' | 'decision' | 'question' | 'meeting' | 'checkpoint';
export type LegacyProjectFileSourceKind = 'file' | 'attachment' | 'artifact';

export interface ProjectDocumentRecord {
  path: string;
  content: string;
  updatedAt: string;
}

export interface ProjectNoteRecord {
  id: string;
  path: string;
  title: string;
  kind: ProjectNoteKind | string;
  body: string;
  createdAt: string;
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

interface ProjectNoteDocument {
  id: string;
  title: string;
  kind: ProjectNoteKind | string;
  createdAt: string;
  updatedAt: string;
  body: string;
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

function formatNoteDocument(note: ProjectNoteDocument): string {
  const frontmatter = stringifyYaml({
    id: note.id,
    title: note.title,
    kind: note.kind,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }, {
    lineWidth: 0,
    indent: 2,
    minContentWidth: 0,
  }).trimEnd();

  const body = note.body.replace(/\r\n/g, '\n').trimEnd();
  return `---\n${frontmatter}\n---\n${body.length > 0 ? `${body}\n` : ''}`;
}

function parseNoteDocument(markdown: string, path: string): ProjectNoteDocument {
  const normalized = markdown.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    throw new Error(`Project note is missing frontmatter: ${path}`);
  }

  const secondDelimiterIndex = normalized.indexOf('\n---\n', 4);
  if (secondDelimiterIndex === -1) {
    throw new Error(`Project note frontmatter is incomplete: ${path}`);
  }

  const frontmatterRaw = normalized.slice(4, secondDelimiterIndex);
  const body = normalized.slice(secondDelimiterIndex + 5).trim();
  const parsed = parseYaml(frontmatterRaw) as Record<string, unknown> | null;
  const object = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};

  return {
    id: readRequiredString(typeof object.id === 'string' ? object.id : undefined, 'Project note id'),
    title: readRequiredString(typeof object.title === 'string' ? object.title : undefined, 'Project note title'),
    kind: readRequiredString(typeof object.kind === 'string' ? object.kind : undefined, 'Project note kind'),
    createdAt: readRequiredString(typeof object.createdAt === 'string' ? object.createdAt : undefined, 'Project note createdAt'),
    updatedAt: readRequiredString(typeof object.updatedAt === 'string' ? object.updatedAt : undefined, 'Project note updatedAt'),
    body,
  };
}

function resolveNotesDir(options: ResolveProjectResourceOptions): string {
  return resolveProjectPaths(options).notesDir;
}

function resolveFilesDir(options: ResolveProjectResourceOptions): string {
  return resolveProjectPaths(options).filesDir;
}

function resolveLegacyFileRoots(options: ResolveProjectResourceOptions): Array<{ dir: string; sourceKind: LegacyProjectFileSourceKind }> {
  const paths = resolveProjectPaths(options);
  return [
    { dir: resolveFilesDir(options), sourceKind: 'file' },
    { dir: paths.attachmentsDir, sourceKind: 'attachment' },
    { dir: paths.artifactsDir, sourceKind: 'artifact' },
  ];
}

function resolveProjectNotePath(options: ResolveProjectResourceOptions & { noteId: string }): string {
  return join(resolveNotesDir(options), `${options.noteId}.md`);
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
  const { briefFile } = resolveProjectPaths(options);
  const content = readProjectIndexBody(resolveProjectPaths(options).projectFile);
  if (content === null || !existsSync(briefFile)) {
    return null;
  }

  const stats = statSync(briefFile);
  return {
    path: briefFile,
    content,
    updatedAt: stats.mtime.toISOString(),
  };
}

export function saveProjectDocument(options: ResolveProjectResourceOptions & { content: string }): ProjectDocumentRecord {
  const paths = resolveProjectPaths(options);
  const project = readProject(paths.projectFile);
  writeProjectIndexBody(paths.projectFile, project, options.content.replace(/\r\n/g, '\n').trim());
  return readProjectDocument(options) as ProjectDocumentRecord;
}

export function listProjectNotes(options: ResolveProjectResourceOptions): ProjectNoteRecord[] {
  const notesDir = resolveNotesDir(options);
  if (!existsSync(notesDir)) {
    return [];
  }

  const notes = readdirSync(notesDir)
    .filter((entry) => entry.endsWith('.md'))
    .map((entry) => {
      const path = join(notesDir, entry);
      const note = parseNoteDocument(readFileSync(path, 'utf-8'), path);
      return {
        id: note.id,
        path,
        title: note.title,
        kind: note.kind,
        body: note.body,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      } satisfies ProjectNoteRecord;
    });

  notes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  return notes;
}

export function createProjectNoteRecord(options: ResolveProjectResourceOptions & {
  title: string;
  kind: ProjectNoteKind | string;
  body?: string;
}): ProjectNoteRecord {
  const title = readRequiredString(options.title, 'Project note title');
  const kind = readRequiredString(options.kind, 'Project note kind');
  const body = options.body?.replace(/\r\n/g, '\n').trim() ?? '';
  const existingIds = listProjectNotes(options).map((note) => note.id);
  const noteId = generateUniqueId(title, existingIds, 'note');
  const timestamp = nowIso();
  const path = resolveProjectNotePath({ ...options, noteId });

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatNoteDocument({
    id: noteId,
    title,
    kind,
    createdAt: timestamp,
    updatedAt: timestamp,
    body,
  }));

  return listProjectNotes(options).find((note) => note.id === noteId) as ProjectNoteRecord;
}

export function updateProjectNoteRecord(options: ResolveProjectResourceOptions & {
  noteId: string;
  title?: string;
  kind?: ProjectNoteKind | string;
  body?: string;
}): ProjectNoteRecord {
  const path = resolveProjectNotePath(options);
  if (!existsSync(path)) {
    throw new Error(`Project note not found: ${options.noteId}`);
  }

  const existing = parseNoteDocument(readFileSync(path, 'utf-8'), path);
  const updated: ProjectNoteDocument = {
    ...existing,
    ...(options.title !== undefined ? { title: readRequiredString(options.title, 'Project note title') } : {}),
    ...(options.kind !== undefined ? { kind: readRequiredString(options.kind, 'Project note kind') } : {}),
    ...(options.body !== undefined ? { body: options.body.replace(/\r\n/g, '\n').trim() } : {}),
    updatedAt: nowIso(),
  };

  writeFileSync(path, formatNoteDocument(updated));
  return listProjectNotes(options).find((note) => note.id === options.noteId) as ProjectNoteRecord;
}

export function deleteProjectNoteRecord(options: ResolveProjectResourceOptions & { noteId: string }): { ok: true; noteId: string } {
  const path = resolveProjectNotePath(options);
  if (!existsSync(path)) {
    throw new Error(`Project note not found: ${options.noteId}`);
  }

  rmSync(path);
  return { ok: true, noteId: options.noteId };
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
