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

import { existsSync, readFileSync, realpathSync } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';

/**
 * Default state root directory (outside repo)
 * Uses XDG_STATE_HOME or falls back to ~/.local/state/personal-agent
 */
export function getDefaultStateRoot(): string {
  const xdgStateHome = process.env.XDG_STATE_HOME;
  if (xdgStateHome) {
    return join(xdgStateHome, 'personal-agent');
  }
  return join(homedir(), '.local', 'state', 'personal-agent');
}

function expandHomePath(pathValue: string): string {
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
export function getStateRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_STATE_ROOT;
  return explicit && explicit.trim().length > 0
    ? expandHomePath(explicit.trim())
    : getDefaultStateRoot();
}

export function getPiAgentStateDir(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'pi-agent');
}

export function getPiAgentRuntimeDir(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'pi-agent-runtime');
}

/**
 * Default config root directory.
 *
 * The canonical config home now lives under the runtime state root so mutable
 * application state is colocated under a single home.
 */
export function getDefaultConfigRoot(): string {
  return join(getStateRoot(), 'config');
}

/**
 * Get the configured config root directory.
 */
export function getConfigRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_CONFIG_ROOT;
  return explicit && explicit.trim().length > 0
    ? expandHomePath(explicit.trim())
    : getDefaultConfigRoot();
}

function getMachineConfigFilePathForRuntimePaths(): string {
  const explicit = process.env.PERSONAL_AGENT_CONFIG_FILE;
  if (explicit && explicit.trim().length > 0) {
    return resolve(expandHomePath(explicit.trim()));
  }

  return join(resolve(getConfigRoot()), 'config.json');
}

function readConfiguredVaultRootFromMachineConfig(): string | undefined {
  const filePath = getMachineConfigFilePathForRuntimePaths();
  if (!existsSync(filePath)) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return undefined;
    }

    const configured = (parsed as { vaultRoot?: unknown }).vaultRoot;
    if (typeof configured !== 'string' || configured.trim().length === 0) {
      return undefined;
    }

    return expandHomePath(configured.trim());
  } catch {
    return undefined;
  }
}

/**
 * Default durable knowledge vault root directory.
 *
 * When no explicit vault root is configured, prefer ~/Documents/personal-agent
 * for normal interactive use. Fall back to the managed sync root for legacy
 * installs and test environments that override PERSONAL_AGENT_STATE_ROOT.
 */
export function getDefaultVaultRoot(): string {
  if (process.env.PERSONAL_AGENT_STATE_ROOT?.trim()) {
    return getSyncRoot();
  }

  const documentsVault = join(homedir(), 'Documents', 'personal-agent');
  return existsSync(documentsVault) ? documentsVault : getSyncRoot();
}

/**
 * Get the configured durable knowledge vault root directory.
 */
export function getVaultRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_VAULT_ROOT;
  if (explicit && explicit.trim().length > 0) {
    return expandHomePath(explicit.trim());
  }

  const configured = readConfiguredVaultRootFromMachineConfig();
  return configured ?? getDefaultVaultRoot();
}

/**
 * Default mutable profiles root directory.
 */
export function getDefaultProfilesRoot(): string {
  return getDurableProfilesDir();
}

/**
 * Get the configured mutable profiles root directory.
 */
export function getProfilesRoot(): string {
  const explicit = process.env.PERSONAL_AGENT_PROFILES_ROOT;
  return explicit && explicit.trim().length > 0
    ? expandHomePath(explicit.trim())
    : getDefaultProfilesRoot();
}

/**
 * Root directory for git-backed synced durable state.
 */
export function getSyncRoot(stateRoot: string = getStateRoot()): string {
  return join(stateRoot, 'sync');
}

export function getDurablePiAgentDir(stateRoot: string = getStateRoot()): string {
  return join(getSyncRoot(stateRoot), 'pi-agent');
}

export function getDurableSessionsDir(stateRoot: string = getStateRoot()): string {
  return join(getDurablePiAgentDir(stateRoot), 'sessions');
}

export function getDurableConversationAttentionDir(stateRoot: string = getStateRoot()): string {
  return join(getDurablePiAgentDir(stateRoot), 'state', 'conversation-attention');
}

function resolveDurableDir(syncRoot: string, canonicalName: string, legacyName?: string): string {
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

export function getDurableProfilesDir(vaultRoot: string = getVaultRoot()): string {
  return resolveDurableDir(vaultRoot, '_profiles', 'profiles');
}

export function getDurableProfileDir(profile: string, vaultRoot: string = getVaultRoot()): string {
  return join(getDurableProfilesDir(vaultRoot), profile);
}

export function getDurableProfileAgentFilePath(profile: string, vaultRoot: string = getVaultRoot()): string {
  return join(getDurableProfileDir(profile, vaultRoot), 'AGENTS.md');
}

export function getDurableProfileSettingsFilePath(profile: string, vaultRoot: string = getVaultRoot()): string {
  return join(getDurableProfileDir(profile, vaultRoot), 'settings.json');
}

export function getDurableProfileModelsFilePath(profile: string, vaultRoot: string = getVaultRoot()): string {
  return join(getDurableProfileDir(profile, vaultRoot), 'models.json');
}

export function getDurableSettingsDir(vaultRoot: string = getVaultRoot()): string {
  return join(vaultRoot, 'settings');
}

export function getDurableModelsDir(vaultRoot: string = getVaultRoot()): string {
  return join(vaultRoot, 'models');
}

export function getDurableSkillsDir(vaultRoot: string = getVaultRoot()): string {
  return resolveDurableDir(vaultRoot, '_skills', 'skills');
}

export function getDurableNodesDir(vaultRoot: string = getVaultRoot()): string {
  return join(vaultRoot, 'nodes');
}

export function getDurableNotesDir(vaultRoot: string = getVaultRoot()): string {
  return join(vaultRoot, 'notes');
}

export function getDurableMemoryDir(vaultRoot: string = getVaultRoot()): string {
  return getDurableNotesDir(vaultRoot);
}

export function getDurableTasksDir(syncRoot: string = getSyncRoot()): string {
  return resolveDurableDir(syncRoot, '_tasks', 'tasks');
}

export function getDurableProjectsDir(vaultRoot: string = getVaultRoot()): string {
  return join(vaultRoot, 'projects');
}

/**
 * Default local overlay directory.
 */
export function getDefaultLocalProfileDir(): string {
  return join(getConfigRoot(), 'local');
}

/**
 * Get the configured local overlay directory.
 */
export function getLocalProfileDir(): string {
  const explicit = process.env.PERSONAL_AGENT_LOCAL_PROFILE_DIR;
  return explicit && explicit.trim().length > 0
    ? expandHomePath(explicit.trim())
    : getDefaultLocalProfileDir();
}

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
export function resolveStatePaths(): RuntimeStatePaths {
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
function canonicalizePath(path: string): string {
  const absolutePath = resolve(path);

  if (existsSync(absolutePath)) {
    try {
      return realpathSync(absolutePath);
    } catch {
      return absolutePath;
    }
  }

  const missingSegments: string[] = [];
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

export function isPathInRepo(targetPath: string, repoRoot: string = process.cwd()): boolean {
  const normalizedTarget = canonicalizePath(targetPath).replace(/\\/g, '/').replace(/\/$/, '');
  const normalizedRepo = canonicalizePath(repoRoot).replace(/\\/g, '/').replace(/\/$/, '');

  return normalizedTarget === normalizedRepo || normalizedTarget.startsWith(`${normalizedRepo}/`);
}

/**
 * Validate that state paths are outside the repository
 * Throws if any path would store mutable state in managed repo files
 */
export function validateStatePathsOutsideRepo(
  paths: RuntimeStatePaths,
  repoRoot: string = process.cwd()
): void {
  const violations: string[] = [];

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
      `PERSONAL_AGENT_SESSION_PATH, PERSONAL_AGENT_CACHE_PATH`
    );
  }
}
