/**
 * Vault editor routes — file CRUD for the knowledge base UI.
 */

import type { Express, Response } from 'express';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  type Dirent,
  type Stats,
} from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { lookup as mimeLookup } from 'mime-types';
import { getVaultRoot } from '@personal-agent/core';
import { logError } from '../middleware/index.js';
import { importVaultSharedItem } from './vaultShareImport.js';

// ── Path safety ───────────────────────────────────────────────────────────────

const SKIPPED_DIRS = new Set([
  '.git', '.next', '.obsidian', 'coverage', 'dist', 'dist-server', 'node_modules',
]);

function getRoot(): string {
  return resolve(getVaultRoot());
}

function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return !rel.startsWith('..') && rel !== '..';
}

function safePath(id: string): string | null {
  if (!id || id.includes('\u0000')) return null;
  // Normalise slashes and strip leading/trailing separators
  const clean = id.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
  if (!clean) return null;
  const segments = clean.split('/');
  if (segments.some((s) => s === '.' || s === '..')) return null;
  const root = getRoot();
  const abs = resolve(root, clean);
  if (!isInsideRoot(root, abs)) return null;
  return abs;
}

export function decodeVaultImageDataUrl(dataUrl: string): Buffer {
  if (!dataUrl.startsWith('data:')) {
    throw new Error('dataUrl must be a data: URL');
  }

  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) {
    throw new Error('dataUrl must contain valid base64 image data');
  }

  const metadata = dataUrl.slice(0, commaIndex).toLowerCase();
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

// ── Serialise a single entry ──────────────────────────────────────────────────

interface VaultEntry {
  id: string;
  kind: 'file' | 'folder';
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

function entryFromStat(root: string, abs: string, stats: Stats): VaultEntry {
  const rel = relative(root, abs).replace(/\\/g, '/');
  const kind: VaultEntry['kind'] = stats.isDirectory() ? 'folder' : 'file';
  return {
    id: kind === 'folder' ? `${rel}/` : rel,
    kind,
    name: basename(abs),
    path: abs,
    sizeBytes: kind === 'file' ? stats.size : 0,
    updatedAt: new Date(stats.mtimeMs).toISOString(),
  };
}

function deleteVaultPath(abs: string): void {
  rmSync(abs, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });

  // macOS can occasionally leave an empty directory behind after recursive
  // contents are removed. Retry before reporting success so the UI does not
  // require a second delete on the now-empty folder.
  if (existsSync(abs)) {
    rmSync(abs, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }

  if (existsSync(abs)) {
    throw new Error('Failed to delete vault path');
  }
}

function readDirEntries(root: string, abs: string): VaultEntry[] {
  let dirents: Dirent[];
  try {
    dirents = readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  return dirents
    .filter((d) => !d.isSymbolicLink())
    .filter((d) => !(d.isDirectory() && SKIPPED_DIRS.has(d.name)))
    .filter((d) => !d.name.startsWith('.') || d.isDirectory())
    .flatMap((d) => {
      const childAbs = join(abs, d.name);
      let stats: Stats;
      try { stats = statSync(childAbs); } catch { return []; }
      if (!stats.isFile() && !stats.isDirectory()) return [];
      return [entryFromStat(root, childAbs, stats)];
    })
    .sort((a, b) => {
      // folders first, then alpha
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

function collectAllMarkdownFiles(root: string): string[] {
  const results: string[] = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop() as string;
    let entries: Dirent[];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) stack.push(abs);
      } else if (entry.isFile() && extname(entry.name) === '.md') {
        results.push(abs);
      }
    }
  }
  return results;
}

function buildSearchExcerpt(content: string, index: number, matchLength: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + matchLength + 80);
  let excerpt = content.slice(start, end).replace(/\n+/g, ' ').trim();
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < content.length) excerpt = `${excerpt}…`;
  return excerpt;
}

function searchVaultNotes(root: string, query: string, limit: number): Array<Omit<VaultNoteSearchResult, 'score'>> {
  const normalized = query.trim().toLowerCase();
  const results: VaultNoteSearchResult[] = [];

  for (const filePath of collectAllMarkdownFiles(root)) {
    const id = relative(root, filePath).replace(/\\/g, '/');
    const name = basename(filePath);
    const title = name.replace(/\.md$/i, '');
    let content = '';
    try { content = readFileSync(filePath, 'utf-8'); } catch { continue; }

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
    const excerpt = contentIndex >= 0
      ? buildSearchExcerpt(content, contentIndex, normalized.length)
      : pathIndex >= 0
        ? id
        : title;
    results.push({ id, name, title, excerpt, score });
  }

  return results
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
    .map(({ score: _score, ...result }) => result);
}

function findBacklinks(targetId: string, root: string): BacklinkResult[] {
  // targetId may be "notes/foo.md" — derive the note name without extension
  const targetName = basename(targetId).replace(/\.md$/i, '');
  const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\[\\[${escapedName}(?:\\|[^\\]]*)?\\]\\]`, 'gi');

  const results: BacklinkResult[] = [];
  const files = collectAllMarkdownFiles(root);

  for (const filePath of files) {
    const fileId = relative(root, filePath).replace(/\\/g, '/');
    if (fileId === targetId) continue; // skip the file itself
    let content: string;
    try { content = readFileSync(filePath, 'utf-8'); } catch { continue; }
    if (!pattern.test(content)) continue;
    pattern.lastIndex = 0;

    // Build a short excerpt around the first match
    const matchIndex = content.search(pattern);
    pattern.lastIndex = 0;
    const start = Math.max(0, matchIndex - 60);
    const end = Math.min(content.length, matchIndex + 80);
    let excerpt = content.slice(start, end).replace(/\n+/g, ' ').trim();
    if (start > 0) excerpt = `…${excerpt}`;
    if (end < content.length) excerpt = `${excerpt}…`;

    results.push({ id: fileId, name: basename(filePath), excerpt });
  }

  return results;
}

// ── Route registration ────────────────────────────────────────────────────────

export function registerVaultEditorRoutes(router: Pick<Express, 'get' | 'put' | 'post' | 'delete'>): void {
  // GET /api/vault/tree?dir=<rel-id>  — list a directory (shallow)
  // dir defaults to root when omitted / empty
  router.get('/api/vault/tree', (req, res) => {
    try {
      const root = getRoot();
      const dirParam = typeof req.query.dir === 'string' ? req.query.dir.trim() : '';
      let abs: string;
      if (!dirParam) {
        abs = root;
      } else {
        const resolved = safePath(dirParam);
        if (!resolved) {
          res.status(400).json({ error: 'Invalid path' });
          return;
        }
        abs = resolved;
      }
      if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        res.status(404).json({ error: 'Directory not found' });
        return;
      }
      res.json({ root, entries: readDirEntries(root, abs) });
    } catch (err) {
      logError('vault/tree error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/vault/file?id=<rel-id>  — read file content
  router.get('/api/vault/file', (req, res) => {
    try {
      const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
      const abs = id ? safePath(id) : null;
      if (!abs) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      if (!existsSync(abs) || !statSync(abs).isFile()) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      const content = readFileSync(abs, 'utf-8');
      const stats = statSync(abs);
      res.json({ id, content, updatedAt: new Date(stats.mtimeMs).toISOString() });
    } catch (err) {
      logError('vault/file GET error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // PUT /api/vault/file  — create or overwrite a file
  // body: { id: string, content: string }
  router.put('/api/vault/file', (req, res) => {
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
      const abs = safePath(id.trim());
      if (!abs) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf-8');
      const stats = statSync(abs);
      const root = getRoot();
      res.json(entryFromStat(root, abs, stats));
    } catch (err) {
      logError('vault/file PUT error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // DELETE /api/vault/file?id=<rel-id>  — delete file or folder (recursive)
  router.delete('/api/vault/file', (req, res) => {
    try {
      const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
      const abs = id ? safePath(id) : null;
      if (!abs) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      if (!existsSync(abs)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      deleteVaultPath(abs);
      res.json({ ok: true });
    } catch (err) {
      logError('vault/file DELETE error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/vault/rename  — rename / move within the vault
  // body: { id: string, newName: string, parentId?: string }  (newName is just the basename)
  router.post('/api/vault/rename', (req, res) => {
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
      const abs = safePath(id.trim());
      if (!abs) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      if (!existsSync(abs)) {
        res.status(404).json({ error: 'Not found' });
        return;
      }
      const root = getRoot();
      const parentAbs = parentId === null
        ? root
        : typeof parentId === 'string'
        ? (parentId.trim() ? safePath(parentId.trim().replace(/^\/+|\/+$/g, '')) : root)
        : dirname(abs);
      if (!parentAbs || !existsSync(parentAbs) || !statSync(parentAbs).isDirectory()) {
        res.status(400).json({ error: 'Target folder does not exist' });
        return;
      }
      const newAbs = join(parentAbs, newName.trim());
      if (!isInsideRoot(root, newAbs)) {
        res.status(400).json({ error: 'Target path is outside vault' });
        return;
      }
      if (statSync(abs).isDirectory() && (newAbs === abs || newAbs.startsWith(`${abs}/`))) {
        res.status(400).json({ error: 'Cannot move a folder into itself' });
        return;
      }
      if (existsSync(newAbs)) {
        res.status(409).json({ error: 'A file or folder with that name already exists' });
        return;
      }
      renameSync(abs, newAbs);
      const stats = statSync(newAbs);
      res.json(entryFromStat(root, newAbs, stats));
    } catch (err) {
      logError('vault/rename error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/vault/folder  — create a directory
  // body: { id: string }
  router.post('/api/vault/folder', (req, res) => {
    try {
      const { id } = req.body as { id?: unknown };
      if (typeof id !== 'string' || !id.trim()) {
        res.status(400).json({ error: 'id is required' });
        return;
      }
      const abs = safePath(id.trim());
      if (!abs) {
        res.status(400).json({ error: 'Invalid id' });
        return;
      }
      mkdirSync(abs, { recursive: true });
      const stats = statSync(abs);
      const root = getRoot();
      res.json(entryFromStat(root, abs, stats));
    } catch (err) {
      logError('vault/folder error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/vault/backlinks?id=<rel-id>  — find files that [[wikilink]] to this file
  router.get('/api/vault/backlinks', (req, res) => {
    try {
      const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
      if (!id) { res.status(400).json({ error: 'id is required' }); return; }
      const root = getRoot();
      const targetName = basename(id).replace(/\.md$/i, '');
      res.json({ id, targetName, backlinks: findBacklinks(id, root) });
    } catch (err) {
      logError('vault/backlinks', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/vault/note-search?q=...&limit=... — note title/path search for mobile linking
  router.get('/api/vault/note-search', (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const limit = Math.min(50, parseInt(String(req.query.limit ?? '20'), 10) || 20);
      const root = getRoot();
      res.json({ results: searchVaultNotes(root, q, limit) });
    } catch (err) {
      logError('vault/note-search', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/vault/search?q=...&limit=... — full-text search across all .md files
  router.get('/api/vault/search', (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      if (!q) { res.json({ results: [] }); return; }
      const limit = Math.min(50, parseInt(String(req.query.limit ?? '20'), 10) || 20);
      const root = getRoot();
      const files = collectAllMarkdownFiles(root);
      const lower = q.toLowerCase();
      const results: Array<{ id: string; name: string; excerpt: string; matchCount: number }> = [];

      for (const filePath of files) {
        const id = relative(root, filePath).replace(/\\/g, '/');
        const name = basename(filePath);
        let content: string;
        try { content = readFileSync(filePath, 'utf-8'); } catch { continue; }
        const contentLower = content.toLowerCase();
        const nameLower = name.toLowerCase();
        // Name match scores higher
        const nameMatch = nameLower.includes(lower);
        const contentMatch = contentLower.includes(lower);
        if (!nameMatch && !contentMatch) continue;
        // Count occurrences
        let count = 0;
        let pos = 0;
        while ((pos = contentLower.indexOf(lower, pos)) !== -1) { count++; pos += lower.length; }
        // Build excerpt around first content match
        const firstIdx = contentLower.indexOf(lower);
        const start = Math.max(0, firstIdx - 60);
        const end = Math.min(content.length, firstIdx + lower.length + 80);
        let excerpt = firstIdx >= 0
          ? content.slice(start, end).replace(/\n+/g, ' ').trim()
          : '';
        if (start > 0) excerpt = `…${excerpt}`;
        if (end < content.length) excerpt = `${excerpt}…`;
        results.push({ id, name, excerpt, matchCount: count + (nameMatch ? 100 : 0) });
        if (results.length >= limit * 3) break; // collect extras, then sort
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
  router.post('/api/vault/move', (req, res) => {
    try {
      const { id, targetDir } = req.body as { id?: unknown; targetDir?: unknown };
      if (typeof id !== 'string' || !id.trim()) { res.status(400).json({ error: 'id is required' }); return; }
      if (typeof targetDir !== 'string') { res.status(400).json({ error: 'targetDir must be a string' }); return; }
      const root = getRoot();
      const srcAbs = safePath(id.trim());
      if (!srcAbs) { res.status(400).json({ error: 'Invalid source id' }); return; }
      if (!existsSync(srcAbs)) { res.status(404).json({ error: 'Source not found' }); return; }
      const destDir = targetDir.trim()
        ? safePath(targetDir.trim().replace(/\/+$/, ''))
        : root;
      if (!destDir) { res.status(400).json({ error: 'Invalid target directory' }); return; }
      if (!existsSync(destDir) || !statSync(destDir).isDirectory()) {
        res.status(400).json({ error: 'Target directory does not exist' }); return;
      }
      const destAbs = join(destDir, basename(srcAbs));
      if (!isInsideRoot(root, destAbs)) { res.status(400).json({ error: 'Target is outside vault' }); return; }
      if (existsSync(destAbs)) { res.status(409).json({ error: 'A file with that name already exists there' }); return; }
      renameSync(srcAbs, destAbs);
      res.json(entryFromStat(root, destAbs, statSync(destAbs)));
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

      const root = getRoot();
      const directoryId = typeof payload.directoryId === 'string'
        ? payload.directoryId.trim().replace(/^\/+|\/+$/g, '')
        : '';
      const targetDirAbs = directoryId ? safePath(directoryId) : root;
      if (!targetDirAbs) {
        res.status(400).json({ error: 'Invalid target directory' });
        return;
      }

      const imported = await importVaultSharedItem({
        kind,
        root,
        targetDirAbs,
        ...(typeof payload.title === 'string' ? { title: payload.title } : {}),
        ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
        ...(typeof payload.url === 'string' ? { url: payload.url } : {}),
        ...(typeof payload.mimeType === 'string' ? { mimeType: payload.mimeType } : {}),
        ...(typeof payload.fileName === 'string' ? { fileName: payload.fileName } : {}),
        ...(typeof payload.dataBase64 === 'string' ? { dataBase64: payload.dataBase64 } : {}),
        ...(typeof payload.sourceApp === 'string' ? { sourceApp: payload.sourceApp } : {}),
        ...(typeof payload.createdAt === 'string' ? { createdAt: payload.createdAt } : {}),
      });

      const noteStats = statSync(imported.notePath);
      res.status(201).json({
        note: entryFromStat(root, imported.notePath, noteStats),
        sourceKind: imported.sourceKind,
        title: imported.title,
        ...(imported.asset ? { asset: imported.asset } : {}),
      });
    } catch (err) {
      logError('vault/share-import', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/vault/image  — save a base64-encoded image to _attachments/
  // body: { filename: string, dataUrl: string }
  router.post('/api/vault/image', (req, res) => {
    try {
      const { filename, dataUrl } = req.body as { filename?: unknown; dataUrl?: unknown };
      if (typeof filename !== 'string' || !filename.trim()) { res.status(400).json({ error: 'filename required' }); return; }
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) { res.status(400).json({ error: 'dataUrl must be a data: URL' }); return; }
      const root = getRoot();
      const attachDir = join(root, '_attachments');
      mkdirSync(attachDir, { recursive: true });
      const buf = decodeVaultImageDataUrl(dataUrl);
      const safeName = basename(filename.trim()).replace(/[^a-zA-Z0-9._-]/g, '-');
      const ts = Date.now();
      const outName = `${ts}-${safeName}`;
      const outPath = join(attachDir, outName);
      writeFileSync(outPath, buf);
      const id = `_attachments/${outName}`;
      res.json({ id, url: `/api/vault/asset?id=${encodeURIComponent(id)}` });
    } catch (err) {
      logError('vault/image', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /api/vault/asset?id=...  — serve a binary vault file (images, etc.)
  router.get('/api/vault/asset', (req, res: Response) => {
    try {
      const id = typeof req.query.id === 'string' ? req.query.id.trim() : '';
      const abs = id ? safePath(id) : null;
      if (!abs) { res.status(400).json({ error: 'Invalid id' }); return; }
      if (!existsSync(abs) || !statSync(abs).isFile()) { res.status(404).json({ error: 'Not found' }); return; }
      const mime = mimeLookup(abs) || 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(readFileSync(abs));
    } catch (err) {
      logError('vault/asset', { message: String(err) });
      res.status(500).end();
    }
  });
}
