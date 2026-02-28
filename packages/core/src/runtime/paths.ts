/**
 * Runtime state path resolution
 * 
 * Provides canonical writable paths for auth data, session data, and cache data.
 * All paths are rooted outside managed repository files by default.
 * 
 * Environment variables for override:
 * - PERSONAL_AGENT_STATE_ROOT: Override the base state directory
 * - PERSONAL_AGENT_AUTH_PATH: Override auth directory
 * - PERSONAL_AGENT_SESSION_PATH: Override session directory
 * - PERSONAL_AGENT_CACHE_PATH: Override cache directory
 */

import { existsSync, realpathSync } from 'fs';
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

/**
 * Get the configured state root directory
 */
export function getStateRoot(): string {
  return process.env.PERSONAL_AGENT_STATE_ROOT ?? getDefaultStateRoot();
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
