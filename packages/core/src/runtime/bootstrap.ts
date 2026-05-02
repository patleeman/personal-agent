/**
 * Bootstrap validation for runtime state
 *
 * Performs explicit writability and directory-creation checks
 * for resolved runtime state locations. Fails fast with clear
 * actionable errors when paths are invalid.
 */

import { access, constants, mkdir } from 'fs/promises';
import { dirname } from 'path';

import type { RuntimeStatePaths } from './paths.js';

/**
 * Bootstrap check result
 */
export interface BootstrapResult {
  success: boolean;
  errors: BootstrapError[];
}

/**
 * Bootstrap error with actionable message
 */
export interface BootstrapError {
  path: string;
  type: 'creation' | 'writable' | 'permission';
  message: string;
}

/**
 * Check if a directory is writable by attempting to access it
 */
async function isWritable(dirPath: string): Promise<boolean> {
  try {
    await access(dirPath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure a directory exists, creating it if necessary
 */
async function ensureDirectory(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true, mode: 0o700 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create directory "${dirPath}": ${message}`);
  }
}

/**
 * Validate a single state directory
 */
async function validateStateDirectory(dirPath: string, label: string): Promise<BootstrapError | null> {
  // Check if parent exists and is writable (for creation)
  const parentDir = dirname(dirPath);

  try {
    // Try to ensure the directory exists
    await ensureDirectory(dirPath);

    // Verify it's now writable
    if (!(await isWritable(dirPath))) {
      return {
        path: dirPath,
        type: 'writable',
        message: `${label} directory "${dirPath}" is not writable`,
      };
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Check if parent is writable (for diagnosis)
    try {
      await access(parentDir, constants.W_OK);
      return {
        path: dirPath,
        type: 'creation',
        message: `${label} directory "${dirPath}" could not be created: ${message}`,
      };
    } catch {
      return {
        path: dirPath,
        type: 'permission',
        message: `${label} directory "${dirPath}" cannot be created: parent "${parentDir}" is not writable`,
      };
    }
  }
}

/**
 * Bootstrap runtime state directories
 *
 * Creates directories if they don't exist and validates writability.
 * Returns detailed errors for each failed path.
 */
export async function bootstrapState(paths: RuntimeStatePaths): Promise<BootstrapResult> {
  const errors: BootstrapError[] = [];

  const results = await Promise.all([
    validateStateDirectory(paths.auth, 'Auth'),
    validateStateDirectory(paths.session, 'Session'),
    validateStateDirectory(paths.cache, 'Cache'),
  ]);

  for (const result of results) {
    if (result) {
      errors.push(result);
    }
  }

  return {
    success: errors.length === 0,
    errors,
  };
}

/**
 * Bootstrap with fatal error on failure
 *
 * Throws an error with actionable diagnostics if bootstrap fails.
 * Use this for early exit during application startup.
 */
export async function bootstrapStateOrThrow(paths: RuntimeStatePaths): Promise<void> {
  const result = await bootstrapState(paths);

  if (!result.success) {
    const errorMessages = result.errors.map((e) => `  - ${e.message}`).join('\n');
    const suggestions = generateSuggestions(result.errors);

    throw new Error(`Runtime state bootstrap failed:\n${errorMessages}\n\n` + `Suggestions:\n${suggestions}`);
  }
}

/**
 * Generate actionable suggestions based on error types
 */
function generateSuggestions(errors: BootstrapError[]): string {
  const suggestions: string[] = [];

  const hasPermissionErrors = errors.some((e) => e.type === 'permission');
  const hasCreationErrors = errors.some((e) => e.type === 'creation');

  if (hasPermissionErrors) {
    suggestions.push('  - Check directory permissions or run with appropriate privileges');
    suggestions.push('  - Set PERSONAL_AGENT_STATE_ROOT to a writable directory (e.g., /tmp/personal-agent for testing)');
  }

  if (hasCreationErrors) {
    suggestions.push('  - Ensure parent directories exist and are writable');
    suggestions.push('  - Check disk space and filesystem health');
  }

  suggestions.push('  - Override individual paths: PERSONAL_AGENT_AUTH_PATH, PERSONAL_AGENT_SESSION_PATH, PERSONAL_AGENT_CACHE_PATH');

  return suggestions.join('\n');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function canCreateOrWriteDirectory(path: string): Promise<boolean> {
  if (await pathExists(path)) {
    return isWritable(path);
  }

  let current = dirname(path);

  while (!(await pathExists(current))) {
    const parent = dirname(current);
    if (parent === current) {
      return false;
    }
    current = parent;
  }

  try {
    await access(current, constants.W_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Quick check if bootstrap would succeed (dry run)
 * Does not create directories, only checks if they could be created.
 */
export async function canBootstrap(paths: RuntimeStatePaths): Promise<boolean> {
  const checks = await Promise.all([
    canCreateOrWriteDirectory(paths.auth),
    canCreateOrWriteDirectory(paths.session),
    canCreateOrWriteDirectory(paths.cache),
  ]);

  return checks.every(Boolean);
}
