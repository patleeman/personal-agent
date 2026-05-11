/**
 * Runtime state management
 *
 * Provides path resolution and bootstrap validation for mutable
 * runtime state (auth, sessions, cache) outside managed repo files.
 */
export { getConfigRoot, getDefaultConfigRoot, getDefaultLocalProfileDir, getDefaultProfilesRoot, getDefaultStateRoot, getDefaultVaultRoot, getDurableAgentFilePath, getDurableConversationAttentionDir, getDurableMemoryDir, getDurableModelsDir, getDurableNodesDir, getDurableNotesDir, getDurablePiAgentDir, getDurableProfileDir, getDurableProfileModelsFilePath, getDurableProfilesDir, getDurableProfileSettingsFilePath, getDurableProjectsDir, getDurableSessionsDir, getDurableSettingsDir, getDurableSkillsDir, getDurableTasksDir, getKnowledgeBaseStateDir, getLocalProfileDir, getManagedKnowledgeBaseRoot, getPiAgentRuntimeDir, getPiAgentStateDir, getProfilesRoot, getStateRoot, getSyncRoot, getVaultRoot, isPathInRepo, resolveNeutralChatCwd, resolveStatePaths, type RuntimeStatePaths, validateStatePathsOutsideRepo, } from './paths.js';
export { type BootstrapError, type BootstrapResult, bootstrapState, bootstrapStateOrThrow, canBootstrap } from './bootstrap.js';
export { preparePiAgentDir, type PreparePiAgentDirOptions, type PreparePiAgentDirResult } from './agent-dir.js';
