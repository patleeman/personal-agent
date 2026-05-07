import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { getVaultRoot } from '@personal-agent/core';

interface VaultEntry {
  id: string;
  kind: 'file' | 'folder';
  name: string;
  sizeBytes: number;
  updatedAt: string;
}

function getRoot(): string {
  return resolve(getVaultRoot());
}

function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === '' || (!rel.startsWith('..') && rel !== '..');
}

function safePath(id = ''): string {
  const clean = id.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
  if (clean.includes('\0')) throw new Error('Invalid vault path.');
  const segments = clean ? clean.split('/') : [];
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new Error('Invalid vault path.');
  const root = getRoot();
  const abs = resolve(root, clean);
  if (!isInsideRoot(root, abs)) throw new Error('Invalid vault path.');
  return abs;
}

function entryFromPath(root: string, abs: string): VaultEntry {
  const stats = statSync(abs);
  const rel = relative(root, abs).replace(/\\/g, '/');
  const kind = stats.isDirectory() ? 'folder' : 'file';
  return {
    id: kind === 'folder' ? `${rel}/` : rel,
    kind,
    name: basename(abs),
    sizeBytes: kind === 'file' ? stats.size : 0,
    updatedAt: new Date(stats.mtimeMs).toISOString(),
  };
}

export function createExtensionVaultCapability() {
  return {
    async read(path: string) {
      const abs = safePath(path);
      if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error('Vault file not found.');
      return { id: path, content: readFileSync(abs, 'utf-8'), updatedAt: new Date(statSync(abs).mtimeMs).toISOString() };
    },
    async write(path: string, content: string) {
      if (typeof content !== 'string') throw new Error('content must be a string.');
      const abs = safePath(path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf-8');
      return entryFromPath(getRoot(), abs);
    },
    async list(path = '') {
      const root = getRoot();
      const abs = safePath(path);
      if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new Error('Vault directory not found.');
      return readdirSync(abs, { withFileTypes: true })
        .filter((entry) => !entry.isSymbolicLink() && !entry.name.startsWith('.'))
        .flatMap((entry) => {
          const child = join(abs, entry.name);
          if (!entry.isFile() && !entry.isDirectory()) return [];
          return [entryFromPath(root, child)];
        })
        .sort((left, right) => left.id.localeCompare(right.id));
    },
    async search(query: string) {
      const needle = query.trim().toLowerCase();
      if (!needle) return [];
      const root = getRoot();
      const results: Array<{ id: string; name: string; excerpt: string }> = [];
      const stack = [root];
      while (stack.length > 0 && results.length < 50) {
        const current = stack.pop() as string;
        for (const entry of readdirSync(current, { withFileTypes: true })) {
          if (entry.isSymbolicLink() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const child = join(current, entry.name);
          if (entry.isDirectory()) {
            stack.push(child);
            continue;
          }
          if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
          const content = readFileSync(child, 'utf-8');
          const index = content.toLowerCase().indexOf(needle);
          if (index < 0) continue;
          results.push({
            id: relative(root, child).replace(/\\/g, '/'),
            name: entry.name,
            excerpt: content.slice(Math.max(0, index - 80), index + 180),
          });
        }
      }
      return results;
    },
  };
}
