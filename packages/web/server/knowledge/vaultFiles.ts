import { existsSync, readdirSync, statSync, type Dirent, type Stats } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { getVaultRoot } from '@personal-agent/core';
import { extractMentionIds } from './promptReferences.js';

export interface VaultFileSummary {
  id: string;
  kind: 'file' | 'folder';
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

const SKIPPED_DIRECTORY_NAMES = new Set([
  '.git',
  '.next',
  '.obsidian',
  'coverage',
  'dist',
  'dist-server',
  'node_modules',
]);

const MAX_REFERENCED_FOLDER_CHILDREN = 20;

function normalizeVaultRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function normalizeVaultLookupPath(value: string): string {
  return normalizeVaultRelativePath(value).replace(/\/+$/, '');
}

function isSafeVaultRelativePath(value: string): boolean {
  if (!value || value.includes('\u0000')) {
    return false;
  }

  const segments = normalizeVaultLookupPath(value).split('/').filter(Boolean);
  return segments.length > 0 && segments.every((segment) => segment !== '.' && segment !== '..');
}

function isInsideRoot(root: string, targetPath: string): boolean {
  const rel = relative(root, targetPath);
  return rel === '' || (!rel.startsWith('..') && rel !== '..');
}

function sortVaultFiles(files: VaultFileSummary[]): VaultFileSummary[] {
  const kindOrder: Record<VaultFileSummary['kind'], number> = {
    folder: 0,
    file: 1,
  };

  return files.sort((left, right) => left.id.localeCompare(right.id) || kindOrder[left.kind] - kindOrder[right.kind] || left.path.localeCompare(right.path));
}

function buildVaultSummary(root: string, absolutePath: string, stats: Stats): VaultFileSummary | null {
  const relativePath = normalizeVaultRelativePath(relative(root, absolutePath));
  if (!relativePath) {
    return null;
  }

  const kind: VaultFileSummary['kind'] = stats.isDirectory() ? 'folder' : 'file';
  return {
    id: kind === 'folder' ? `${relativePath}/` : relativePath,
    kind,
    name: basename(absolutePath),
    path: absolutePath,
    sizeBytes: kind === 'file' ? stats.size : 0,
    updatedAt: new Date(stats.mtimeMs).toISOString(),
  };
}

function readVaultChildSummary(parent: VaultFileSummary, entry: Dirent): VaultFileSummary | null {
  if (entry.isSymbolicLink()) {
    return null;
  }

  if (entry.isDirectory() && SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
    return null;
  }

  const absolutePath = join(parent.path, entry.name);
  let stats: Stats;
  try {
    stats = statSync(absolutePath);
  } catch {
    return null;
  }

  if (!stats.isDirectory() && !stats.isFile()) {
    return null;
  }

  const kind: VaultFileSummary['kind'] = stats.isDirectory() ? 'folder' : 'file';
  return {
    id: kind === 'folder' ? `${parent.id}${entry.name}/` : `${parent.id}${entry.name}`,
    kind,
    name: entry.name,
    path: absolutePath,
    sizeBytes: kind === 'file' ? stats.size : 0,
    updatedAt: new Date(stats.mtimeMs).toISOString(),
  };
}

function readReferencedFolderChildren(folder: VaultFileSummary): { total: number; shown: VaultFileSummary[] } {
  if (folder.kind !== 'folder') {
    return { total: 0, shown: [] };
  }

  let entries: Dirent[];
  try {
    entries = readdirSync(folder.path, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch {
    return { total: 0, shown: [] };
  }

  const children = sortVaultFiles(entries.flatMap((entry) => {
    const child = readVaultChildSummary(folder, entry);
    return child ? [child] : [];
  }));

  return {
    total: children.length,
    shown: children.slice(0, MAX_REFERENCED_FOLDER_CHILDREN),
  };
}

export function listVaultFiles(vaultRoot: string = getVaultRoot()): VaultFileSummary[] {
  if (!vaultRoot || !existsSync(vaultRoot)) {
    return [];
  }

  const root = resolve(vaultRoot);
  const files: VaultFileSummary[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true })
        .filter((entry) => !entry.isSymbolicLink())
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch {
      continue;
    }

    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      let stats: Stats;
      try {
        stats = statSync(absolutePath);
      } catch {
        continue;
      }

      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }

        const summary = buildVaultSummary(root, absolutePath, stats);
        if (summary) {
          files.push(summary);
        }
        stack.push(absolutePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const summary = buildVaultSummary(root, absolutePath, stats);
      if (summary) {
        files.push(summary);
      }
    }
  }

  return sortVaultFiles(files);
}

export function resolveVaultFileById(id: string, vaultRoot: string = getVaultRoot()): VaultFileSummary | null {
  const normalizedId = normalizeVaultRelativePath(id);
  if (!isSafeVaultRelativePath(normalizedId)) {
    return null;
  }

  const expectsFolder = /\/+$/u.test(normalizedId);
  const lookupId = normalizeVaultLookupPath(normalizedId);
  if (!lookupId) {
    return null;
  }

  const root = resolve(vaultRoot);
  const absolutePath = resolve(root, lookupId);
  if (!isInsideRoot(root, absolutePath) || !existsSync(absolutePath)) {
    return null;
  }

  const stats = statSync(absolutePath);
  if (expectsFolder && !stats.isDirectory()) {
    return null;
  }
  if (!expectsFolder && !stats.isFile()) {
    return null;
  }

  return buildVaultSummary(root, absolutePath, stats);
}

export function resolveMentionedVaultFiles(text: string, vaultRoot: string = getVaultRoot()): VaultFileSummary[] {
  return extractMentionIds(text).flatMap((id) => {
    const resolved = resolveVaultFileById(id, vaultRoot);
    return resolved ? [resolved] : [];
  });
}

export function buildReferencedVaultFilesContext(files: VaultFileSummary[]): string {
  return [
    'Referenced indexed paths:',
    ...files.map((file) => {
      if (file.kind === 'folder') {
        const children = readReferencedFolderChildren(file);
        const childLines = children.shown.length > 0
          ? [
              `  children (${children.shown.length}${children.total > children.shown.length ? ` of ${children.total}` : ''}):`,
              ...children.shown.map((child) => `    - @${child.id}`),
            ]
          : ['  children: none'];

        return [
          `- @${file.id}`,
          '  kind: folder',
          `  path: ${file.path}`,
          `  updated: ${file.updatedAt}`,
          ...childLines,
        ].join('\n');
      }

      return [
        `- @${file.id}`,
        '  kind: file',
        `  path: ${file.path}`,
        `  size: ${file.sizeBytes} bytes`,
        `  updated: ${file.updatedAt}`,
      ].join('\n');
    }),
    'These are indexed paths under the folder-aware root. Read exact files when the user refers to their contents or wants them changed. When a folder is referenced, inspect the specific child file you need before editing.',
  ].join('\n');
}
