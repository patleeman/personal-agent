export {
  DesktopCompanionSettingsPanel,
  DesktopConnectionsSettingsPanel,
  DesktopKeyboardShortcutsSettingsSection,
  formatCompanionTimestamp,
  SettingsPage,
} from '../../../../../extensions/system-settings/src/SettingsPage';
export { api } from '../client/api';
export { AppPageIntro, AppPageLayout, AppPageSection, AppPageToc, cx, Pill, ToolbarButton } from '../components/ui';
export { formatContextWindowLabel, formatThinkingLevelLabel } from '../conversation/conversationHeader';
export { getDesktopBridge, isDesktopShell, readDesktopConnections, readDesktopEnvironment } from '../desktop/desktopBridge';
export { createDesktopAwareEventSource } from '../desktop/desktopEventSource';
export { subscribeDesktopProviderOAuthLogin } from '../desktop/desktopProviderOAuth';
export { useApi } from '../hooks/useApi';
export { useInvalidateOnTopics } from '../hooks/useInvalidateOnTopics';
export { resetStoredConversationUiState, resetStoredLayoutPreferences } from '../local/localSettings';
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
export type {
  DesktopAppPreferencesState,
  DesktopConnectionsState,
  DesktopEnvironmentState,
  DesktopHostRecord,
  DesktopSshConnectionTestResult,
  McpServerConfig,
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
} from '../shared/types';
export { type ColorTheme, type ThemePreference, useTheme } from '../ui-state/theme';
export { getKnowledgeBaseSyncPresentation } from './knowledge';
export type { ExtensionKeybindingRegistration } from './types';
