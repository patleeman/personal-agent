/**
 * Deterministic profile merge engine
 * 
 * Precedence: shared < datadog < local
 * Higher layers override lower layers
 */

import type {
  PartialProfile,
  Profile,
  ProfileData,
  LayeredProfileInput,
  MergeOptions,
  NotificationPreferences,
  PrivacySettings,
  ModelPreferences,
  ToolPermissions,
} from './types.js';
import { DEFAULTS, SCHEMA_VERSION } from './types.js';
import { validatePartialProfile, validateProfile } from './validation.js';

// Default merge options
const DEFAULT_MERGE_OPTIONS: Required<MergeOptions> = {
  arrayStrategy: 'replace',
  nullClearsValue: true,
};



/**
 * Merge notification preferences
 */
function mergeNotifications(
  lower: Partial<NotificationPreferences> | undefined,
  higher: Partial<NotificationPreferences> | undefined,
  nullClearsValue: boolean
): NotificationPreferences {
  const base = (lower as NotificationPreferences) ?? DEFAULTS.notifications;
  
  if (higher === undefined) return base;
  
  return {
    email: higher.email !== undefined 
      ? (higher.email === null && nullClearsValue ? DEFAULTS.notifications.email : higher.email as boolean)
      : base.email,
    push: higher.push !== undefined
      ? (higher.push === null && nullClearsValue ? DEFAULTS.notifications.push : higher.push as boolean)
      : base.push,
    digest: higher.digest !== undefined
      ? (higher.digest === null && nullClearsValue ? DEFAULTS.notifications.digest : higher.digest as NotificationPreferences['digest'])
      : base.digest,
  };
}

/**
 * Merge privacy settings
 */
function mergePrivacy(
  lower: Partial<PrivacySettings> | undefined,
  higher: Partial<PrivacySettings> | undefined,
  nullClearsValue: boolean
): PrivacySettings {
  const base = (lower as PrivacySettings) ?? DEFAULTS.privacy;
  
  if (higher === undefined) return base;
  
  return {
    analytics: higher.analytics !== undefined
      ? (higher.analytics === null && nullClearsValue ? DEFAULTS.privacy.analytics : higher.analytics as boolean)
      : base.analytics,
    shareUsage: higher.shareUsage !== undefined
      ? (higher.shareUsage === null && nullClearsValue ? DEFAULTS.privacy.shareUsage : higher.shareUsage as boolean)
      : base.shareUsage,
  };
}

/**
 * Merge model preferences
 */
function mergeModelPreferences(
  lower: Partial<ModelPreferences> | undefined,
  higher: Partial<ModelPreferences> | undefined,
  nullClearsValue: boolean
): ModelPreferences {
  const base = (lower as ModelPreferences) ?? DEFAULTS.modelPreferences;
  
  if (higher === undefined) return base;
  
  return {
    default: higher.default !== undefined && higher.default !== null
      ? higher.default as string
      : base.default,
    coding: higher.coding !== undefined
      ? (higher.coding === null && nullClearsValue ? DEFAULTS.modelPreferences.coding : higher.coding as string | null)
      : base.coding,
    analysis: higher.analysis !== undefined
      ? (higher.analysis === null && nullClearsValue ? DEFAULTS.modelPreferences.analysis : higher.analysis as string | null)
      : base.analysis,
    creative: higher.creative !== undefined
      ? (higher.creative === null && nullClearsValue ? DEFAULTS.modelPreferences.creative : higher.creative as string | null)
      : base.creative,
  };
}

/**
 * Merge tool permissions
 */
function mergeToolPermissions(
  lower: Partial<ToolPermissions> | undefined,
  higher: Partial<ToolPermissions> | undefined,
  nullClearsValue: boolean
): ToolPermissions {
  const base = (lower as ToolPermissions) ?? DEFAULTS.toolPermissions;
  
  if (higher === undefined) return base;
  
  return {
    webSearch: higher.webSearch !== undefined
      ? (higher.webSearch === null && nullClearsValue ? DEFAULTS.toolPermissions.webSearch : higher.webSearch as boolean)
      : base.webSearch,
    codeExecution: higher.codeExecution !== undefined
      ? (higher.codeExecution === null && nullClearsValue ? DEFAULTS.toolPermissions.codeExecution : higher.codeExecution as boolean)
      : base.codeExecution,
    fileSystem: higher.fileSystem !== undefined
      ? (higher.fileSystem === null && nullClearsValue ? DEFAULTS.toolPermissions.fileSystem : higher.fileSystem as boolean)
      : base.fileSystem,
    externalApis: higher.externalApis !== undefined
      ? (higher.externalApis === null && nullClearsValue ? DEFAULTS.toolPermissions.externalApis : higher.externalApis as boolean)
      : base.externalApis,
  };
}

/**
 * Merge array fields using configured strategy
 */
function mergeStringArray(
  lower: string[] | null | undefined,
  higher: string[] | null | undefined,
  options: Required<MergeOptions>
): string[] {
  const base = lower ?? DEFAULTS.tags;

  if (higher === undefined) return [...base];
  if (higher === null) return options.nullClearsValue ? [] : [...base];

  if (options.arrayStrategy === 'append') {
    return [...base, ...higher];
  }

  return [...higher];
}

/**
 * Merge two partial profiles with precedence
 * Higher layer overrides lower layer
 */
function mergePartialProfiles(
  lower: PartialProfile | undefined,
  higher: PartialProfile | undefined,
  options: Required<MergeOptions>
): PartialProfile {
  if (lower === undefined) return higher ?? {};
  if (higher === undefined) return lower;
  
  const result: PartialProfile = {};
  
  // Simple scalar fields - higher wins if defined
  if (higher.id !== undefined) result.id = higher.id;
  else if (lower.id !== undefined) result.id = lower.id;
  
  if (higher.version !== undefined) result.version = higher.version;
  else if (lower.version !== undefined) result.version = lower.version;
  
  if (higher.createdAt !== undefined) result.createdAt = higher.createdAt;
  else if (lower.createdAt !== undefined) result.createdAt = lower.createdAt;
  
  if (higher.updatedAt !== undefined) result.updatedAt = higher.updatedAt;
  else if (lower.updatedAt !== undefined) result.updatedAt = lower.updatedAt;
  
  // Name - higher wins if defined, null clears if option enabled
  if (higher.name !== undefined) {
    result.name = (higher.name === null && options.nullClearsValue) ? undefined : higher.name;
  } else if (lower.name !== undefined) {
    result.name = lower.name;
  }
  
  // Email - higher wins if defined
  if (higher.email !== undefined) {
    result.email = higher.email;
  } else if (lower.email !== undefined) {
    result.email = lower.email;
  }
  
  // Timezone
  if (higher.timezone !== undefined) {
    result.timezone = (higher.timezone === null && options.nullClearsValue) ? undefined : higher.timezone;
  } else if (lower.timezone !== undefined) {
    result.timezone = lower.timezone;
  }
  
  // Locale
  if (higher.locale !== undefined) {
    result.locale = (higher.locale === null && options.nullClearsValue) ? undefined : higher.locale;
  } else if (lower.locale !== undefined) {
    result.locale = lower.locale;
  }
  
  // Theme
  if (higher.theme !== undefined) {
    result.theme = (higher.theme === null && options.nullClearsValue) ? undefined : higher.theme;
  } else if (lower.theme !== undefined) {
    result.theme = lower.theme;
  }
  
  // Nested objects - merge deeply
  result.notifications = mergeNotifications(
    lower.notifications as NotificationPreferences | undefined,
    higher.notifications,
    options.nullClearsValue
  );
  result.privacy = mergePrivacy(
    lower.privacy as PrivacySettings | undefined,
    higher.privacy,
    options.nullClearsValue
  );
  result.modelPreferences = mergeModelPreferences(
    lower.modelPreferences as ModelPreferences | undefined,
    higher.modelPreferences,
    options.nullClearsValue
  );
  result.toolPermissions = mergeToolPermissions(
    lower.toolPermissions as ToolPermissions | undefined,
    higher.toolPermissions,
    options.nullClearsValue
  );

  // Array fields
  result.tags = mergeStringArray(lower.tags, higher.tags, options);
  
  // Custom instructions
  if (higher.customInstructions !== undefined) {
    result.customInstructions = (higher.customInstructions === null && options.nullClearsValue) 
      ? undefined 
      : higher.customInstructions;
  } else if (lower.customInstructions !== undefined) {
    result.customInstructions = lower.customInstructions;
  }
  
  return result;
}

/**
 * Apply defaults to a partial profile to create complete ProfileData
 */
function applyDefaults(partial: PartialProfile): ProfileData {
  return {
    name: partial.name ?? 'Unnamed Profile',
    email: partial.email ?? DEFAULTS.email,
    timezone: partial.timezone ?? DEFAULTS.timezone,
    locale: partial.locale ?? DEFAULTS.locale,
    theme: partial.theme ?? DEFAULTS.theme,
    notifications: (partial.notifications as NotificationPreferences) ?? { ...DEFAULTS.notifications },
    privacy: (partial.privacy as PrivacySettings) ?? { ...DEFAULTS.privacy },
    modelPreferences: (partial.modelPreferences as ModelPreferences) ?? { ...DEFAULTS.modelPreferences },
    toolPermissions: (partial.toolPermissions as ToolPermissions) ?? { ...DEFAULTS.toolPermissions },
    tags: partial.tags ?? [...DEFAULTS.tags],
    customInstructions: partial.customInstructions ?? DEFAULTS.customInstructions,
  };
}

/**
 * Generate metadata for a merged profile
 */
function generateMetadata(partial: PartialProfile): Pick<Profile, 'id' | 'version' | 'createdAt' | 'updatedAt'> {
  const now = new Date().toISOString();
  
  return {
    id: partial.id ?? crypto.randomUUID(),
    version: SCHEMA_VERSION,
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
  };
}

/**
 * Merge layered profiles with deterministic precedence
 * 
 * Precedence order: shared < datadog < local
 * Each layer can override fields from lower layers
 * 
 * @throws Error if validation fails (with details in message)
 */
export function mergeProfiles(
  input: LayeredProfileInput,
  options: MergeOptions = {}
): Profile {
  const opts = { ...DEFAULT_MERGE_OPTIONS, ...options };
  
  // Validate each layer individually
  const sharedValidation = input.shared ? validatePartialProfile(input.shared, 'shared') : { valid: true, errors: [] };
  const datadogValidation = input.datadog ? validatePartialProfile(input.datadog, 'datadog') : { valid: true, errors: [] };
  const localValidation = input.local ? validatePartialProfile(input.local, 'local') : { valid: true, errors: [] };
  
  const allErrors = [
    ...sharedValidation.errors,
    ...datadogValidation.errors,
    ...localValidation.errors,
  ];
  
  if (allErrors.length > 0) {
    const errorDetails = allErrors
      .map(e => `[${e.source}] ${e.field}: ${e.message} (got: ${JSON.stringify(e.value)})`)
      .join('\n');
    throw new Error(`Profile validation failed:\n${errorDetails}`);
  }
  
  // Merge in precedence order: shared -> datadog -> local
  const merged = mergePartialProfiles(
    mergePartialProfiles(input.shared, input.datadog, opts),
    input.local,
    opts
  );
  
  // Apply defaults and generate metadata
  const profileData = applyDefaults(merged);
  const metadata = generateMetadata(merged);
  
  const profile: Profile = {
    ...metadata,
    ...profileData,
  };
  
  // Final validation of merged profile
  const finalValidation = validateProfile(profile);
  if (!finalValidation.valid) {
    const errorDetails = finalValidation.errors
      .map(e => `[${e.source}] ${e.field}: ${e.message}`)
      .join('\n');
    throw new Error(`Merged profile validation failed:\n${errorDetails}`);
  }
  
  return profile;
}

/**
 * Check if a value is a valid Profile (type guard)
 */
export function isProfile(value: unknown): value is Profile {
  if (value === null || typeof value !== 'object') return false;
  
  const p = value as Profile;
  return (
    typeof p.id === 'string' &&
    typeof p.version === 'string' &&
    typeof p.name === 'string' &&
    typeof p.createdAt === 'string' &&
    typeof p.updatedAt === 'string'
  );
}
