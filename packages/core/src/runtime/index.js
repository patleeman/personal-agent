/**
 * Runtime state management
 *
 * Provides path resolution and bootstrap validation for mutable
 * runtime state (auth, sessions, cache) outside managed repo files.
 */
// Path resolution
export {
  getConfigRoot,
  getDefaultConfigRoot,
  getDefaultLocalProfileDir,
  getDefaultProfilesRoot,
  getDefaultStateRoot,
  getDefaultVaultRoot,
  getDurableAgentFilePath,
  getDurableConversationAttentionDir,
  getDurableMemoryDir,
  getDurableModelsDir,
  getDurableNodesDir,
  getDurableNotesDir,
  getDurablePiAgentDir,
  getDurableProfileDir,
  getDurableProfileModelsFilePath,
  getDurableProfilesDir,
  getDurableProfileSettingsFilePath,
  getDurableProjectsDir,
  getDurableSessionsDir,
  getDurableSettingsDir,
  getDurableSkillsDir,
  getDurableTasksDir,
  getKnowledgeBaseStateDir,
  getLocalProfileDir,
  getManagedKnowledgeBaseRoot,
  getPiAgentRuntimeDir,
  getPiAgentStateDir,
  getProfilesRoot,
  getStateRoot,
  getSyncRoot,
  getVaultRoot,
  isPathInRepo,
  resolveNeutralChatCwd,
  resolveStatePaths,
  validateStatePathsOutsideRepo,
} from './paths.js';
// Bootstrap validation
export { bootstrapState, bootstrapStateOrThrow, canBootstrap } from './bootstrap.js';
// Pi agent runtime directory
export { preparePiAgentDir } from './agent-dir.js';
