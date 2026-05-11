import { mkdirSync } from 'fs';
import { resolve } from 'path';
import { getDurableNotesDir, getVaultRoot } from './runtime/paths.js';
function resolveVaultRootForMemory(options = {}) {
  return resolve(options.vaultRoot ?? getVaultRoot());
}
export function getMemoryDocsDir(options = {}) {
  return getDurableNotesDir(resolveVaultRootForMemory(options));
}
export function migrateLegacyProfileMemoryDirs(options = {}) {
  const notesDir = getMemoryDocsDir({ vaultRoot: resolveVaultRootForMemory(options) });
  mkdirSync(notesDir, { recursive: true });
  return {
    memoryDir: notesDir,
    migratedFiles: [],
  };
}
