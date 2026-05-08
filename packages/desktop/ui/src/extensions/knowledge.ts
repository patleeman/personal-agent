export { api, vaultApi } from '../client/api';
export { buildApiPath } from '../client/apiBase';
export { ContextMenuWrapper } from '../components/shared/ContextMenuWrapper';
export { canDropAllPaths, getTopLevelDraggedPaths, useFileTreeModel } from '../components/shared/useFileTreeModel';
export { cx } from '../components/ui';
export type { MentionItem } from '../conversation/conversationMentions';
export { type DesktopKnowledgeEntryContextMenuAction, getDesktopBridge, shouldUseNativeAppContextMenus } from '../desktop/desktopBridge';
export { useApi } from '../hooks/useApi';
export { useInvalidateOnTopics } from '../hooks/useInvalidateOnTopics';
export {
  addOpenFileId,
  KNOWLEDGE_OPEN_FILE_IDS_STORAGE_KEY,
  normalizeOpenFileIds,
  readStoredOpenFileIds,
  removeOpenFileId,
  renameOpenFileIds,
  writeStoredOpenFileIds,
} from '../local/knowledgeOpenFiles';
export {
  readStoredRecentlyClosedFileIds,
  recordRecentlyClosedFileId,
  writeStoredRecentlyClosedFileIds,
} from '../local/knowledgeRecentlyClosedFiles';
export {
  collapseExpandedFolderIds,
  KNOWLEDGE_TREE_EXPANDED_FOLDERS_STORAGE_KEY,
  readStoredExpandedFolderIds,
  renameExpandedFolderIds,
  writeStoredExpandedFolderIds,
} from '../local/knowledgeTreeState';
export type {
  KnowledgeBaseState,
  VaultBacklink,
  VaultBacklinksResult,
  VaultEntry,
  VaultFileContent,
  VaultFileListResult,
  VaultImageUploadResult,
  VaultSearchResponse,
  VaultShareImportResult,
  VaultTreeResult,
} from '../shared/types';
