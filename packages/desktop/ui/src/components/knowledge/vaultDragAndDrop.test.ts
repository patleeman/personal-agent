import { describe, expect, it } from 'vitest';
import { canDropVaultEntry, getVaultEntryParentDir, normalizeVaultDir } from './vaultDragAndDrop';

describe('vaultDragAndDrop', () => {
  it('normalizes vault directory ids', () => {
    expect(normalizeVaultDir('')).toBe('');
    expect(normalizeVaultDir('notes')).toBe('notes/');
    expect(normalizeVaultDir('notes/sub/')).toBe('notes/sub/');
  });

  it('derives parent directories for files and folders', () => {
    expect(getVaultEntryParentDir({ id: 'notes/demo.md', kind: 'file' } as const)).toBe('notes/');
    expect(getVaultEntryParentDir({ id: 'notes/archive/', kind: 'folder' } as const)).toBe('notes/');
    expect(getVaultEntryParentDir({ id: 'top-level.md', kind: 'file' } as const)).toBe('');
  });

  it('prevents invalid self and descendant drops', () => {
    expect(canDropVaultEntry({ id: 'notes/demo.md', kind: 'file' } as const, 'notes/')).toBe(false);
    expect(canDropVaultEntry({ id: 'notes/demo.md', kind: 'file' } as const, 'projects/')).toBe(true);
    expect(canDropVaultEntry({ id: 'notes/archive/', kind: 'folder' } as const, 'notes/archive/')).toBe(false);
    expect(canDropVaultEntry({ id: 'notes/archive/', kind: 'folder' } as const, 'notes/archive/nested/')).toBe(false);
    expect(canDropVaultEntry({ id: 'notes/archive/', kind: 'folder' } as const, 'projects/')).toBe(true);
  });
});
