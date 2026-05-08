import { api, vaultApi } from '../../../../packages/desktop/ui/src/client/api';
import type {
  KnowledgeBaseState,
  VaultBacklinksResult,
  VaultEntry,
  VaultFileContent,
  VaultFileListResult,
  VaultImageUploadResult,
  VaultSearchResponse,
  VaultShareImportResult,
  VaultTreeResult,
} from '../../../../packages/desktop/ui/src/shared/types';

const EXTENSION_ID = 'system-knowledge';

async function invoke<T>(actionId: string, input: unknown = {}, fallback?: () => Promise<T>): Promise<T> {
  if (!api.invokeExtensionAction && fallback) {
    return fallback();
  }
  const response = await api.invokeExtensionAction(EXTENSION_ID, actionId, input);
  return response.result as T;
}

export const knowledgeApi = {
  state: () => api.knowledgeBase(),
  updateState: (input: { repoUrl?: string | null; branch?: string | null }) => invoke<KnowledgeBaseState>('updateState', input),
  sync: () => invoke<KnowledgeBaseState>('sync', {}, () => api.syncKnowledgeBase()),
  listFiles: () => invoke<VaultFileListResult>('vaultListFiles', {}, () => api.vaultFiles()),
  tree: (dir?: string) => invoke<VaultTreeResult>('vaultTree', dir ? { dir } : {}),
  readFile: (id: string) => invoke<VaultFileContent>('vaultReadFile', { id }, () => vaultApi.readFile(id)),
  writeFile: (id: string, content: string) => invoke<VaultEntry>('vaultWriteFile', { id, content }, () => vaultApi.writeFile(id, content)),
  createFolder: (id: string) => invoke<VaultEntry>('vaultCreateFolder', { id }, () => vaultApi.createFolder(id)),
  rename: (id: string, newName: string) => invoke<VaultEntry>('vaultRename', { id, newName }, () => vaultApi.rename(id, newName)),
  move: (id: string, targetDir: string) => invoke<VaultEntry>('vaultMove', { id, targetDir }, () => vaultApi.move(id, targetDir)),
  backlinks: (id: string) => invoke<VaultBacklinksResult>('vaultBacklinks', { id }, () => vaultApi.backlinks(id)),
  search: (q: string, limit = 20) => invoke<VaultSearchResponse>('vaultSearch', { q, limit }, () => vaultApi.search(q, limit)),
  uploadImage: (filename: string, dataUrl: string) =>
    invoke<VaultImageUploadResult>('vaultUploadImage', { filename, dataUrl }, () => vaultApi.uploadImage(filename, dataUrl)),
  importUrl: (input: { url: string; title?: string; directoryId?: string; sourceApp?: string }) =>
    invoke<VaultShareImportResult>('vaultImportUrl', input, () => vaultApi.importUrl(input)),
  assetUrl: vaultApi.assetUrl,
};
