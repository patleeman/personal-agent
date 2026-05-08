export { emitKBEvent, onKBEvent } from '../../../../../extensions/system-knowledge/src/components/knowledgeEvents';
export { VaultEditor } from '../../../../../extensions/system-knowledge/src/components/VaultEditor';
export { VaultFileTree } from '../../../../../extensions/system-knowledge/src/components/VaultFileTree';
export { knowledgeApi } from '../../../../../extensions/system-knowledge/src/lib/knowledgeApi';
export { getKnowledgeBaseSyncPresentation } from '../../../../../extensions/system-knowledge/src/lib/knowledgeBaseSyncStatus';
export { navigateKnowledgeFile } from '../../../../../extensions/system-knowledge/src/lib/knowledgeNavigation';
export { stripMarkdownFrontmatter } from '../../../../../extensions/system-knowledge/src/lib/markdownDocument';
export { buildMentionLookup, renderChildrenWithMentionLinks } from '../../../../../extensions/system-knowledge/src/lib/mentionRendering';
export type { NodeMentionSurface } from '../../../../../extensions/system-knowledge/src/lib/nodeMentionRoutes';
export { type ParsedSkillBlock, parseSkillBlock } from '../../../../../extensions/system-knowledge/src/lib/skillBlock';
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
