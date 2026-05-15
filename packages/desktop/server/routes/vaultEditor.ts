/**
 * Vault editor routes — file CRUD for the knowledge base UI.
 */

import { basename, dirname, extname, join, resolve } from 'node:path';

import { getVaultRoot } from '@personal-agent/core';
import type { Express, Response } from 'express';
import { extension as mimeExtension, lookup as mimeLookup } from 'mime-types';

import { defaultFileSystemAuthority, type FileAccess, type ScopedFileSystem } from '../filesystem/filesystemAuthority.js';
import { logError } from '../middleware/index.js';
import { importVaultSharedItemToFilesystem } from './vaultShareImport.js';

// ── Path safety ───────────────────────────────────────────────────────────────

const SKIPPED_DIRS = new Set(['.git', '.next', '.obsidian', 'coverage', 'dist', 'dist-server', 'node_modules']);

function getRoot(): string {
  return resolve(getVaultRoot());
}

async function vaultAuthority(access: FileAccess[] = ['metadata']): Promise<ScopedFileSystem> {
  const root = getRoot();
  return defaultFileSystemAuthority.requestRoot({
    subject: { type: 'core', id: 'vault-editor' },
    root: { kind: 'vault', id: root, path: root, displayName: 'Knowledge vault' },
    access,
    reason: 'vault editor route',
  });
}

function isInsideRoot(root: string, target: string): boolean {
  const rootPath = resolve(root);
  const targetPath = resolve(target);
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}/`);
}

function normalizeVaultId(id: string, options: { allowEmpty?: boolean } = {}): string | null {
  if (id.includes('\u0000')) return null;
  const clean = id.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
  if (!clean) return options.allowEmpty ? '' : null;
  const segments = clean.split('/');
  if (segments.some((s) => s === '.' || s === '..')) return null;
  return clean;
}

export function safeVaultPath(id: string, _access: FileAccess[] = ['metadata']): string | null {
  const clean = normalizeVaultId(id);
  if (clean === null) return null;
  const root = getRoot();
  const target = resolve(root, clean);
  return isInsideRoot(root, target) ? target : null;
}

export function decodeVaultImageDataUrl(dataUrl: string): Buffer {
  if (!dataUrl.trim().toLowerCase().startsWith('data:')) {
    throw new Error('dataUrl must be a data: URL');
  }

  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('dataUrl must contain valid base64 image data');
  }

  const metadata = dataUrl.slice(0, commaIndex).trim().toLowerCase();
  if (!metadata.startsWith('data:image/')) {
    throw new Error('dataUrl must be an image data: URL');
  }

  if (!metadata.includes(';base64')) {
    throw new Error('dataUrl must be a base64 data: URL');
  }

  const base64 = dataUrl.slice(commaIndex + 1).trim();
  if (!base64 || base64.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
    throw new Error('dataUrl must contain valid base64 image data');
  }

  const decoded = Buffer.from(base64, 'base64');
  if (decoded.length === 0) {
    throw new Error('dataUrl must contain non-empty image data');
  }

  return decoded;
}

const IMAGE_FILE_EXTENSIONS = new Set(['avif', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);

function readVaultImageDataUrlMimeType(dataUrl: string): string {
  const commaIndex = dataUrl.indexOf(',');
  const metadata = (commaIndex >= 0 ? dataUrl.slice(0, commaIndex) : dataUrl).trim().toLowerCase();
  if (!metadata.startsWith('data:image/')) {
    throw new Error('dataUrl must be an image data: URL');
  }

  return metadata.slice('data:'.length).split(';')[0] ?? 'image/png';
}

function resolveVaultImageUploadExtension(filename: string, dataUrl: string): string {
  const mimeExt = mimeExtension(readVaultImageDataUrlMimeType(dataUrl));
  if (typeof mimeExt === 'string' && mimeExt.trim()) {
    return mimeExt.trim();
  }

  const fileExt = extname(filename).trim().replace(/^\./, '').toLowerCase();
  return IMAGE_FILE_EXTENSIONS.has(fileExt) ? fileExt : 'png';
}

export function buildVaultImageUploadFileName(filename: string, dataUrl: string, timestamp = Date.now()): string {
  const originalName = basename(filename.trim());
  const baseName = originalName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '-') || 'image';
  return `${timestamp}-${baseName}.${resolveVaultImageUploadExtension(originalName, dataUrl)}`;
}

function isVaultImageUploadClientError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.message.startsWith('dataUrl must ');
}

function isVaultShareImportClientError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.message === 'dataBase64 is required for image imports.' ||
    error.message === 'url is required for URL imports.' ||
    error.message === 'mimeType must be an image type for image imports.' ||
    error.message.startsWith('Shared image data ')
  );
}

// ── Serialise a single entry ──────────────────────────────────────────────────

interface VaultEntry {
  id: string;
  kind: 'file' | 'folder';
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

async function vaultEntryFromScopedPath(vault: ScopedFileSystem, id: string): Promise<VaultEntry> {
  const stat = await vault.stat(id);
  const kind: VaultEntry['kind'] = stat.type === 'directory' ? 'folder' : 'file';
  const clean = id.replace(/\/+$/, '');
  return {
    id: kind === 'folder' ? `${clean}/` : clean,
    kind,
    name: basename(clean),
    path: clean,
    sizeBytes: kind === 'file' ? (stat.size ?? 0) : 0,
    updatedAt: stat.modifiedAt ?? new Date().toISOString(),
  };
}

async function readVaultDirEntriesScoped(vault: ScopedFileSystem, id = ''): Promise<VaultEntry[]> {
  const entries = await vault.list(id, { depth: 0, excludeNames: [...SKIPPED_DIRS] });
  return entries
    .filter((entry) => (entry.type === 'file' || entry.type === 'directory') && (!entry.name.startsWith('.') || entry.type === 'directory'))
    .map(
      (entry): VaultEntry => ({
        id: entry.type === 'directory' ? `${entry.path}/` : entry.path,
        kind: entry.type === 'directory' ? 'folder' : 'file',
        name: entry.name,
        path: entry.path,
        sizeBytes: entry.type === 'file' ? (entry.size ?? 0) : 0,
        updatedAt: entry.modifiedAt ?? new Date().toISOString(),
      }),
    )
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

// ── Route registration ────────────────────────────────────────────────────────

// ── Backlinks ────────────────────────────────────────────────────────────────

interface BacklinkResult {
  id: string;
  name: string;
  excerpt: string;
}

interface VaultNoteSearchResult {
  id: string;
  name: string;
  title: string;
  excerpt: string;
  score: number;
}

function buildSearchExcerpt(content: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + matchLength + 80);
  let excerpt = content.slice(start, end).replace(/\n+/g, ' ').trim();
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < content.length) excerpt = `${excerpt}…`;
  return excerpt;
}

export function parseVaultSearchLimit(value: unknown): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string' && typeof candidate !== 'number') {
    return 20;
  }
  const normalized = String(candidate).trim();
  if (!/^\d+$/.test(normalized)) {
    return 20;
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(50, parsed) : 20;
}

async function collectMarkdownEntries(vault: ScopedFileSystem) {
  const entries = await vault.list('', { depth: 100, excludeNames: [...SKIPPED_DIRS] });
  return entries.filter((entry) => entry.type === 'file' && extname(entry.name).toLowerCase() === '.md');
}

export async function searchVaultNotes(
  vault: ScopedFileSystem,
  query: string,
  limit: number,
): Promise<Array<Omit<VaultNoteSearchResult, 'score'>>> {
  const normalized = query.trim().toLowerCase();
  const results: VaultNoteSearchResult[] = [];

  for (const entry of await collectMarkdownEntries(vault)) {
    const id = entry.path;
    const name = entry.name;
    const title = name.replace(/\.md$/i, '');
    let content = '';
    try {
      content = await vault.readText(id);
    } catch {
      continue;
    }

    if (!normalized) {
      results.push({ id, name, title, excerpt: id, score: 1_000 });
      continue;
    }

    const pathLower = id.toLowerCase();
    const titleLower = title.toLowerCase();
    const contentLower = content.toLowerCase();
    const titleIndex = titleLower.indexOf(normalized);
    const pathIndex = pathLower.indexOf(normalized);
    const contentIndex = contentLower.indexOf(normalized);
    if (titleIndex === -1 && pathIndex === -1 && contentIndex === -1) {
      continue;
    }

    let score = 0;
    if (titleIndex === 0) score += 500;
    else if (titleIndex > 0) score += 350;
    if (pathIndex >= 0) score += 200;
    if (contentIndex >= 0) score += 100;
    const excerpt = contentIndex >= 0 ? buildSearchExcerpt(content, contentIndex, normalized.length) : pathIndex >= 0 ? id : title;
    results.push({ id, name, title, excerpt, score });
  }

  return results
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ score: _score, ...result }) => result);
}

export async function findVaultBacklinks(targetId: string, vault: ScopedFileSystem): Promise<BacklinkResult[]> {
  const targetName = basename(targetId).replace(/\.md$/i, '');
  const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\[\\[${escapedName}(?:\\|[^\\]]*)?\\]\\]`, 'gi');

  const results: BacklinkResult[] = [];
  for (const entry of await collectMarkdownEntries(vault)) {
    const fileId = entry.path;
    if (fileId === targetId) continue;
    let content: string;
    try {
      content = await vault.readText(fileId);
    } catch {
      continue;
    }
    if (!pattern.test(content)) continue;
    pattern.lastIndex = 0;

    const matchIndex = content.search(pattern);
    pattern.lastIndex = 0;
    const start = Math.max(0, matchIndex - 60);
    const end = Math.min(content.length, matchIndex + 80);
    let excerpt = content.slice(start, end).replace(/\n+/g, ' ').trim();
    if (start > 0) excerpt = `…${excerpt}`;
    if (end < content.length) excerpt = `${excerpt}…`;

    results.push({ id: fileId, name: entry.name, excerpt });
  }

  return results;
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerVaultEditorRoutes(router: Pick<Express, 'get' | 'put' | 'post' | 'delete'>): void {
  // GET /api/vault/tree?dir=<rel-id>  — list a directory (shallow)
  // dir defaults to root when omitted / empty
  router.get('/api/vault/tree', async (req, res) => {
    try {
      const root = getRoot();
      const dirParam = typeof req.query.dir === 'string' ? req.query.dir.trim() : '';
      const id = normalizeVaultId(dirParam, { allowEmpty: true });
      if (id === null) {
        res.status(400).json({ error: 'Invalid path' });
        return;
      }
      const vault = await vaultAuthority(['list', 'metadata']);
      if (id && (!(await vault.exists(id)) || (await vault.stat(id)).type !== 'directory')) {
        res.status(404).json({ error: 'Directory not found' });
        return;
      }
      res.json({ root, entries: await readVaultDirEntriesScoped(vault, id) });
    } catch (err) {
      logError('vault/tree error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/vault/file?id=<rel-id>  — read file content
  router.get('/api/vault/file', async (req, res) => {
    try {
      const id = normalizeVaultId(typeof req.query.id === 'string' ? req.query.id.trim() : '');
      if (!id) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      const vault = await vaultAuthority(['read', 'metadata']);
      if (!(await vault.exists(id)) || (await vault.stat(id)).type !== 'file') {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      const stats = await vault.stat(id);
      res.json({ id, content: await vault.readText(id), updatedAt: stats.modifiedAt ?? new Date().toISOString() });
    } catch (err) {
      logError('vault/file GET error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // PUT /api/vault/file  — create or overwrite a file
  // body: { id: string, content: string }
  router.put('/api/vault/file', async (req, res) => {
    try {
      const { id, content } = req.body as { id?: unknown; content?: unknown };
      if (typeof id !== 'string' || !id.trim()) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'content must be a string' });
        return;
      }
      const clean = normalizeVaultId(id);
      if (!clean) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      const vault = await vaultAuthority(['write', 'metadata']);
      await vault.writeText(clean, content);
      res.json(await vaultEntryFromScopedPath(vault, clean));
    } catch (err) {
      logError('vault/file PUT error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // DELETE /api/vault/file?id=<rel-id>  — delete file or folder (recursive)
  router.delete('/api/vault/file', async (req, res) => {
    try {
      const id = normalizeVaultId(typeof req.query.id === 'string' ? req.query.id.trim() : '');
      if (!id) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      const vault = await vaultAuthority(['delete', 'metadata']);
      if (!(await vault.exists(id))) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      await vault.remove(id, { recursive: true, force: true });
      res.json({ ok: true });
    } catch (err) {
      logError('vault/file DELETE error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/vault/rename  — rename / move within the vault
  // body: { id: string, newName: string, parentId?: string }  (newName is just the basename)
  router.post('/api/vault/rename', async (req, res) => {
    try {
      const { id, newName, parentId } = req.body as { id?: unknown; newName?: unknown; parentId?: unknown };
      if (typeof id !== 'string' || !id.trim()) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      if (typeof newName !== 'string' || !newName.trim() || newName.includes('/') || newName.includes('\\')) {
        res.status(400).json({ error: 'newName must be a plain file/folder name' });
        return;
      }
      const sourceId = normalizeVaultId(id);
      if (!sourceId) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      const vault = await vaultAuthority(['move', 'metadata']);
      if (!(await vault.exists(sourceId))) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const parent =
        parentId === null
          ? ''
          : typeof parentId === 'string'
            ? normalizeVaultId(parentId, { allowEmpty: true })
            : dirname(sourceId).replace(/\\/g, '/');
      if (parent === null || (parent && (!(await vault.exists(parent)) || (await vault.stat(parent)).type !== 'directory'))) {
        res.status(400).json({ error: 'Target folder does not exist' });
        return;
      }
      const targetId = join(parent, newName.trim()).replace(/\\/g, '/');
      if (
        (await vault.stat(sourceId)).type === 'directory' &&
        (targetId === sourceId || targetId.startsWith(`${sourceId.replace(/\/+$/, '')}/`))
      ) {
        res.status(400).json({ error: 'Cannot move a folder into itself' });
        return;
      }
      if (await vault.exists(targetId)) {
        res.status(409).json({ error: 'A file or folder with that name already exists' });
        return;
      }
      await vault.move(sourceId, targetId);
      res.json(await vaultEntryFromScopedPath(vault, targetId));
    } catch (err) {
      logError('vault/rename error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/vault/folder  — create a directory
  // body: { id: string }
  router.post('/api/vault/folder', async (req, res) => {
    try {
      const { id } = req.body as { id?: unknown };
      if (typeof id !== 'string' || !id.trim()) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      const clean = normalizeVaultId(id);
      if (!clean) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      const vault = await vaultAuthority(['write', 'metadata']);
      await vault.createDirectory(clean);
      res.json(await vaultEntryFromScopedPath(vault, clean));
    } catch (err) {
      logError('vault/folder error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/vault/backlinks?id=<rel-id>  — find files that [[wikilink]] to this file
  router.get('/api/vault/backlinks', async (req, res) => {
    try {
      const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
      if (!id) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      const vault = await vaultAuthority(['read', 'list', 'metadata']);
      const targetName = basename(id).replace(/\.md$/i, '');
      res.json({ id, targetName, backlinks: await findVaultBacklinks(id, vault) });
    } catch (err) {
      logError('vault/backlinks', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/vault/note-search?q=...&limit=... — note title/path search for mobile linking
  router.get('/api/vault/note-search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = parseVaultSearchLimit(req.query.limit);
      const vault = await vaultAuthority(['read', 'list', 'metadata']);
      res.json({ results: await searchVaultNotes(vault, q, limit) });
    } catch (err) {
      logError('vault/note-search', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/vault/search?q=...&limit=... — full-text search across all .md files
  router.get('/api/vault/search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!q) {
        res.json({ results: [] });
        return;
      }
      const limit = parseVaultSearchLimit(req.query.limit);
      const vault = await vaultAuthority(['read', 'list', 'metadata']);
      const lower = q.toLowerCase();
      const results: Array<{ id: string; name: string; excerpt: string; matchCount: number }> = [];

      for (const entry of await collectMarkdownEntries(vault)) {
        const id = entry.path;
        const name = entry.name;
        let content: string;
        try {
          content = await vault.readText(id);
        } catch {
          continue;
        }
        const contentLower = content.toLowerCase();
        const nameLower = name.toLowerCase();
        const nameMatch = nameLower.includes(lower);
        const contentMatch = contentLower.includes(lower);
        if (!nameMatch && !contentMatch) continue;
        let count = 0;
        let pos = 0;
        while ((pos = contentLower.indexOf(lower, pos)) !== -1) {
          count++;
          pos += lower.length;
        }
        const firstIdx = contentLower.indexOf(lower);
        const start = Math.max(0, firstIdx - 60);
        const end = Math.min(content.length, firstIdx + lower.length + 80);
        let excerpt = firstIdx >= 0 ? content.slice(start, end).replace(/\n+/g, ' ').trim() : '';
        if (start > 0) excerpt = `…${excerpt}`;
        if (end < content.length) excerpt = `${excerpt}…`;
        results.push({ id, name, excerpt, matchCount: count + (nameMatch ? 100 : 0) });
        if (results.length >= limit * 3) break;
      }

      results.sort((a, b) => b.matchCount - a.matchCount);
      res.json({ results: results.slice(0, limit) });
    } catch (err) {
      logError('vault/search', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/vault/move  — move file or folder to a new parent directory
  // body: { id: string, targetDir: string }  targetDir = '' means vault root
  router.post('/api/vault/move', async (req, res) => {
    try {
      const { id, targetDir } = req.body as { id?: unknown; targetDir?: unknown };
      if (typeof id !== 'string' || !id.trim()) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      if (typeof targetDir !== 'string') {
        res.status(400).json({ error: 'targetDir must be a string' });
        return;
      }
      const sourceId = normalizeVaultId(id);
      if (!sourceId) {
        res.status(400).json({ error: 'Invalid source id' });
        return;
      }
      const targetDirId = normalizeVaultId(targetDir, { allowEmpty: true });
      if (targetDirId === null) {
        res.status(400).json({ error: 'Invalid target directory' });
        return;
      }
      const vault = await vaultAuthority(['move', 'metadata']);
      if (!(await vault.exists(sourceId))) {
        res.status(404).json({ error: 'Source not found' });
        return;
      }
      if (targetDirId && (!(await vault.exists(targetDirId)) || (await vault.stat(targetDirId)).type !== 'directory')) {
        res.status(400).json({ error: 'Target directory does not exist' });
        return;
      }
      const destId = join(targetDirId, basename(sourceId)).replace(/\\/g, '/');
      if (await vault.exists(destId)) {
        res.status(409).json({ error: 'A file with that name already exists there' });
        return;
      }
      await vault.move(sourceId, destId);
      res.json(await vaultEntryFromScopedPath(vault, destId));
    } catch (err) {
      logError('vault/move', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/vault/share-import — import shared text, URLs, or images into the vault
  router.post('/api/vault/share-import', async (req, res) => {
    try {
      const payload = (req.body ?? {}) as {
        kind?: unknown;
        directoryId?: unknown;
        title?: unknown;
        text?: unknown;
        url?: unknown;
        mimeType?: unknown;
        fileName?: unknown;
        dataBase64?: unknown;
        sourceApp?: unknown;
        createdAt?: unknown;
      };
      const kind = typeof payload.kind === 'string' ? payload.kind.trim() : '';
      if (kind !== 'text' && kind !== 'url' && kind !== 'image') {
        res.status(400).json({ error: 'kind must be text, url, or image' });
        return;
      }

      const directoryId = normalizeVaultId(typeof payload.directoryId === 'string' ? payload.directoryId : '', { allowEmpty: true });
      if (directoryId === null) {
        res.status(400).json({ error: 'Invalid target directory' });
        return;
      }
      const vault = await vaultAuthority(['read', 'write', 'metadata']);
      if (directoryId && (!(await vault.exists(directoryId)) || (await vault.stat(directoryId)).type !== 'directory')) {
        res.status(400).json({ error: 'Invalid target directory' });
        return;
      }

      const imported = await importVaultSharedItemToFilesystem({
        kind,
        filesystem: vault,
        targetDirId: directoryId,
        ...(typeof payload.title === 'string' ? { title: payload.title } : {}),
        ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
        ...(typeof payload.url === 'string' ? { url: payload.url } : {}),
        ...(typeof payload.mimeType === 'string' ? { mimeType: payload.mimeType } : {}),
        ...(typeof payload.fileName === 'string' ? { fileName: payload.fileName } : {}),
        ...(typeof payload.dataBase64 === 'string' ? { dataBase64: payload.dataBase64 } : {}),
        ...(typeof payload.sourceApp === 'string' ? { sourceApp: payload.sourceApp } : {}),
        ...(typeof payload.createdAt === 'string' ? { createdAt: payload.createdAt } : {}),
      });

      res.status(201).json({
        note: await vaultEntryFromScopedPath(vault, imported.noteId),
        sourceKind: imported.sourceKind,
        title: imported.title,
        ...(imported.asset ? { asset: imported.asset } : {}),
      });
    } catch (err) {
      if (isVaultShareImportClientError(err)) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        return;
      }
      logError('vault/share-import', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/vault/image  — save a base64-encoded image to _attachments/
  // body: { filename: string, dataUrl: string }
  router.post('/api/vault/image', async (req, res) => {
    try {
      const { filename, dataUrl } = req.body as { filename?: unknown; dataUrl?: unknown };
      if (typeof filename !== 'string' || !filename.trim()) {
        res.status(400).json({ error: 'filename required' });
        return;
      }
      if (typeof dataUrl !== 'string' || !dataUrl.trim().toLowerCase().startsWith('data:')) {
        res.status(400).json({ error: 'dataUrl must be a data: URL' });
        return;
      }
      const buf = decodeVaultImageDataUrl(dataUrl);
      const outName = buildVaultImageUploadFileName(filename, dataUrl);
      const id = `_attachments/${outName}`;
      const vault = await vaultAuthority(['write']);
      await vault.writeBytes(id, buf);
      res.json({ id, url: `/api/vault/asset?id=${encodeURIComponent(id)}` });
    } catch (err) {
      if (isVaultImageUploadClientError(err)) {
        res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
        return;
      }
      logError('vault/image', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/vault/asset?id=...  — serve a binary vault file (images, etc.)
  router.get('/api/vault/asset', async (req, res: Response) => {
    try {
      const id = normalizeVaultId(typeof req.query.id === 'string' ? req.query.id.trim() : '');
      if (!id) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      const vault = await vaultAuthority(['read', 'metadata']);
      if (!(await vault.exists(id)) || (await vault.stat(id)).type !== 'file') {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const mime = mimeLookup(id) || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(Buffer.from(await vault.readBytes(id)));
    } catch (err) {
      logError('vault/asset', { message: String(err) });
      res.status(500).end();
    }
  });
}
