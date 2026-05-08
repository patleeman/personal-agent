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
} from '@personal-agent/extensions/knowledge';
import { api, vaultApi } from '@personal-agent/extensions/knowledge';

const EXTENSION_ID = 'system-knowledge';

async function invoke<T>(actionId: string, input: unknown = {}): Promise<T> {
  const response = await api.invokeExtensionAction(EXTENSION_ID, actionId, input);
  return response.result as T;
}

export const knowledgeApi = {
  state: () => invoke<KnowledgeBaseState>('readState'),
  updateState: (input: { repoUrl?: string | null; branch?: string | null }) => invoke<KnowledgeBaseState>('updateState', input),
  sync: () => invoke<KnowledgeBaseState>('sync'),
  listFiles: () => invoke<VaultFileListResult>('vaultListFiles'),
  tree: (dir?: string) => invoke<VaultTreeResult>('vaultTree', dir ? { dir } : {}),
  readFile: (id: string) => invoke<VaultFileContent>('vaultReadFile', { id }),
  writeFile: (id: string, content: string) => invoke<VaultEntry>('vaultWriteFile', { id, content }),
  createFolder: (id: string) => invoke<VaultEntry>('vaultCreateFolder', { id }),
  rename: (id: string, newName: string) => invoke<VaultEntry>('vaultRename', { id, newName }),
  move: (id: string, targetDir: string) => invoke<VaultEntry>('vaultMove', { id, targetDir }),
  backlinks: (id: string) => invoke<VaultBacklinksResult>('vaultBacklinks', { id }),
  search: (q: string, limit = 20) => invoke<VaultSearchResponse>('vaultSearch', { q, limit }),
  uploadImage: (filename: string, dataUrl: string) => invoke<VaultImageUploadResult>('vaultUploadImage', { filename, dataUrl }),
  importUrl: (input: { url: string; title?: string; directoryId?: string; sourceApp?: string }) =>
    invoke<VaultShareImportResult>('vaultImportUrl', input),
  assetUrl: vaultApi.assetUrl,
};
