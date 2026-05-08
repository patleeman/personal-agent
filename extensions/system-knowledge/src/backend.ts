import { knowledgeVault, readKnowledgeState, syncKnowledgeState, updateKnowledgeState } from '@personal-agent/extensions/backend';

export function readState() {
  return readKnowledgeState();
}

export function updateState(input: { repoUrl?: string | null; branch?: string | null }) {
  return updateKnowledgeState(input);
}

export function sync() {
  return syncKnowledgeState();
}

export function vaultListFiles() {
  return knowledgeVault.listFiles();
}

export function vaultTree(input: { dir?: string }) {
  return knowledgeVault.tree(input);
}

export function vaultReadFile(input: { id: string }) {
  return knowledgeVault.readFile(input);
}

export function vaultWriteFile(input: { id: string; content: string }) {
  return knowledgeVault.writeFile(input);
}

export function vaultCreateFolder(input: { id: string }) {
  return knowledgeVault.createFolder(input);
}

export function vaultRename(input: { id: string; newName: string }) {
  return knowledgeVault.rename(input);
}

export function vaultMove(input: { id: string; targetDir: string }) {
  return knowledgeVault.move(input);
}

export function vaultBacklinks(input: { id: string }) {
  return knowledgeVault.backlinks(input);
}

export function vaultSearch(input: { q: string; limit?: number }) {
  return knowledgeVault.search(input);
}

export function vaultUploadImage(input: { filename: string; dataUrl: string }) {
  return knowledgeVault.uploadImage(input);
}

export function vaultImportUrl(input: { url: string; title?: string; directoryId?: string; sourceApp?: string }) {
  return knowledgeVault.importUrl(input);
}
