/**
 * Runtime state management
 * 
 * Provides path resolution and bootstrap validation for mutable
 * runtime state (auth, sessions, cache) outside managed repo files.
 */

// Path resolution
export {
  getDefaultStateRoot,
  getStateRoot,
  getPiAgentStateDir,
  getPiAgentRuntimeDir,
  getDefaultConfigRoot,
  getConfigRoot,
  getDefaultVaultRoot,
  getKnowledgeBaseStateDir,
  getManagedKnowledgeBaseRoot,
  getVaultRoot,
  getDefaultProfilesRoot,
  getProfilesRoot,
  getDefaultLocalProfileDir,
  getLocalProfileDir,
  getSyncRoot,
  getDurablePiAgentDir,
  getDurableSessionsDir,
  getDurableConversationAttentionDir,
  getDurableProfilesDir,
  getDurableAgentFilePath,
  getDurableProfileDir,
  getDurableProfileAgentFilePath,
  getDurableProfileSettingsFilePath,
  getDurableProfileModelsFilePath,
  getDurableSettingsDir,
  getDurableModelsDir,
  getDurableSkillsDir,
  getDurableNodesDir,
  getDurableNotesDir,
  getDurableMemoryDir,
  getDurableTasksDir,
  getDurableProjectsDir,
  resolveStatePaths,
  isPathInRepo,
  validateStatePathsOutsideRepo,
  type RuntimeStatePaths,
} from './paths.js';

// Bootstrap validation
export {
  bootstrapState,
  bootstrapStateOrThrow,
  canBootstrap,
  type BootstrapResult,
  type BootstrapError,
} from './bootstrap.js';

// Pi agent runtime directory
export {
  preparePiAgentDir,
  type PreparePiAgentDirOptions,
  type PreparePiAgentDirResult,
} from './agent-dir.js';
