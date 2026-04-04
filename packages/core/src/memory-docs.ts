import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { getDurableNotesDir, getDurableProfilesDir } from './runtime/paths.js';

export interface ResolveMemoryDocsOptions {
  profilesRoot?: string;
}

export interface LegacyMemoryMigrationRecord {
  from: string;
  to: string;
}

export interface LegacyMemoryMigrationResult {
  memoryDir: string;
  migratedFiles: LegacyMemoryMigrationRecord[];
}

function resolveProfilesRootForMemory(options: ResolveMemoryDocsOptions = {}): string {
  return resolve(options.profilesRoot ?? getDurableProfilesDir());
}

export function getMemoryDocsDir(options: ResolveMemoryDocsOptions = {}): string {
  return getDurableNotesDir(dirname(resolveProfilesRootForMemory(options)));
}

export function migrateLegacyProfileMemoryDirs(options: ResolveMemoryDocsOptions = {}): LegacyMemoryMigrationResult {
  const profilesRoot = resolveProfilesRootForMemory(options);
  const notesDir = getMemoryDocsDir({ profilesRoot });

  mkdirSync(notesDir, { recursive: true });

  return {
    memoryDir: notesDir,
    migratedFiles: [],
  };
}
