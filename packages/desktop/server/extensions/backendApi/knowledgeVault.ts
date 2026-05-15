import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';

import { defaultFileSystemAuthority, type FileAccess, type ScopedFileSystem } from '../../filesystem/filesystemAuthority.js';
import { callServerModuleExport } from './serverModuleResolver.js';
const SKIPPED_DIRS = new Set(['.git', 'node_modules', '.DS_Store']);
const IMAGE_FILE_EXTENSIONS = new Set(['avif', 'gif', 'heic', 'heif', 'jpeg', 'jpg', 'png', 'svg', 'webp']);
const MIME_EXTENSIONS = new Map([
  ['image/avif', 'avif'],
  ['image/gif', 'gif'],
  ['image/heic', 'heic'],
  ['image/heif', 'heif'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/svg+xml', 'svg'],
  ['image/webp', 'webp'],
]);

interface VaultEntry {
  id: string;
  kind: 'file' | 'folder';
  name: string;
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

async function getVaultRoot(): Promise<string> {
  return callServerModuleExport<string>('@personal-agent/core', 'getVaultRoot');
}

async function vaultRoot(access: FileAccess[], reason: string): Promise<ScopedFileSystem> {
  const root = await getVaultRoot();
  return defaultFileSystemAuthority.requestRoot({
    subject: { type: 'core', id: 'knowledge-vault' },
    root: { kind: 'vault', id: root, path: root, displayName: 'Knowledge vault' },
    access,
    reason,
  });
}

function normalizeVaultId(id: string): string {
  if (!id || id.includes('\u0000')) throw new Error('invalid path');
  const clean = id.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
  if (!clean) throw new Error('invalid path');
  const segments = clean.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new Error('invalid path');
  return clean;
}

async function requireVaultPath(id: string, access: FileAccess[] = ['metadata']): Promise<{ root: ScopedFileSystem; id: string }> {
  const clean = normalizeVaultId(id);
  const root = await vaultRoot(access, 'knowledge vault path');
  return { root, id: clean };
}

async function vaultEntryFromScopedStat(root: ScopedFileSystem, id: string): Promise<VaultEntry> {
  const stats = await root.stat(id);
  const kind = stats.type === 'directory' ? 'folder' : 'file';
  return {
    id: kind === 'folder' ? `${id.replace(/\/+$/, '')}/` : id,
    kind,
    name: basename(id),
    path: id,
    sizeBytes: kind === 'file' ? (stats.size ?? 0) : 0,
    updatedAt: stats.modifiedAt ?? new Date().toISOString(),
  };
}

function vaultEntryFromStat(root: string, abs: string): VaultEntry {
  const stats = statSync(abs);
  const rel = relative(root, abs).replace(/\\/g, '/');
  const kind = stats.isDirectory() ? 'folder' : 'file';
  return {
    id: kind === 'folder' ? `${rel}/` : rel,
    kind,
    name: basename(abs),
    path: abs,
    sizeBytes: kind === 'file' ? stats.size : 0,
    updatedAt: new Date(stats.mtimeMs).toISOString(),
  };
}

function readVaultDirEntries(root: string, abs: string): VaultEntry[] {
  try {
    return readdirSync(abs, { withFileTypes: true })
      .filter((entry) => !entry.isSymbolicLink())
      .filter((entry) => !(entry.isDirectory() && SKIPPED_DIRS.has(entry.name)))
      .filter((entry) => !entry.name.startsWith('.') || entry.isDirectory())
      .flatMap((entry) => {
        const childAbs = join(abs, entry.name);
        try {
          const stats = statSync(childAbs);
          if (!stats.isFile() && !stats.isDirectory()) return [];
          return [vaultEntryFromStat(root, childAbs)];
        } catch {
          return [];
        }
      })
      .sort((left, right) => (left.kind !== right.kind ? (left.kind === 'folder' ? -1 : 1) : left.name.localeCompare(right.name)));
  } catch {
    return [];
  }
}

function collectMarkdownFiles(root: string, dir = root): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) return SKIPPED_DIRS.has(entry.name) ? [] : collectMarkdownFiles(root, abs);
    return entry.isFile() && entry.name.toLowerCase().endsWith('.md') ? [abs] : [];
  });
}

function parseVaultSearchLimit(value: unknown): number {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== 'string' && typeof candidate !== 'number') return 20;
  const normalized = String(candidate).trim();
  if (!/^\d+$/.test(normalized)) return 20;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(50, parsed) : 20;
}

function searchVaultNotes(root: string, query: string, limit: number) {
  const normalized = query.trim().toLowerCase();
  const results: Array<{ id: string; name: string; title: string; excerpt: string; score: number }> = [];
  for (const filePath of collectMarkdownFiles(root)) {
    const id = relative(root, filePath).replace(/\\/g, '/');
    const name = basename(filePath);
    const title = name.replace(/\.md$/i, '');
    let content = '';
    try {
      content = readFileSync(filePath, 'utf-8');
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
    if (titleIndex === -1 && pathIndex === -1 && contentIndex === -1) continue;
    let score = 0;
    if (titleIndex === 0) score += 500;
    else if (titleIndex > 0) score += 350;
    if (pathIndex >= 0) score += 200;
    if (contentIndex >= 0) score += 100;
    const excerpt =
      contentIndex >= 0
        ? content
            .slice(Math.max(0, contentIndex - 80), contentIndex + 160)
            .replace(/\s+/g, ' ')
            .trim()
        : id;
    results.push({ id, name, title, excerpt, score });
  }
  return results
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit)
    .map(({ score: _score, ...result }) => result);
}

function findVaultBacklinks(targetId: string, root: string) {
  const targetName = basename(targetId).replace(/\.md$/i, '');
  const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\[\\[${escapedName}(?:\\|[^\\]]*)?\\]\\]`, 'gi');
  return collectMarkdownFiles(root).flatMap((filePath) => {
    const fileId = relative(root, filePath).replace(/\\/g, '/');
    if (fileId === targetId) return [];
    let content = '';
    try {
      content = readFileSync(filePath, 'utf-8');
    } catch {
      return [];
    }
    const matchIndex = content.search(pattern);
    if (matchIndex < 0) return [];
    const excerpt = content
      .slice(Math.max(0, matchIndex - 60), Math.min(content.length, matchIndex + 80))
      .replace(/\s+/g, ' ')
      .trim();
    return [{ id: fileId, title: basename(fileId).replace(/\.md$/i, ''), excerpt }];
  });
}

function decodeVaultImageDataUrl(dataUrl: string): Buffer {
  const commaIndex = dataUrl.indexOf(',');
  const metadata = dataUrl.slice(0, commaIndex).trim().toLowerCase();
  if (commaIndex < 0 || !metadata.startsWith('data:image/') || !metadata.includes(';base64'))
    throw new Error('dataUrl must be an image data: URL');
  const base64 = dataUrl.slice(commaIndex + 1).trim();
  if (!base64 || base64.length % 4 === 1 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))
    throw new Error('dataUrl must contain valid base64 image data');
  const decoded = Buffer.from(base64, 'base64');
  if (decoded.length === 0) throw new Error('dataUrl must contain non-empty image data');
  return decoded;
}

function buildVaultImageUploadFileName(filename: string, dataUrl: string, timestamp = Date.now()): string {
  const metadata = dataUrl.slice(0, dataUrl.indexOf(',')).trim().toLowerCase();
  const mimeExt = MIME_EXTENSIONS.get(metadata.slice('data:'.length).split(';')[0] ?? '');
  const fileExt = extname(filename).trim().replace(/^\./, '').toLowerCase();
  const extension = mimeExt || (IMAGE_FILE_EXTENSIONS.has(fileExt) ? fileExt : 'png');
  const originalName = basename(filename.trim());
  const baseName = originalName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '-') || 'image';
  return `${timestamp}-${baseName}.${extension}`;
}

async function emitChanged() {
  try {
    await callServerModuleExport<void>('../../shared/appEvents.js', 'invalidateAppTopics', 'knowledgeBase');
  } catch {
    // Invalidation is best-effort for extension backend bundles.
  }
}

export const knowledgeVault: Record<string, unknown> = {
  async listFiles() {
    const vaultRoot = await getVaultRoot();
    const files = await callServerModuleExport('../../knowledge/vaultFiles.js', 'listVaultFiles', vaultRoot);
    return { root: vaultRoot, files };
  },
  async tree(input: { dir?: string } = {}) {
    if (!input.dir) {
      const vaultRootPath = await getVaultRoot();
      return { entries: readVaultDirEntries(vaultRootPath, vaultRootPath) };
    }
    const { root, id } = await requireVaultPath(input.dir, ['list', 'metadata']);
    const entries = await root.list(id, { depth: 0, excludeNames: [...SKIPPED_DIRS] });
    return {
      entries: entries
        .filter((entry) => entry.type === 'file' || entry.type === 'directory')
        .map((entry) => ({
          id: entry.type === 'directory' ? `${entry.path}/` : entry.path,
          kind: entry.type === 'directory' ? 'folder' : 'file',
          name: entry.name,
          path: entry.path,
          sizeBytes: entry.type === 'file' ? (entry.size ?? 0) : 0,
          updatedAt: entry.modifiedAt ?? new Date().toISOString(),
        })),
    };
  },
  async readFile(input: { id: string }) {
    const { root, id } = await requireVaultPath(input.id, ['read', 'metadata']);
    if (!(await root.exists(id)) || (await root.stat(id)).type !== 'file') throw new Error('file not found');
    const stats = await root.stat(id);
    return { id, content: await root.readText(id), updatedAt: stats.modifiedAt ?? new Date().toISOString() };
  },
  async writeFile(input: { id: string; content: string }) {
    const { root, id } = await requireVaultPath(input.id, ['write', 'metadata']);
    await root.writeText(id, input.content);
    await emitChanged();
    return vaultEntryFromScopedStat(root, id);
  },
  async createFolder(input: { id: string }) {
    const { root, id } = await requireVaultPath(input.id, ['write', 'metadata']);
    await root.createDirectory(id);
    await emitChanged();
    return vaultEntryFromScopedStat(root, id);
  },
  async deleteFile(input: { id: string }) {
    const { root, id } = await requireVaultPath(input.id, ['delete']);
    await root.remove(id, { recursive: true, force: true });
    await emitChanged();
    return { ok: true };
  },
  async rename(input: { id: string; newName: string }) {
    const source = await requireVaultPath(input.id, ['move', 'metadata']);
    const targetId = join(dirname(source.id), basename(input.newName)).replace(/\\/g, '/');
    await source.root.move(source.id, targetId);
    await emitChanged();
    return vaultEntryFromScopedStat(source.root, targetId);
  },
  async move(input: { id: string; targetDir: string }) {
    const source = await requireVaultPath(input.id, ['move', 'metadata']);
    const targetId = join(input.targetDir || '', basename(source.id)).replace(/\\/g, '/');
    await source.root.move(source.id, targetId);
    await emitChanged();
    return vaultEntryFromScopedStat(source.root, targetId);
  },
  async backlinks(input: { id: string }) {
    return { backlinks: findVaultBacklinks(input.id, await getVaultRoot()) };
  },
  async search(input: { q: string; limit?: number }) {
    return { results: searchVaultNotes(await getVaultRoot(), input.q, parseVaultSearchLimit(input.limit ?? 20)) };
  },
  async uploadImage(input: { filename: string; dataUrl: string }) {
    const fileName = buildVaultImageUploadFileName(input.filename, input.dataUrl);
    const id = `_attachments/${fileName}`;
    const target = await requireVaultPath(id, ['write']);
    await target.root.writeBytes(target.id, decodeVaultImageDataUrl(input.dataUrl));
    await emitChanged();
    return { id, url: `/api/vault/asset?id=${encodeURIComponent(id)}` };
  },
  async importUrl(input: { url: string; title?: string; directoryId?: string; sourceApp?: string }) {
    const vaultRoot = await getVaultRoot();
    const result = await callServerModuleExport('../../routes/vaultShareImport.js', 'importVaultSharedItem', {
      kind: 'url',
      root: vaultRoot,
      targetDirAbs: vaultRoot,
      ...input,
    });
    await emitChanged();
    return result;
  },
  async resolvePromptReferences(input: { text: string }) {
    const files = await callServerModuleExport<Array<{ id: string; path: string }>>(
      '../../knowledge/vaultFiles.js',
      'resolveMentionedVaultFiles',
      input.text,
    );
    return {
      contextBlocks:
        files.length > 0
          ? [{ content: await callServerModuleExport('../../knowledge/vaultFiles.js', 'buildReferencedVaultFilesContext', files) }]
          : [],
      references: files.map((file) => ({ kind: 'knowledgeFile', id: file.id, path: file.path })),
    };
  },
};
