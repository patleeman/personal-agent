/**
 * Runtime state path resolution
 *
 * Provides canonical writable paths for auth data, session data, and cache data.
 * All paths are rooted outside managed repository files by default.
 *
 * Environment variables for override:
 * - PERSONAL_AGENT_STATE_ROOT: Override the base state directory
 * - PERSONAL_AGENT_VAULT_ROOT: Override the durable knowledge vault root
 * - PERSONAL_AGENT_AUTH_PATH: Override auth directory
 * - PERSONAL_AGENT_SESSION_PATH: Override session directory
 * - PERSONAL_AGENT_CACHE_PATH: Override cache directory
 */
/**
 * Default state root directory (outside repo)
 * Uses XDG_STATE_HOME or falls back to ~/.local/state/personal-agent
 */
export declare function getDefaultStateRoot(): string;
/**
 * Get the configured state root directory
 */
export declare function getStateRoot(): string;
export declare function getPiAgentStateDir(stateRoot?: string): string;
export declare function getPiAgentRuntimeDir(stateRoot?: string): string;
export declare function resolveNeutralChatCwd(profile: string, stateRoot?: string): string;
/**
 * Default config root directory.
 *
 * The canonical config home now lives under the runtime state root so mutable
 * application state is colocated under a single home.
 */
export declare function getDefaultConfigRoot(): string;
/**
 * Get the configured config root directory.
 */
export declare function getConfigRoot(): string;
/**
 * Default durable knowledge vault root directory.
 *
 * Durable notes, projects, and skills live in the external vault by default.
 * Mutable profile config lives separately under machine-local config.
 */
export declare function getDefaultVaultRoot(): string;
export declare function getKnowledgeBaseStateDir(stateRoot?: string): string;
export declare function getManagedKnowledgeBaseRoot(stateRoot?: string): string;
/**
 * Get the configured durable knowledge vault root directory.
 */
export declare function getVaultRoot(): string;
/**
 * Default mutable profiles root directory.
 *
 * Profiles are machine-local config now. They no longer live under the shared
 * vault by default.
 */
export declare function getDefaultProfilesRoot(): string;
/**
 * Get the configured mutable profiles root directory.
 */
export declare function getProfilesRoot(): string;
/**
 * Root directory for git-backed synced durable state.
 */
export declare function getSyncRoot(stateRoot?: string): string;
export declare function getDurablePiAgentDir(stateRoot?: string): string;
export declare function getDurableSessionsDir(stateRoot?: string): string;
export declare function getDurableConversationAttentionDir(stateRoot?: string): string;
export declare function getDurableProfilesDir(configRoot?: string): string;
export declare function getDurableAgentFilePath(vaultRoot?: string): string;
export declare function getDurableProfileDir(profile: string, profilesRoot?: string): string;
export declare function getDurableProfileSettingsFilePath(profile: string, profilesRoot?: string): string;
export declare function getDurableProfileModelsFilePath(profile: string, profilesRoot?: string): string;
export declare function getDurableSettingsDir(vaultRoot?: string): string;
export declare function getDurableModelsDir(vaultRoot?: string): string;
export declare function getDurableSkillsDir(vaultRoot?: string): string;
export declare function getDurableNodesDir(vaultRoot?: string): string;
export declare function getDurableNotesDir(vaultRoot?: string): string;
export declare function getDurableMemoryDir(vaultRoot?: string): string;
export declare function getDurableTasksDir(syncRoot?: string): string;
export declare function getDurableProjectsDir(vaultRoot?: string): string;
/**
 * Default local overlay directory.
 */
export declare function getDefaultLocalProfileDir(): string;
/**
 * Get the configured local overlay directory.
 */
export declare function getLocalProfileDir(): string;
/**
 * Runtime state paths configuration
 */
export interface RuntimeStatePaths {
    /** Base state directory */
    root: string;
    /** Auth data directory (tokens, credentials) */
    auth: string;
    /** Session data directory (active sessions, state) */
    session: string;
    /** Cache directory (temporary computed data) */
    cache: string;
}
/**
 * Resolve runtime state paths
 * Returns canonical paths for auth, session, and cache data
 */
export declare function resolveStatePaths(): RuntimeStatePaths;
export declare function isPathInRepo(targetPath: string, repoRoot?: string): boolean;
/**
 * Validate that state paths are outside the repository
 * Throws if any path would store mutable state in managed repo files
 */
export declare function validateStatePathsOutsideRepo(paths: RuntimeStatePaths, repoRoot?: string): void;
