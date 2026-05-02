/**
 * Profile module - schema, validation, and merge engine
 *
 * Supports layered profiles: shared < datadog < local
 * with deterministic merge rules and comprehensive validation.
 */

// Types
export type {
  LayeredProfileInput,
  MergeOptions,
  ModelPreferences,
  NotificationPreferences,
  PartialProfile,
  PrivacySettings,
  Profile,
  ProfileData,
  ProfileSource,
  ToolPermissions,
  ValidationError,
  ValidationResult,
} from './types.js';

// Constants
export { DEFAULTS, SCHEMA_VERSION } from './types.js';

// Validation
export { validatePartialProfile, validateProfile } from './validation.js';

// Merge engine
export { isProfile, mergeProfiles } from './merge.js';
