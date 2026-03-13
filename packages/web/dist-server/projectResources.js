import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { resolveProjectPaths } from '@personal-agent/core';
function nowIso() {
    return new Date().toISOString();
}
function readRequiredString(value, label) {
    const normalized = value?.trim();
    if (!normalized) {
        throw new Error(`${label} must not be empty.`);
    }
    return normalized;
}
function readOptionalString(value) {
    const normalized = value?.trim();
    return normalized && normalized.length > 0 ? normalized : undefined;
}
function slugifyIdentifier(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-');
}
function trimTrailingHyphens(value) {
    return value.replace(/-+$/g, '');
}
function generateUniqueId(title, existingIds, fallbackBase) {
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
function formatNoteDocument(note) {
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
function parseNoteDocument(markdown, path) {
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
    const parsed = parseYaml(frontmatterRaw);
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
function resolveNotesDir(options) {
    return resolveProjectPaths(options).notesDir;
}
function resolveFileEntriesDir(options, kind) {
    const paths = resolveProjectPaths(options);
    return kind === 'attachment' ? paths.attachmentsDir : paths.artifactsDir;
}
function resolveProjectNotePath(options) {
    return join(resolveNotesDir(options), `${options.noteId}.md`);
}
function resolveProjectFileEntryDir(options) {
    return join(resolveFileEntriesDir(options, options.kind), options.fileId);
}
function resolveProjectFileMetadataPath(options) {
    return join(resolveProjectFileEntryDir(options), 'metadata.json');
}
function resolveProjectFileBlobPath(options) {
    return join(resolveProjectFileEntryDir(options), 'blob');
}
function readProjectFileMetadata(path) {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return {
        id: readRequiredString(parsed.id, 'Project file id'),
        title: readRequiredString(parsed.title, 'Project file title'),
        description: readOptionalString(parsed.description),
        originalName: readRequiredString(parsed.originalName, 'Project file originalName'),
        mimeType: readOptionalString(parsed.mimeType),
        createdAt: readRequiredString(parsed.createdAt, 'Project file createdAt'),
        updatedAt: readRequiredString(parsed.updatedAt, 'Project file updatedAt'),
    };
}
function writeProjectFileMetadata(path, metadata) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(metadata, null, 2) + '\n');
}
function buildDownloadPath(projectId, kind, fileId) {
    return `/api/projects/${encodeURIComponent(projectId)}/files/${kind}/${encodeURIComponent(fileId)}/download`;
}
function listEntryDirectories(dir) {
    if (!existsSync(dir)) {
        return [];
    }
    return readdirSync(dir)
        .map((entry) => join(dir, entry))
        .filter((entryPath) => statSync(entryPath).isDirectory())
        .sort((left, right) => basename(left).localeCompare(basename(right)));
}
export function readProjectBrief(options) {
    const { briefFile } = resolveProjectPaths(options);
    if (!existsSync(briefFile)) {
        return null;
    }
    const stats = statSync(briefFile);
    return {
        path: briefFile,
        content: readFileSync(briefFile, 'utf-8'),
        updatedAt: stats.mtime.toISOString(),
    };
}
export function saveProjectBrief(options) {
    const { briefFile } = resolveProjectPaths(options);
    mkdirSync(dirname(briefFile), { recursive: true });
    writeFileSync(briefFile, options.content.replace(/\r\n/g, '\n').trimEnd() + '\n');
    return readProjectBrief(options);
}
export function listProjectNotes(options) {
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
        };
    });
    notes.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return notes;
}
export function createProjectNoteRecord(options) {
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
    return listProjectNotes(options).find((note) => note.id === noteId);
}
export function updateProjectNoteRecord(options) {
    const path = resolveProjectNotePath(options);
    if (!existsSync(path)) {
        throw new Error(`Project note not found: ${options.noteId}`);
    }
    const existing = parseNoteDocument(readFileSync(path, 'utf-8'), path);
    const updated = {
        ...existing,
        ...(options.title !== undefined ? { title: readRequiredString(options.title, 'Project note title') } : {}),
        ...(options.kind !== undefined ? { kind: readRequiredString(options.kind, 'Project note kind') } : {}),
        ...(options.body !== undefined ? { body: options.body.replace(/\r\n/g, '\n').trim() } : {}),
        updatedAt: nowIso(),
    };
    writeFileSync(path, formatNoteDocument(updated));
    return listProjectNotes(options).find((note) => note.id === options.noteId);
}
export function deleteProjectNoteRecord(options) {
    const path = resolveProjectNotePath(options);
    if (!existsSync(path)) {
        throw new Error(`Project note not found: ${options.noteId}`);
    }
    rmSync(path);
    return { ok: true, noteId: options.noteId };
}
export function listProjectFiles(options) {
    const entryDirs = listEntryDirectories(resolveFileEntriesDir(options, options.kind));
    const files = entryDirs.flatMap((entryDir) => {
        const fileId = basename(entryDir);
        const metadataPath = resolveProjectFileMetadataPath({ ...options, fileId });
        const blobPath = resolveProjectFileBlobPath({ ...options, fileId });
        if (!existsSync(metadataPath) || !existsSync(blobPath)) {
            return [];
        }
        const metadata = readProjectFileMetadata(metadataPath);
        const stats = statSync(blobPath);
        return [{
                id: metadata.id,
                kind: options.kind,
                path: blobPath,
                title: metadata.title,
                description: metadata.description,
                originalName: metadata.originalName,
                mimeType: metadata.mimeType,
                sizeBytes: stats.size,
                createdAt: metadata.createdAt,
                updatedAt: metadata.updatedAt,
                downloadPath: buildDownloadPath(options.projectId, options.kind, metadata.id),
            }];
    });
    files.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    return files;
}
export function uploadProjectFile(options) {
    const originalName = readRequiredString(options.name, 'Project file name');
    const title = readOptionalString(options.title) ?? originalName;
    const description = readOptionalString(options.description);
    const mimeType = readOptionalString(options.mimeType);
    const existingIds = listProjectFiles(options).map((file) => file.id);
    const fileId = generateUniqueId(title, existingIds, options.kind);
    const entryDir = resolveProjectFileEntryDir({ ...options, fileId });
    const blobPath = resolveProjectFileBlobPath({ ...options, fileId });
    const metadataPath = resolveProjectFileMetadataPath({ ...options, fileId });
    const timestamp = nowIso();
    let buffer;
    try {
        buffer = Buffer.from(options.data, 'base64');
    }
    catch {
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
    });
    return listProjectFiles(options).find((file) => file.id === fileId);
}
export function readProjectFileRecord(options) {
    return listProjectFiles(options).find((file) => file.id === options.fileId) ?? null;
}
export function readProjectFileDownload(options) {
    const file = readProjectFileRecord(options);
    if (!file) {
        throw new Error(`Project ${options.kind} not found: ${options.fileId}`);
    }
    return {
        file,
        filePath: resolveProjectFileBlobPath(options),
    };
}
export function deleteProjectFileRecord(options) {
    const entryDir = resolveProjectFileEntryDir(options);
    if (!existsSync(entryDir)) {
        throw new Error(`Project ${options.kind} not found: ${options.fileId}`);
    }
    rmSync(entryDir, { recursive: true, force: false });
    return { ok: true, fileId: options.fileId };
}
