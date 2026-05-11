import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { getVaultRoot } from '@personal-agent/core';

import { buildReferencedVaultFilesContext, listVaultFiles, resolveMentionedVaultFiles } from '../../knowledge/vaultFiles.js';
import {
  buildVaultImageUploadFileName,
  decodeVaultImageDataUrl,
  deleteVaultPath,
  findVaultBacklinks,
  parseVaultSearchLimit,
  readVaultDirEntries,
  safeVaultPath,
  searchVaultNotes,
  vaultEntryFromStat,
} from '../../routes/vaultEditor.js';
import { importVaultSharedItem } from '../../routes/vaultShareImport.js';
import { invalidateAppTopics } from '../../shared/appEvents.js';

function requireVaultPath(id: string): string {
  const abs = safeVaultPath(id);
  if (!abs) throw new Error('invalid path');
  return abs;
}

function root() {
  return getVaultRoot();
}

function emitChanged() {
  invalidateAppTopics('knowledgeBase');
}

export const knowledgeVault: Record<string, unknown> = {
  listFiles() {
    const vaultRoot = root();
    return { root: vaultRoot, files: listVaultFiles(vaultRoot) };
  },
  tree(input: { dir?: string } = {}) {
    const vaultRoot = root();
    const abs = input.dir ? requireVaultPath(input.dir) : vaultRoot;
    return { entries: readVaultDirEntries(vaultRoot, abs) };
  },
  readFile(input: { id: string }) {
    const abs = requireVaultPath(input.id);
    if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error('file not found');
    const stats = statSync(abs);
    return { id: input.id, content: readFileSync(abs, 'utf-8'), updatedAt: new Date(stats.mtimeMs).toISOString() };
  },
  writeFile(input: { id: string; content: string }) {
    const abs = requireVaultPath(input.id);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, input.content, 'utf-8');
    emitChanged();
    return vaultEntryFromStat(root(), abs, statSync(abs));
  },
  createFolder(input: { id: string }) {
    const abs = requireVaultPath(input.id);
    mkdirSync(abs, { recursive: true });
    emitChanged();
    return vaultEntryFromStat(root(), abs, statSync(abs));
  },
  deleteFile(input: { id: string }) {
    const abs = requireVaultPath(input.id);
    deleteVaultPath(abs);
    emitChanged();
    return { ok: true };
  },
  rename(input: { id: string; newName: string }) {
    const abs = requireVaultPath(input.id);
    const next = requireVaultPath(join(dirname(input.id), basename(input.newName)));
    renameSync(abs, next);
    emitChanged();
    return vaultEntryFromStat(root(), next, statSync(next));
  },
  move(input: { id: string; targetDir: string }) {
    const abs = requireVaultPath(input.id);
    const next = requireVaultPath(join(input.targetDir || '', basename(input.id)));
    mkdirSync(dirname(next), { recursive: true });
    renameSync(abs, next);
    emitChanged();
    return vaultEntryFromStat(root(), next, statSync(next));
  },
  backlinks(input: { id: string }) {
    return { backlinks: findVaultBacklinks(input.id, root()) };
  },
  search(input: { q: string; limit?: number }) {
    return { results: searchVaultNotes(root(), input.q, parseVaultSearchLimit(input.limit ?? 20)) };
  },
  uploadImage(input: { filename: string; dataUrl: string }) {
    const fileName = buildVaultImageUploadFileName(input.filename, input.dataUrl);
    const id = `_attachments/${fileName}`;
    const abs = requireVaultPath(id);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, decodeVaultImageDataUrl(input.dataUrl));
    emitChanged();
    return { id, url: `/api/vault/asset?id=${encodeURIComponent(id)}` };
  },
  async importUrl(input: { url: string; title?: string; directoryId?: string; sourceApp?: string }) {
    const vaultRoot = root();
    const result = await importVaultSharedItem({ kind: 'url', root: vaultRoot, targetDirAbs: vaultRoot, ...input });
    emitChanged();
    return result;
  },
  resolvePromptReferences(input: { text: string }) {
    const files = resolveMentionedVaultFiles(input.text);
    return {
      contextBlocks: files.length > 0 ? [{ content: buildReferencedVaultFilesContext(files) }] : [],
      references: files.map((file) => ({ kind: 'knowledgeFile', id: file.id, path: file.path })),
    };
  },
};
