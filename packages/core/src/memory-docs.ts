import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { getDurableNotesDir, getVaultRoot } from './runtime/paths.js';

export interface ResolveMemoryDocsOptions {
  vaultRoot?: string;
}

export interface LegacyMemoryMigrationRecord {
  from: string;
  to: string;
}

export interface LegacyMemoryMigrationResult {
  memoryDir: string;
  migratedFiles: LegacyMemoryMigrationRecord[];
}

function resolveVaultRootForMemory(options: ResolveMemoryDocsOptions = {}): string {
  return resolve(options.vaultRoot ?? getVaultRoot());
}

export function getMemoryDocsDir(options: ResolveMemoryDocsOptions = {}): string {
  return getDurableNotesDir(resolveVaultRootForMemory(options));
}

export function migrateLegacyProfileMemoryDirs(options: ResolveMemoryDocsOptions = {}): LegacyMemoryMigrationResult {
  const notesDir = getMemoryDocsDir({ vaultRoot: resolveVaultRootForMemory(options) });

  mkdirSync(notesDir, { recursive: true });

  return {
    memoryDir: notesDir,
    migratedFiles: [],
  };
}
