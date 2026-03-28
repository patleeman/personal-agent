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

function resolveBooleanValue(
  lower: unknown,
  higher: unknown,
  defaultValue: boolean,
  nullClearsValue: boolean,
): boolean {
  if (higher !== undefined) {
    if (higher === null) {
      if (nullClearsValue) return defaultValue;
    } else if (typeof higher === 'boolean') {
      return higher;
    }
  }

  if (lower !== undefined) {
    if (lower === null) {
      if (nullClearsValue) return defaultValue;
    } else if (typeof lower === 'boolean') {
      return lower;
    }
  }

  return defaultValue;
}

function resolveDigestValue(
  lower: unknown,
  higher: unknown,
  defaultValue: NotificationPreferences['digest'],
  nullClearsValue: boolean,
): NotificationPreferences['digest'] {
  const isDigest = (value: unknown): value is NotificationPreferences['digest'] =>
    value === 'daily' || value === 'weekly' || value === 'never';

  if (higher !== undefined) {
    if (higher === null) {
      if (nullClearsValue) return defaultValue;
    } else if (isDigest(higher)) {
      return higher;
    }
  }

  if (lower !== undefined) {
    if (lower === null) {
      if (nullClearsValue) return defaultValue;
    } else if (isDigest(lower)) {
      return lower;
    }
  }

  return defaultValue;
}

function resolveRequiredStringValue(
  lower: unknown,
  higher: unknown,
  defaultValue: string,
  nullClearsValue: boolean,
): string {
  if (higher !== undefined) {
    if (higher === null) {
      if (nullClearsValue) return defaultValue;
    } else if (typeof higher === 'string') {
      return higher;
    }
  }

  if (lower !== undefined) {
    if (lower === null) {
      if (nullClearsValue) return defaultValue;
    } else if (typeof lower === 'string') {
      return lower;
    }
  }

  return defaultValue;
}

function resolveNullableStringValue(
  lower: unknown,
  higher: unknown,
  defaultValue: string | null,
  nullClearsValue: boolean,
): string | null {
  if (higher !== undefined) {
    if (higher === null) {
      return nullClearsValue ? defaultValue : null;
    }

    if (typeof higher === 'string') {
      return higher;
    }
  }

  if (lower !== undefined) {
    if (lower === null) {
      return nullClearsValue ? defaultValue : null;
    }

    if (typeof lower === 'string') {
      return lower;
    }
  }

  return defaultValue;
}

/**
 * Merge notification preferences
 */
function mergeNotifications(
  lower: Partial<NotificationPreferences> | undefined,
  higher: Partial<NotificationPreferences> | undefined,
  nullClearsValue: boolean
): NotificationPreferences {
  return {
    email: resolveBooleanValue(
      lower?.email,
      higher?.email,
      DEFAULTS.notifications.email,
      nullClearsValue,
    ),
    push: resolveBooleanValue(
      lower?.push,
      higher?.push,
      DEFAULTS.notifications.push,
      nullClearsValue,
    ),
    digest: resolveDigestValue(
      lower?.digest,
      higher?.digest,
      DEFAULTS.notifications.digest,
      nullClearsValue,
    ),
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
  return {
    analytics: resolveBooleanValue(
      lower?.analytics,
      higher?.analytics,
      DEFAULTS.privacy.analytics,
      nullClearsValue,
    ),
    shareUsage: resolveBooleanValue(
      lower?.shareUsage,
      higher?.shareUsage,
      DEFAULTS.privacy.shareUsage,
      nullClearsValue,
    ),
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
  return {
    default: resolveRequiredStringValue(
      lower?.default,
      higher?.default,
      DEFAULTS.modelPreferences.default,
      nullClearsValue,
    ),
    coding: resolveNullableStringValue(
      lower?.coding,
      higher?.coding,
      DEFAULTS.modelPreferences.coding,
      nullClearsValue,
    ),
    analysis: resolveNullableStringValue(
      lower?.analysis,
      higher?.analysis,
      DEFAULTS.modelPreferences.analysis,
      nullClearsValue,
    ),
    creative: resolveNullableStringValue(
      lower?.creative,
      higher?.creative,
      DEFAULTS.modelPreferences.creative,
      nullClearsValue,
    ),
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
  return {
    webSearch: resolveBooleanValue(
      lower?.webSearch,
      higher?.webSearch,
      DEFAULTS.toolPermissions.webSearch,
      nullClearsValue,
    ),
    codeExecution: resolveBooleanValue(
      lower?.codeExecution,
      higher?.codeExecution,
      DEFAULTS.toolPermissions.codeExecution,
      nullClearsValue,
    ),
    fileSystem: resolveBooleanValue(
      lower?.fileSystem,
      higher?.fileSystem,
      DEFAULTS.toolPermissions.fileSystem,
      nullClearsValue,
    ),
    externalApis: resolveBooleanValue(
      lower?.externalApis,
      higher?.externalApis,
      DEFAULTS.toolPermissions.externalApis,
      nullClearsValue,
    ),
  };
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
    lower.notifications,
    higher.notifications,
    options.nullClearsValue
  );
  result.privacy = mergePrivacy(
    lower.privacy,
    higher.privacy,
    options.nullClearsValue
  );
  result.modelPreferences = mergeModelPreferences(
    lower.modelPreferences,
    higher.modelPreferences,
    options.nullClearsValue
  );
  result.toolPermissions = mergeToolPermissions(
    lower.toolPermissions,
    higher.toolPermissions,
    options.nullClearsValue
  );
  
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
    notifications: mergeNotifications(undefined, partial.notifications, true),
    privacy: mergePrivacy(undefined, partial.privacy, true),
    modelPreferences: mergeModelPreferences(undefined, partial.modelPreferences, true),
    toolPermissions: mergeToolPermissions(undefined, partial.toolPermissions, true),
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
