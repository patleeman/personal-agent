import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dynamicImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, any>>;
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

async function resolveRepoRoot(): Promise<string> {
  if (process.env.PERSONAL_AGENT_REPO_ROOT) {
    return process.env.PERSONAL_AGENT_REPO_ROOT;
  }

  try {
    const core = await dynamicImport('@personal-agent/core');
    if (typeof core.getRepoRoot === 'function') {
      return core.getRepoRoot() as string;
    }
  } catch {
    // Fall through to process.cwd() for tests and unusual embedders.
  }

  return process.cwd();
}

async function serverModule(specifier: string): Promise<string> {
  if (!specifier.startsWith('.')) return specifier;

  const repoRoot = await resolveRepoRoot();
  const compiledPath = resolve(repoRoot, 'packages/desktop/dist/server/extensions/backendApi', specifier);
  const sourcePath = resolve(repoRoot, 'packages/desktop/server/extensions/backendApi', specifier);
  const candidates = [compiledPath, sourcePath, sourcePath.endsWith('.js') ? sourcePath.slice(0, -3) + '.ts' : sourcePath];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return pathToFileURL(candidate).href;
    }
  }

  return pathToFileURL(compiledPath).href;
}

async function callModuleExport<T>(specifier: string, name: string, ...args: unknown[]): Promise<T> {
  const module = await dynamicImport(await serverModule(specifier));
  const fn = module[name];
  if (typeof fn !== 'function') throw new Error(`Knowledge backend API export ${name} is unavailable.`);
  return (fn as (...callArgs: unknown[]) => Promise<T> | T)(...args);
}

async function getVaultRoot(): Promise<string> {
  return callModuleExport<string>('@personal-agent/core', 'getVaultRoot');
}

function isInsideRoot(root: string, target: string): boolean {
  const rel = relative(root, target);
  return !rel.startsWith('..') && rel !== '..';
}

async function requireVaultPath(id: string): Promise<string> {
  if (!id || id.includes('\u0000')) throw new Error('invalid path');
  const clean = id.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '').trim();
  if (!clean) throw new Error('invalid path');
  const segments = clean.split('/');
  if (segments.some((segment) => segment === '.' || segment === '..')) throw new Error('invalid path');
  const root = await getVaultRoot();
  const abs = resolve(root, clean);
  if (!isInsideRoot(root, abs)) throw new Error('invalid path');
  return abs;
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
    await callModuleExport<void>('../../shared/appEvents.js', 'invalidateAppTopics', 'knowledgeBase');
  } catch {
    // Invalidation is best-effort for extension backend bundles.
  }
}

export const knowledgeVault: Record<string, unknown> = {
  async listFiles() {
    const vaultRoot = await getVaultRoot();
    const files = await callModuleExport('../../knowledge/vaultFiles.js', 'listVaultFiles', vaultRoot);
    return { root: vaultRoot, files };
  },
  async tree(input: { dir?: string } = {}) {
    const vaultRoot = await getVaultRoot();
    const abs = input.dir ? await requireVaultPath(input.dir) : vaultRoot;
    return { entries: readVaultDirEntries(vaultRoot, abs) };
  },
  async readFile(input: { id: string }) {
    const abs = await requireVaultPath(input.id);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error('file not found');
    const stats = statSync(abs);
    return { id: input.id, content: readFileSync(abs, 'utf-8'), updatedAt: new Date(stats.mtimeMs).toISOString() };
  },
  async writeFile(input: { id: string; content: string }) {
    const abs = await requireVaultPath(input.id);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, input.content, 'utf-8');
    await emitChanged();
    return vaultEntryFromStat(await getVaultRoot(), abs);
  },
  async createFolder(input: { id: string }) {
    const abs = await requireVaultPath(input.id);
    mkdirSync(abs, { recursive: true });
    await emitChanged();
    return vaultEntryFromStat(await getVaultRoot(), abs);
  },
  async deleteFile(input: { id: string }) {
    const abs = await requireVaultPath(input.id);
    rmSync(abs, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    await emitChanged();
    return { ok: true };
  },
  async rename(input: { id: string; newName: string }) {
    const abs = await requireVaultPath(input.id);
    const next = await requireVaultPath(join(dirname(input.id), basename(input.newName)));
    renameSync(abs, next);
    await emitChanged();
    return vaultEntryFromStat(await getVaultRoot(), next);
  },
  async move(input: { id: string; targetDir: string }) {
    const abs = await requireVaultPath(input.id);
    const next = await requireVaultPath(join(input.targetDir || '', basename(input.id)));
    mkdirSync(dirname(next), { recursive: true });
    renameSync(abs, next);
    await emitChanged();
    return vaultEntryFromStat(await getVaultRoot(), next);
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
    const abs = await requireVaultPath(id);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, decodeVaultImageDataUrl(input.dataUrl));
    await emitChanged();
    return { id, url: `/api/vault/asset?id=${encodeURIComponent(id)}` };
  },
  async importUrl(input: { url: string; title?: string; directoryId?: string; sourceApp?: string }) {
    const vaultRoot = await getVaultRoot();
    const result = await callModuleExport('../../routes/vaultShareImport.js', 'importVaultSharedItem', {
      kind: 'url',
      root: vaultRoot,
      targetDirAbs: vaultRoot,
      ...input,
    });
    await emitChanged();
    return result;
  },
  async resolvePromptReferences(input: { text: string }) {
    const files = await callModuleExport<Array<{ id: string; path: string }>>(
      '../../knowledge/vaultFiles.js',
      'resolveMentionedVaultFiles',
      input.text,
    );
    return {
      contextBlocks:
        files.length > 0
          ? [{ content: await callModuleExport('../../knowledge/vaultFiles.js', 'buildReferencedVaultFilesContext', files) }]
          : [],
      references: files.map((file) => ({ kind: 'knowledgeFile', id: file.id, path: file.path })),
    };
  },
};
