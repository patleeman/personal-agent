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
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';
/**
 * Default state root directory (outside repo)
 * Uses XDG_STATE_HOME or falls back to ~/.local/state/personal-agent
 */
export function getDefaultStateRoot() {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, 'personal-agent');
  }
  return join(homedir(), '.local', 'state', 'personal-agent');
}
function expandHomePath(pathValue) {
  if (pathValue === '~') {
    return homedir();
  }
  if (pathValue.startsWith('~/')) {
    return join(homedir(), pathValue.slice(2));
  }
  return pathValue;
}
/**
 * Get the configured state root directory
 */
export function getStateRoot() {
  const explicit = process.env.PERSONAL_AGENT_STATE_ROOT;
  return explicit && explicit.trim().length > 0 ? expandHomePath(explicit.trim()) : getDefaultStateRoot();
}
export function getPiAgentStateDir(stateRoot = getStateRoot()) {
  return join(stateRoot, 'pi-agent');
}
export function getPiAgentRuntimeDir(stateRoot = getStateRoot()) {
  return join(stateRoot, 'pi-agent-runtime');
}
export function resolveNeutralChatCwd(profile, stateRoot = getStateRoot()) {
  const safeProfile = profile.trim().replace(/[^a-zA-Z0-9._-]+/g, '-') || 'default';
  const cwd = join(getPiAgentRuntimeDir(stateRoot), 'chat-workspaces', safeProfile);
  mkdirSync(cwd, { recursive: true });
  return cwd;
}
/**
 * Default config root directory.
 *
 * The canonical config home now lives under the runtime state root so mutable
 * application state is colocated under a single home.
 */
export function getDefaultConfigRoot() {
  return join(getStateRoot(), 'config');
}
/**
 * Get the configured config root directory.
 */
export function getConfigRoot() {
  const explicit = process.env.PERSONAL_AGENT_CONFIG_ROOT;
  return explicit && explicit.trim().length > 0 ? expandHomePath(explicit.trim()) : getDefaultConfigRoot();
}
function getMachineConfigFilePathForRuntimePaths() {
  const explicit = process.env.PERSONAL_AGENT_CONFIG_FILE;
  if (explicit && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }
  return join(resolve(getConfigRoot()), 'config.json');
}
function readMachineConfigRuntimeOverrides() {
  const filePath = getMachineConfigFilePathForRuntimePaths();
  if (!existsSync(filePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const record = parsed;
    const vaultRoot =
      typeof record.vaultRoot === 'string' && record.vaultRoot.trim().length > 0 ? expandHomePath(record.vaultRoot.trim()) : undefined;
    const knowledgeBaseRepoUrl =
      typeof record.knowledgeBaseRepoUrl === 'string' && record.knowledgeBaseRepoUrl.trim().length > 0
        ? record.knowledgeBaseRepoUrl.trim()
        : undefined;
    return {
      ...(vaultRoot ? { vaultRoot } : {}),
      ...(knowledgeBaseRepoUrl ? { knowledgeBaseRepoUrl } : {}),
    };
  } catch {
    return {};
  }
}
/**
 * Default durable knowledge vault root directory.
 *
 * Durable notes, projects, and skills live in the external vault by default.
 * Mutable profile config lives separately under machine-local config.
 */
export function getDefaultVaultRoot() {
  return join(homedir(), 'Documents', 'personal-agent');
}
export function getKnowledgeBaseStateDir(stateRoot = getStateRoot()) {
  return join(stateRoot, 'knowledge-base');
}
export function getManagedKnowledgeBaseRoot(stateRoot = getStateRoot()) {
  return join(getKnowledgeBaseStateDir(stateRoot), 'repo');
}
/**
 * Get the configured durable knowledge vault root directory.
 */
export function getVaultRoot() {
  const explicit = process.env.PERSONAL_AGENT_VAULT_ROOT;
  if (explicit && explicit.trim().length > 0) {
    return expandHomePath(explicit.trim());
  }
  const configured = readMachineConfigRuntimeOverrides();
  if (configured.knowledgeBaseRepoUrl) {
    return getManagedKnowledgeBaseRoot();
  }
  return configured.vaultRoot ?? getDefaultVaultRoot();
}
/**
 * Default mutable profiles root directory.
 *
 * Profiles are machine-local config now. They no longer live under the shared
 * vault by default.
 */
export function getDefaultProfilesRoot() {
  return getDurableProfilesDir();
}
/**
 * Get the configured mutable profiles root directory.
 */
export function getProfilesRoot() {
  const explicit = process.env.PERSONAL_AGENT_PROFILES_ROOT;
  return explicit && explicit.trim().length > 0 ? expandHomePath(explicit.trim()) : getDefaultProfilesRoot();
}
/**
 * Root directory for git-backed synced durable state.
 */
export function getSyncRoot(stateRoot = getStateRoot()) {
  return join(stateRoot, 'sync');
}
export function getDurablePiAgentDir(stateRoot = getStateRoot()) {
  return join(getSyncRoot(stateRoot), 'pi-agent');
}
export function getDurableSessionsDir(stateRoot = getStateRoot()) {
  return join(getDurablePiAgentDir(stateRoot), 'sessions');
}
export function getDurableConversationAttentionDir(stateRoot = getStateRoot()) {
  return join(getDurablePiAgentDir(stateRoot), 'state', 'conversation-attention');
}
function resolveDurableDir(syncRoot, canonicalName, legacyName) {
  const canonicalPath = join(syncRoot, canonicalName);
  if (existsSync(canonicalPath)) {
    return canonicalPath;
  }
  if (legacyName) {
    const legacyPath = join(syncRoot, legacyName);
    if (existsSync(legacyPath)) {
      return legacyPath;
    }
  }
  return canonicalPath;
}
export function getDurableProfilesDir(configRoot = getConfigRoot()) {
  return join(configRoot, 'profiles');
}
export function getDurableAgentFilePath(vaultRoot = getVaultRoot()) {
  return join(vaultRoot, 'AGENTS.md');
}
export function getDurableProfileDir(profile, profilesRoot = getDurableProfilesDir()) {
  return join(profilesRoot, profile);
}
export function getDurableProfileSettingsFilePath(profile, profilesRoot = getDurableProfilesDir()) {
  return join(getDurableProfileDir(profile, profilesRoot), 'settings.json');
}
export function getDurableProfileModelsFilePath(profile, profilesRoot = getDurableProfilesDir()) {
  return join(getDurableProfileDir(profile, profilesRoot), 'models.json');
}
export function getDurableSettingsDir(vaultRoot = getVaultRoot()) {
  return join(vaultRoot, 'settings');
}
export function getDurableModelsDir(vaultRoot = getVaultRoot()) {
  return join(vaultRoot, 'models');
}
export function getDurableSkillsDir(vaultRoot = getVaultRoot()) {
  return resolveDurableDir(vaultRoot, 'skills', '_skills');
}
export function getDurableNodesDir(vaultRoot = getVaultRoot()) {
  return join(vaultRoot, 'nodes');
}
export function getDurableNotesDir(vaultRoot = getVaultRoot()) {
  return join(vaultRoot, 'notes');
}
export function getDurableMemoryDir(vaultRoot = getVaultRoot()) {
  return getDurableNotesDir(vaultRoot);
}
export function getDurableTasksDir(syncRoot = getSyncRoot()) {
  return resolveDurableDir(syncRoot, 'tasks', '_tasks');
}
export function getDurableProjectsDir(vaultRoot = getVaultRoot()) {
  return join(vaultRoot, 'projects');
}
/**
 * Default local overlay directory.
 */
export function getDefaultLocalProfileDir() {
  return join(getConfigRoot(), 'local');
}
/**
 * Get the configured local overlay directory.
 */
export function getLocalProfileDir() {
  const explicit = process.env.PERSONAL_AGENT_LOCAL_PROFILE_DIR;
  return explicit && explicit.trim().length > 0 ? expandHomePath(explicit.trim()) : getDefaultLocalProfileDir();
}
/**
 * Resolve runtime state paths
 * Returns canonical paths for auth, session, and cache data
 */
export function resolveStatePaths() {
  const root = getStateRoot();
  return {
    root,
    auth: process.env.PERSONAL_AGENT_AUTH_PATH ?? join(root, 'auth'),
    session: process.env.PERSONAL_AGENT_SESSION_PATH ?? join(root, 'session'),
    cache: process.env.PERSONAL_AGENT_CACHE_PATH ?? join(root, 'cache'),
  };
}
/**
 * Check if a path is within the repository
 * Used to prevent accidental state storage in managed files
 */
function canonicalizePath(path) {
  const absolutePath = resolve(path);
  if (existsSync(absolutePath)) {
    try {
      return realpathSync(absolutePath);
    } catch {
      return absolutePath;
    }
  }
  const missingSegments = [];
  let current = absolutePath;
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return absolutePath;
    }
    missingSegments.unshift(basename(current));
    current = parent;
  }
  let canonicalBase = current;
  try {
    canonicalBase = realpathSync(current);
  } catch {
    // Keep non-canonical existing base when realpath resolution fails.
  }
  return missingSegments.reduce((acc, segment) => join(acc, segment), canonicalBase);
}
export function isPathInRepo(targetPath, repoRoot = process.cwd()) {
  const normalizedTarget = canonicalizePath(targetPath).replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedRepo = canonicalizePath(repoRoot).replace(/\\/g, '/').replace(/\/$/, '');
  return normalizedTarget === normalizedRepo || normalizedTarget.startsWith(`${normalizedRepo}/`);
}
/**
 * Validate that state paths are outside the repository
 * Throws if any path would store mutable state in managed repo files
 */
export function validateStatePathsOutsideRepo(paths, repoRoot = process.cwd()) {
  const violations = [];
  if (isPathInRepo(paths.root, repoRoot)) {
    violations.push(`State root "${paths.root}" is inside repository`);
  }
  if (isPathInRepo(paths.auth, repoRoot)) {
    violations.push(`Auth path "${paths.auth}" is inside repository`);
  }
  if (isPathInRepo(paths.session, repoRoot)) {
    violations.push(`Session path "${paths.session}" is inside repository`);
  }
  if (isPathInRepo(paths.cache, repoRoot)) {
    violations.push(`Cache path "${paths.cache}" is inside repository`);
  }
  if (violations.length > 0) {
    throw new Error(
      `Runtime state paths must be outside repository:\n${violations.join('\n')}\n\n` +
        `Set PERSONAL_AGENT_STATE_ROOT to a directory outside the repo, or ` +
        `configure individual paths via PERSONAL_AGENT_AUTH_PATH, ` +
        `PERSONAL_AGENT_SESSION_PATH, PERSONAL_AGENT_CACHE_PATH`,
    );
  }
}
