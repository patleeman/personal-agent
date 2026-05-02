import type { VaultEntry } from '../../shared/types';

export function normalizeVaultDir(dir: string): string {
  const trimmed = dir.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!trimmed) {
    return '';
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export function getVaultEntryParentDir(entry: Pick<VaultEntry, 'id' | 'kind'>): string {
  const rawId = entry.kind === 'folder' ? entry.id.replace(/\/+$/, '') : entry.id;
  const parts = rawId.split('/');
  parts.pop();
  return parts.length > 0 ? `${parts.join('/')}/` : '';
}

export function canDropVaultEntry(entry: Pick<VaultEntry, 'id' | 'kind'>, targetDirInput: string): boolean {
  const targetDir = normalizeVaultDir(targetDirInput);
  const currentDir = getVaultEntryParentDir(entry);

  if (currentDir === targetDir) {
    return false;
  }

  if (entry.kind === 'folder') {
    const entryDir = normalizeVaultDir(entry.id);
    if (targetDir === entryDir) {
      return false;
    }

    if (targetDir.startsWith(entryDir)) {
      return false;
    }
  }

  return true;
}
