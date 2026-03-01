/**
 * Profile validation logic with source-aware error reporting
 */

import type {
  PartialProfile,
  Profile,
  ProfileSource,
  ValidationError,
  ValidationResult,
} from './types.js';


// Email validation regex (simplified RFC 5322)
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// IANA timezone validation (basic check)
function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// BCP 47 locale validation
function isValidLocale(locale: string): boolean {
  try {
    return Intl.DateTimeFormat.supportedLocalesOf([locale]).length > 0;
  } catch {
    return false;
  }
}

// UUID v4 validation
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Semver validation (simplified)
const SEMVER_REGEX = /^\d+\.\d+\.\d+$/;

// ISO8601 timestamp validation
function isValidISO8601(value: string): boolean {
  const date = new Date(value);
  return !isNaN(date.getTime()) && value.includes('T');
}

/**
 * Validate a string field with constraints
 */
function validateString(
  value: unknown,
  field: string,
  source: ProfileSource | 'merged',
  options: { min?: number; max?: number; trim?: boolean } = {}
): ValidationError | null {
  if (value === undefined || value === null) return null;
  
  if (typeof value !== 'string') {
    return { source, field, message: `Expected string, got ${typeof value}`, value };
  }
  
  const trimmed = options.trim !== false ? value.trim() : value;
  
  if (options.min !== undefined && trimmed.length < options.min) {
    return { source, field, message: `Minimum length is ${options.min}`, value };
  }
  
  if (options.max !== undefined && trimmed.length > options.max) {
    return { source, field, message: `Maximum length is ${options.max}`, value };
  }
  
  return null;
}

/**
 * Validate enum field
 */
function validateEnum<T extends string>(
  value: unknown,
  field: string,
  source: ProfileSource | 'merged',
  allowed: readonly T[]
): ValidationError | null {
  if (value === undefined || value === null) return null;
  
  if (!allowed.includes(value as T)) {
    return { source, field, message: `Must be one of: ${allowed.join(', ')}`, value };
  }
  
  return null;
}

/**
 * Validate boolean field
 */
function validateBoolean(
  value: unknown,
  field: string,
  source: ProfileSource | 'merged'
): ValidationError | null {
  if (value === undefined || value === null) return null;
  
  if (typeof value !== 'boolean') {
    return { source, field, message: `Expected boolean, got ${typeof value}`, value };
  }
  
  return null;
}

/**
 * Validate array of strings
 */
function validateStringArray(
  value: unknown,
  field: string,
  source: ProfileSource | 'merged'
): ValidationError[] {
  if (value === undefined || value === null) return [];

  if (!Array.isArray(value)) {
    return [{ source, field, message: 'Expected array', value }];
  }

  const errors: ValidationError[] = [];
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== 'string') {
      errors.push({
        source,
        field: `${field}[${i}]`,
        message: `Expected string, got ${typeof value[i]}`,
        value: value[i],
      });
    }
  }

  return errors;
}

/**
 * Validate notification preferences
 */
function validateNotifications(
  value: unknown,
  field: string,
  source: ProfileSource | 'merged'
): ValidationError[] {
  if (value === undefined || value === null) return [];
  
  if (typeof value !== 'object' || value === null) {
    return [{ source, field, message: 'Expected object', value }];
  }
  
  const obj = value as Record<string, unknown>;
  const errors: ValidationError[] = [];
  
  const emailError = validateBoolean(obj.email, `${field}.email`, source);
  if (emailError) errors.push(emailError);

  const pushError = validateBoolean(obj.push, `${field}.push`, source);
  if (pushError) errors.push(pushError);

  const digestError = validateEnum(obj.digest, `${field}.digest`, source, ['daily', 'weekly', 'never']);
  if (digestError) errors.push(digestError);
  
  // Check for unknown keys
  const knownKeys = ['email', 'push', 'digest'];
  for (const key of Object.keys(obj)) {
    if (!knownKeys.includes(key)) {
      errors.push({ source, field: `${field}.${key}`, message: 'Unknown field', value: obj[key] });
    }
  }
  
  return errors;
}

/**
 * Validate privacy settings
 */
function validatePrivacy(
  value: unknown,
  field: string,
  source: ProfileSource | 'merged'
): ValidationError[] {
  if (value === undefined || value === null) return [];
  
  if (typeof value !== 'object' || value === null) {
    return [{ source, field, message: 'Expected object', value }];
  }
  
  const obj = value as Record<string, unknown>;
  const errors: ValidationError[] = [];

  const analyticsError = validateBoolean(obj.analytics, `${field}.analytics`, source);
  if (analyticsError) errors.push(analyticsError);

  const shareUsageError = validateBoolean(obj.shareUsage, `${field}.shareUsage`, source);
  if (shareUsageError) errors.push(shareUsageError);

  // Check for unknown keys
  const knownKeys = ['analytics', 'shareUsage'];
  for (const key of Object.keys(obj)) {
    if (!knownKeys.includes(key)) {
      errors.push({ source, field: `${field}.${key}`, message: 'Unknown field', value: obj[key] });
    }
  }
  
  return errors;
}

/**
 * Validate model preferences
 */
function validateModelPreferences(
  value: unknown,
  field: string,
  source: ProfileSource | 'merged'
): ValidationError[] {
  if (value === undefined || value === null) return [];
  
  if (typeof value !== 'object' || value === null) {
    return [{ source, field, message: 'Expected object', value }];
  }
  
  const obj = value as Record<string, unknown>;
  const errors: ValidationError[] = [];
  
  // default is required when object is present
  const defaultError = validateString(obj.default, `${field}.default`, source, { min: 1 });
  if (defaultError) errors.push(defaultError);
  
  // Optional fields must be string or null
  for (const key of ['coding', 'analysis', 'creative'] as const) {
    const val = obj[key];
    if (val !== undefined && val !== null && typeof val !== 'string') {
      errors.push({
        source,
        field: `${field}.${key}`,
        message: 'Expected string or null',
        value: val,
      });
    }
  }
  
  // Check for unknown keys
  const knownKeys = ['default', 'coding', 'analysis', 'creative'];
  for (const key of Object.keys(obj)) {
    if (!knownKeys.includes(key)) {
      errors.push({ source, field: `${field}.${key}`, message: 'Unknown field', value: obj[key] });
    }
  }
  
  return errors;
}

/**
 * Validate tool permissions
 */
function validateToolPermissions(
  value: unknown,
  field: string,
  source: ProfileSource | 'merged'
): ValidationError[] {
  if (value === undefined || value === null) return [];
  
  if (typeof value !== 'object' || value === null) {
    return [{ source, field, message: 'Expected object', value }];
  }
  
  const obj = value as Record<string, unknown>;
  const errors: ValidationError[] = [];
  
  for (const key of ['webSearch', 'codeExecution', 'fileSystem', 'externalApis'] as const) {
    const val = obj[key];
    if (val !== undefined && val !== null) {
      const err = validateBoolean(val, `${field}.${key}`, source);
      if (err) errors.push(err);
    }
  }
  
  // Check for unknown keys
  const knownKeys = ['webSearch', 'codeExecution', 'fileSystem', 'externalApis'];
  for (const key of Object.keys(obj)) {
    if (!knownKeys.includes(key)) {
      errors.push({ source, field: `${field}.${key}`, message: 'Unknown field', value: obj[key] });
    }
  }
  
  return errors;
}

/**
 * Validate a partial profile (for individual layers)
 */
export function validatePartialProfile(
  profile: unknown,
  source: ProfileSource
): ValidationResult {
  if (profile === undefined || profile === null) {
    return { valid: true, errors: [] };
  }
  
  if (typeof profile !== 'object' || Array.isArray(profile)) {
    return {
      valid: false,
      errors: [{ source, field: '', message: 'Expected object', value: profile }],
    };
  }
  
  const obj = profile as PartialProfile;
  const errors: ValidationError[] = [];
  
  // Validate metadata fields if present
  if (obj.id !== undefined) {
    if (typeof obj.id !== 'string' || !UUID_REGEX.test(obj.id)) {
      errors.push({ source, field: 'id', message: 'Invalid UUID v4 format', value: obj.id });
    }
  }
  
  if (obj.version !== undefined) {
    if (typeof obj.version !== 'string' || !SEMVER_REGEX.test(obj.version)) {
      errors.push({ source, field: 'version', message: 'Invalid semver format', value: obj.version });
    }
  }
  
  if (obj.createdAt !== undefined) {
    if (typeof obj.createdAt !== 'string' || !isValidISO8601(obj.createdAt)) {
      errors.push({ source, field: 'createdAt', message: 'Invalid ISO8601 timestamp', value: obj.createdAt });
    }
  }
  
  if (obj.updatedAt !== undefined) {
    if (typeof obj.updatedAt !== 'string' || !isValidISO8601(obj.updatedAt)) {
      errors.push({ source, field: 'updatedAt', message: 'Invalid ISO8601 timestamp', value: obj.updatedAt });
    }
  }
  
  // Validate data fields
  const nameError = validateString(obj.name, 'name', source, { min: 1, max: 100 });
  if (nameError) errors.push(nameError);
  
  if (obj.email !== undefined && obj.email !== null) {
    const emailError = validateString(obj.email, 'email', source);
    if (emailError) {
      errors.push(emailError);
    } else if (!EMAIL_REGEX.test(obj.email)) {
      errors.push({ source, field: 'email', message: 'Invalid email format', value: obj.email });
    }
  }
  
  if (obj.timezone !== undefined) {
    if (typeof obj.timezone !== 'string' || !isValidTimezone(obj.timezone)) {
      errors.push({ source, field: 'timezone', message: 'Invalid IANA timezone', value: obj.timezone });
    }
  }
  
  if (obj.locale !== undefined) {
    if (typeof obj.locale !== 'string' || !isValidLocale(obj.locale)) {
      errors.push({ source, field: 'locale', message: 'Invalid BCP 47 locale', value: obj.locale });
    }
  }
  
  const themeError = validateEnum(obj.theme, 'theme', source, ['light', 'dark', 'system']);
  if (themeError) errors.push(themeError);
  
  errors.push(...validateNotifications(obj.notifications, 'notifications', source));
  errors.push(...validatePrivacy(obj.privacy, 'privacy', source));
  errors.push(...validateModelPreferences(obj.modelPreferences, 'modelPreferences', source));
  errors.push(...validateToolPermissions(obj.toolPermissions, 'toolPermissions', source));
  errors.push(...validateStringArray(obj.tags, 'tags', source));
  
  const customInstructionsError = validateString(obj.customInstructions, 'customInstructions', source, {
    max: 4000,
  });
  if (customInstructionsError) errors.push(customInstructionsError);
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a complete profile (merged result)
 */
export function validateProfile(profile: unknown): ValidationResult {
  if (profile === null || typeof profile !== 'object') {
    return {
      valid: false,
      errors: [{ source: 'merged', field: '', message: 'Expected object', value: profile }],
    };
  }
  
  const obj = profile as Profile;
  const errors: ValidationError[] = [];
  
  // Required fields
  if (!obj.id || typeof obj.id !== 'string' || !UUID_REGEX.test(obj.id)) {
    errors.push({ source: 'merged', field: 'id', message: 'Required valid UUID v4', value: obj.id });
  }
  
  if (!obj.version || typeof obj.version !== 'string' || !SEMVER_REGEX.test(obj.version)) {
    errors.push({ source: 'merged', field: 'version', message: 'Required valid semver', value: obj.version });
  }
  
  if (!obj.createdAt || typeof obj.createdAt !== 'string' || !isValidISO8601(obj.createdAt)) {
    errors.push({ source: 'merged', field: 'createdAt', message: 'Required valid ISO8601 timestamp', value: obj.createdAt });
  }
  
  if (!obj.updatedAt || typeof obj.updatedAt !== 'string' || !isValidISO8601(obj.updatedAt)) {
    errors.push({ source: 'merged', field: 'updatedAt', message: 'Required valid ISO8601 timestamp', value: obj.updatedAt });
  }
  
  if (!obj.name || typeof obj.name !== 'string' || obj.name.trim().length < 1 || obj.name.length > 100) {
    errors.push({ source: 'merged', field: 'name', message: 'Required: 1-100 characters', value: obj.name });
  }
  
  // Optional fields with defaults
  if (obj.email !== null && obj.email !== undefined) {
    if (typeof obj.email !== 'string' || !EMAIL_REGEX.test(obj.email)) {
      errors.push({ source: 'merged', field: 'email', message: 'Invalid email format', value: obj.email });
    }
  }
  
  if (!obj.timezone || typeof obj.timezone !== 'string' || !isValidTimezone(obj.timezone)) {
    errors.push({ source: 'merged', field: 'timezone', message: 'Required valid IANA timezone', value: obj.timezone });
  }
  
  if (!obj.locale || typeof obj.locale !== 'string' || !isValidLocale(obj.locale)) {
    errors.push({ source: 'merged', field: 'locale', message: 'Required valid BCP 47 locale', value: obj.locale });
  }
  
  if (!obj.theme || !['light', 'dark', 'system'].includes(obj.theme)) {
    errors.push({ source: 'merged', field: 'theme', message: 'Required: light, dark, or system', value: obj.theme });
  }
  
  // Nested objects
  errors.push(...validateNotifications(obj.notifications, 'notifications', 'merged'));
  errors.push(...validatePrivacy(obj.privacy, 'privacy', 'merged'));
  errors.push(...validateModelPreferences(obj.modelPreferences, 'modelPreferences', 'merged'));
  errors.push(...validateToolPermissions(obj.toolPermissions, 'toolPermissions', 'merged'));
  errors.push(...validateStringArray(obj.tags, 'tags', 'merged'));

  if (typeof obj.notifications !== 'object' || obj.notifications === null) {
    errors.push({ source: 'merged', field: 'notifications', message: 'Required object', value: obj.notifications });
  } else {
    if (typeof obj.notifications.email !== 'boolean') {
      errors.push({ source: 'merged', field: 'notifications.email', message: 'Required boolean', value: obj.notifications.email });
    }
    if (typeof obj.notifications.push !== 'boolean') {
      errors.push({ source: 'merged', field: 'notifications.push', message: 'Required boolean', value: obj.notifications.push });
    }
    if (!['daily', 'weekly', 'never'].includes(obj.notifications.digest)) {
      errors.push({ source: 'merged', field: 'notifications.digest', message: 'Required: daily, weekly, or never', value: obj.notifications.digest });
    }
  }

  if (typeof obj.privacy !== 'object' || obj.privacy === null) {
    errors.push({ source: 'merged', field: 'privacy', message: 'Required object', value: obj.privacy });
  } else {
    if (typeof obj.privacy.analytics !== 'boolean') {
      errors.push({ source: 'merged', field: 'privacy.analytics', message: 'Required boolean', value: obj.privacy.analytics });
    }
    if (typeof obj.privacy.shareUsage !== 'boolean') {
      errors.push({ source: 'merged', field: 'privacy.shareUsage', message: 'Required boolean', value: obj.privacy.shareUsage });
    }
  }

  if (typeof obj.modelPreferences !== 'object' || obj.modelPreferences === null) {
    errors.push({ source: 'merged', field: 'modelPreferences', message: 'Required object', value: obj.modelPreferences });
  } else {
    if (typeof obj.modelPreferences.default !== 'string' || obj.modelPreferences.default.length === 0) {
      errors.push({ source: 'merged', field: 'modelPreferences.default', message: 'Required non-empty string', value: obj.modelPreferences.default });
    }

    for (const key of ['coding', 'analysis', 'creative'] as const) {
      const value = obj.modelPreferences[key];
      if (!(value === null || typeof value === 'string')) {
        errors.push({ source: 'merged', field: `modelPreferences.${key}`, message: 'Required string or null', value });
      }
    }
  }

  if (typeof obj.toolPermissions !== 'object' || obj.toolPermissions === null) {
    errors.push({ source: 'merged', field: 'toolPermissions', message: 'Required object', value: obj.toolPermissions });
  } else {
    for (const key of ['webSearch', 'codeExecution', 'fileSystem', 'externalApis'] as const) {
      const value = obj.toolPermissions[key];
      if (typeof value !== 'boolean') {
        errors.push({ source: 'merged', field: `toolPermissions.${key}`, message: 'Required boolean', value });
      }
    }
  }
  
  if (obj.customInstructions !== undefined && obj.customInstructions !== null) {
    if (typeof obj.customInstructions !== 'string' || obj.customInstructions.length > 4000) {
      errors.push({ source: 'merged', field: 'customInstructions', message: 'Max 4000 characters', value: obj.customInstructions });
    }
  }
  
  return { valid: errors.length === 0, errors };
}
