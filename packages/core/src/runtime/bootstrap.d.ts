/**
 * Bootstrap validation for runtime state
 *
 * Performs explicit writability and directory-creation checks
 * for resolved runtime state locations. Fails fast with clear
 * actionable errors when paths are invalid.
 */
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
 * Bootstrap runtime state directories
 *
 * Creates directories if they don't exist and validates writability.
 * Returns detailed errors for each failed path.
 */
export declare function bootstrapState(paths: RuntimeStatePaths): Promise<BootstrapResult>;
/**
 * Bootstrap with fatal error on failure
 *
 * Throws an error with actionable diagnostics if bootstrap fails.
 * Use this for early exit during application startup.
 */
export declare function bootstrapStateOrThrow(paths: RuntimeStatePaths): Promise<void>;
/**
 * Quick check if bootstrap would succeed (dry run)
 * Does not create directories, only checks if they could be created.
 */
export declare function canBootstrap(paths: RuntimeStatePaths): Promise<boolean>;
