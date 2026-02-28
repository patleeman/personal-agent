/**
 * Profile module - schema, validation, and merge engine
 * 
 * Supports layered profiles: shared < datadog < local
 * with deterministic merge rules and comprehensive validation.
 */

// Types
export type {
  Profile,
  ProfileData,
  PartialProfile,
  ProfileSource,
  LayeredProfileInput,
  MergeOptions,
  ValidationError,
  ValidationResult,
  NotificationPreferences,
  PrivacySettings,
  ModelPreferences,
  ToolPermissions,
} from './types.js';

// Constants
export { SCHEMA_VERSION, DEFAULTS } from './types.js';

// Validation
export { validatePartialProfile, validateProfile } from './validation.js';

// Merge engine
export { mergeProfiles, isProfile } from './merge.js';
