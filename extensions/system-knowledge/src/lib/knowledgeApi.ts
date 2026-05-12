import {
  api,
  type KnowledgeBaseState,
  type VaultBacklinksResult,
  type VaultEntry,
  type VaultFileContent,
  type VaultFileListResult,
  type VaultImageUploadResult,
  type VaultSearchResponse,
  type VaultShareImportResult,
  type VaultTreeResult,
} from '@personal-agent/extensions/data';

const EXTENSION_ID = 'system-knowledge';
const KNOWLEDGE_ACTION_TIMEOUT_MS = 15_000;

async function invoke<T>(actionId: string, input: unknown = {}): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Knowledge action '${actionId}' timed out after ${KNOWLEDGE_ACTION_TIMEOUT_MS / 1000}s`));
    }, KNOWLEDGE_ACTION_TIMEOUT_MS);
  });

  try {
    const response = await Promise.race([api.invokeExtensionAction(EXTENSION_ID, actionId, input), timeout]);
    return response.result as T;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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
  deleteFile: (id: string) => invoke<{ ok: boolean }>('vaultDeleteFile', { id }),
  rename: (id: string, newName: string) => invoke<VaultEntry>('vaultRename', { id, newName }),
  move: (id: string, targetDir: string) => invoke<VaultEntry>('vaultMove', { id, targetDir }),
  backlinks: (id: string) => invoke<VaultBacklinksResult>('vaultBacklinks', { id }),
  search: (q: string, limit = 20) => invoke<VaultSearchResponse>('vaultSearch', { q, limit }),
  uploadImage: (filename: string, dataUrl: string) => invoke<VaultImageUploadResult>('vaultUploadImage', { filename, dataUrl }),
  importUrl: (input: { url: string; title?: string; directoryId?: string; sourceApp?: string }) =>
    invoke<VaultShareImportResult>('vaultImportUrl', input),
  assetUrl: (id: string) => `/api/vault/asset?id=${encodeURIComponent(id)}`,
};
