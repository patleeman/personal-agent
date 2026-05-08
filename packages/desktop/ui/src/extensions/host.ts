export { SettingsPage } from '../../../../../extensions/system-settings/src/SettingsPage';
export { api } from '../client/api';
export { VaultEditor } from '../components/knowledge/VaultEditor';
export { VaultFileTree } from '../components/knowledge/VaultFileTree';
export { AppPageIntro, AppPageLayout, AppPageSection, AppPageToc, cx, Pill, ToolbarButton } from '../components/ui';
export { WorkbenchBrowserTab } from '../components/workbench/WorkbenchBrowserTab';
export { WorkspaceExplorer, WorkspaceFileDocument } from '../components/workspace/WorkspaceExplorer';
export { formatContextWindowLabel, formatThinkingLevelLabel } from '../conversation/conversationHeader';
export type { MentionItem } from '../conversation/conversationMentions';
export { getDesktopBridge, isDesktopShell, readDesktopConnections, readDesktopEnvironment } from '../desktop/desktopBridge';
export { createDesktopAwareEventSource } from '../desktop/desktopEventSource';
export { subscribeDesktopProviderOAuthLogin } from '../desktop/desktopProviderOAuth';
export { useApi } from '../hooks/useApi';
export { useInvalidateOnTopics } from '../hooks/useInvalidateOnTopics';
export { getKnowledgeBaseSyncPresentation } from '../knowledge/knowledgeBaseSyncStatus';
export { navigateKnowledgeFile } from '../knowledge/knowledgeNavigation';
export { resetStoredConversationUiState, resetStoredLayoutPreferences } from '../local/localSettings';
export {
  type BrowserTabsState,
  createNewTab,
  getAdjacentTabId,
  getTabSessionKey,
  readBrowserTabsState,
  writeBrowserTabsState,
} from '../local/workbenchBrowserTabs';
export { getModelSelectableServiceTierOptions, groupModelsByProvider, THINKING_LEVEL_OPTIONS } from '../model/modelPreferences';
export {
  createModelEditorDraft,
  createProviderEditorDraft,
  type ModelEditorDraft,
  parseOptionalJsonObject,
  parseOptionalNonNegativeNumber,
  parseOptionalPositiveInteger,
  parseOptionalStringRecord,
  type ProviderEditorDraft,
} from '../model/modelProviderEditorDrafts';
export { lazyRouteWithRecovery } from '../navigation/lazyRouteRecovery';
export type {
  DesktopAppPreferencesState,
  DesktopConnectionsState,
  DesktopEnvironmentState,
  DesktopHostRecord,
  DesktopSshConnectionTestResult,
  McpServerConfig,
  MemoryDocItem,
  ModelProviderApi,
  ModelProviderConfig,
  ModelProviderModelConfig,
  ModelProviderState,
  ModelState,
  ProviderAuthSummary,
  ProviderOAuthLoginState,
  ProviderOAuthLoginStreamEvent,
  TranscriptionModelStatus,
  TranscriptionProviderId,
  VaultFileSummary,
} from '../shared/types';
export { type ThemePreference, useTheme } from '../ui-state/theme';
export type { ExtensionSurfaceProps } from './types';
