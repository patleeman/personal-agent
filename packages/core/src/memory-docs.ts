import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from 'fs';
import { basename, join, resolve } from 'path';
import { getProfilesRoot } from './runtime/paths.js';

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
  return resolve(options.profilesRoot ?? getProfilesRoot());
}

export function getMemoryDocsDir(options: ResolveMemoryDocsOptions = {}): string {
  return join(resolveProfilesRootForMemory(options), '_memory');
}

function listLegacyProfileMemoryDirs(profilesRoot: string): string[] {
  if (!existsSync(profilesRoot)) {
    return [];
  }

  return readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== '_memory')
    .map((entry) => join(profilesRoot, entry.name, 'agent', 'memory'))
    .filter((dirPath) => existsSync(dirPath))
    .sort();
}

function removeDirIfEmpty(path: string): void {
  if (!existsSync(path)) {
    return;
  }

  if (readdirSync(path).length > 0) {
    return;
  }

  rmSync(path, { recursive: true, force: true });
}

function resolveMigrationConflictBackupPath(filePath: string): string {
  let candidate = `${filePath}.migration-conflict.bak`;
  let suffix = 2;

  while (existsSync(candidate)) {
    candidate = `${filePath}.migration-conflict.${suffix}.bak`;
    suffix += 1;
  }

  return candidate;
}

export function migrateLegacyProfileMemoryDirs(options: ResolveMemoryDocsOptions = {}): LegacyMemoryMigrationResult {
  const profilesRoot = resolveProfilesRootForMemory(options);
  const memoryDir = getMemoryDocsDir({ profilesRoot });
  const migratedFiles: LegacyMemoryMigrationRecord[] = [];

  const legacyDirs = listLegacyProfileMemoryDirs(profilesRoot);
  if (legacyDirs.length === 0) {
    return {
      memoryDir,
      migratedFiles,
    };
  }

  mkdirSync(memoryDir, { recursive: true });

  for (const legacyDir of legacyDirs) {
    const files = readdirSync(legacyDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => join(legacyDir, entry.name))
      .sort();

    for (const filePath of files) {
      const targetPath = join(memoryDir, basename(filePath));
      if (resolve(filePath) === resolve(targetPath)) {
        continue;
      }

      if (existsSync(targetPath)) {
        const legacyContent = readFileSync(filePath, 'utf-8');
        const targetContent = readFileSync(targetPath, 'utf-8');

        if (legacyContent === targetContent) {
          rmSync(filePath, { force: true });
          continue;
        }

        renameSync(filePath, resolveMigrationConflictBackupPath(filePath));
        continue;
      }

      renameSync(filePath, targetPath);
      migratedFiles.push({ from: filePath, to: targetPath });
    }

    removeDirIfEmpty(legacyDir);
  }

  return {
    memoryDir,
    migratedFiles,
  };
}
