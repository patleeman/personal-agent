import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { getVaultRoot } from '@personal-agent/core';
import { extractMentionIds } from './promptReferences.js';

export interface VaultFileSummary {
  id: string;
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

function normalizeVaultRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').trim();
}

function isSafeVaultRelativePath(value: string): boolean {
  if (!value || value.includes('\u0000')) {
    return false;
  }

  const segments = normalizeVaultRelativePath(value).split('/').filter(Boolean);
  return segments.length > 0 && segments.every((segment) => segment !== '.' && segment !== '..');
}

function isInsideRoot(root: string, targetPath: string): boolean {
  const rel = relative(root, targetPath);
  return rel === '' || (!rel.startsWith('..') && rel !== '..');
}

function sortVaultFiles(files: VaultFileSummary[]): VaultFileSummary[] {
  return files.sort((left, right) => left.id.localeCompare(right.id) || left.path.localeCompare(right.path));
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
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
          continue;
        }

        stack.push(join(current, entry.name));
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const absolutePath = join(current, entry.name);
      let stats: ReturnType<typeof statSync>;
      try {
        stats = statSync(absolutePath);
      } catch {
        continue;
      }

      const id = normalizeVaultRelativePath(relative(root, absolutePath));
      if (!id) {
        continue;
      }

      files.push({
        id,
        name: basename(absolutePath),
        path: absolutePath,
        sizeBytes: stats.size,
        updatedAt: new Date(stats.mtimeMs).toISOString(),
      });
    }
  }

  return sortVaultFiles(files);
}

export function resolveVaultFileById(id: string, vaultRoot: string = getVaultRoot()): VaultFileSummary | null {
  const normalizedId = normalizeVaultRelativePath(id);
  if (!isSafeVaultRelativePath(normalizedId)) {
    return null;
  }

  const root = resolve(vaultRoot);
  const absolutePath = resolve(root, normalizedId);
  if (!isInsideRoot(root, absolutePath) || !existsSync(absolutePath)) {
    return null;
  }

  const stats = statSync(absolutePath);
  if (!stats.isFile()) {
    return null;
  }

  return {
    id: normalizedId,
    name: basename(absolutePath),
    path: absolutePath,
    sizeBytes: stats.size,
    updatedAt: new Date(stats.mtimeMs).toISOString(),
  };
}

export function resolveMentionedVaultFiles(text: string, vaultRoot: string = getVaultRoot()): VaultFileSummary[] {
  return extractMentionIds(text).flatMap((id) => {
    const resolved = resolveVaultFileById(id, vaultRoot);
    return resolved ? [resolved] : [];
  });
}

export function buildReferencedVaultFilesContext(files: VaultFileSummary[]): string {
  return [
    'Referenced vault files:',
    ...files.map((file) => [
      `- @${file.id}`,
      `  path: ${file.path}`,
      `  size: ${file.sizeBytes} bytes`,
      `  updated: ${file.updatedAt}`,
    ].join('\n')),
    'These are files under the durable knowledge vault. Read the exact file when the user refers to its contents or wants it changed.',
  ].join('\n');
}
