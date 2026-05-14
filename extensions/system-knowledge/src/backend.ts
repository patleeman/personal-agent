import { readKnowledgeState, syncKnowledgeState, updateKnowledgeState } from '@personal-agent/extensions/backend/knowledge';
import { knowledgeVault } from '@personal-agent/extensions/backend/knowledgeVault';

export async function readState() {
  return readKnowledgeState();
}

export async function updateState(input: { repoUrl?: string | null; branch?: string | null }) {
  return updateKnowledgeState(input);
}

export async function sync() {
  return syncKnowledgeState();
}

export async function vaultListFiles() {
  return knowledgeVault.listFiles();
}

export async function vaultTree(input: { dir?: string }) {
  return knowledgeVault.tree(input);
}

export async function vaultReadFile(input: { id: string }) {
  return knowledgeVault.readFile(input);
}

export async function vaultWriteFile(input: { id: string; content: string }) {
  return knowledgeVault.writeFile(input);
}

export async function vaultCreateFolder(input: { id: string }) {
  return knowledgeVault.createFolder(input);
}

export async function vaultDeleteFile(input: { id: string }) {
  return knowledgeVault.deleteFile(input);
}

export async function vaultRename(input: { id: string; newName: string }) {
  return knowledgeVault.rename(input);
}

export async function vaultMove(input: { id: string; targetDir: string }) {
  return knowledgeVault.move(input);
}

export async function vaultBacklinks(input: { id: string }) {
  return knowledgeVault.backlinks(input);
}

export async function vaultSearch(input: { q: string; limit?: number }) {
  return knowledgeVault.search(input);
}

export async function vaultUploadImage(input: { filename: string; dataUrl: string }) {
  return knowledgeVault.uploadImage(input);
}

export async function vaultImportUrl(input: { url: string; title?: string; directoryId?: string; sourceApp?: string }) {
  return knowledgeVault.importUrl(input);
}

export async function resolvePromptReferences(input: { text: string }) {
  return knowledgeVault.resolvePromptReferences(input);
}
