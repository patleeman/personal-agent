export { buildApiPath } from '../client/apiBase';
export { CheckpointInlineDiff } from '../components/chat/CheckpointInlineDiff';
export { ContextMenuWrapper } from '../components/shared/ContextMenuWrapper';
export { canDropAllPaths, getTopLevelDraggedPaths, useFileTreeModel } from '../components/shared/useFileTreeModel';
export {
  AppPageEmptyState,
  AppPageIntro,
  AppPageLayout,
  AppPageSection,
  AppPageToc,
  cx,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Pill,
  SurfacePanel,
  ToolbarButton,
} from '../components/ui';
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
export { lazyRouteWithRecovery } from '../navigation/lazyRouteRecovery';
export type { ExtensionSurfaceProps } from './types';
