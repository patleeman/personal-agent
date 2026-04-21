/**
 * Vault editor routes — file CRUD for the knowledge base UI.
 */

import type { Express } from 'express';
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
import { basename, dirname, join, relative, resolve } from 'node:path';
import { getVaultRoot } from '@personal-agent/core';
import { logError } from '../middleware/index.js';

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
      rmSync(abs, { recursive: true, force: true });
      res.json({ ok: true });
    } catch (err) {
      logError('vault/file DELETE error', { message: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/vault/rename  — rename / move within the vault
  // body: { id: string, newName: string }  (newName is just the basename)
  router.post('/api/vault/rename', (req, res) => {
    try {
      const { id, newName } = req.body as { id?: unknown; newName?: unknown };
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
      const newAbs = join(dirname(abs), newName.trim());
      const root = getRoot();
      if (!isInsideRoot(root, newAbs)) {
        res.status(400).json({ error: 'Target path is outside vault' });
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
}
