/**
 * Profile schema types and validation contracts
 *
 * Supports layered profiles: shared < datadog < local
 */

export const SCHEMA_VERSION = '1.0.0';

// Notification preferences
export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  digest: 'daily' | 'weekly' | 'never';
}

// Privacy settings
export interface PrivacySettings {
  analytics: boolean;
  shareUsage: boolean;
}

// Model preferences
export interface ModelPreferences {
  default: string;
  coding: string | null;
  analysis: string | null;
  creative: string | null;
}

// Tool permissions
export interface ToolPermissions {
  webSearch: boolean;
  codeExecution: boolean;
  fileSystem: boolean;
  externalApis: boolean;
}

// Core profile data (excludes metadata)
export interface ProfileData {
  name: string;
  email: string | null;
  timezone: string;
  locale: string;
  theme: 'light' | 'dark' | 'system';
  notifications: NotificationPreferences;
  privacy: PrivacySettings;
  modelPreferences: ModelPreferences;
  toolPermissions: ToolPermissions;
  customInstructions: string;
}

// Full profile with metadata
export interface Profile extends ProfileData {
  id: string;
  version: string;
  createdAt: string;
  updatedAt: string;
}

// Partial profile for layering (all fields optional, nested objects can be partial)
export interface PartialProfile {
  id?: string;
  version?: string;
  createdAt?: string;
  updatedAt?: string;
  name?: string;
  email?: string | null;
  timezone?: string;
  locale?: string;
  theme?: 'light' | 'dark' | 'system';
  notifications?: Partial<NotificationPreferences>;
  privacy?: Partial<PrivacySettings>;
  modelPreferences?: Partial<ModelPreferences>;
  toolPermissions?: Partial<ToolPermissions>;
  customInstructions?: string;
}

// Profile source identifiers
export type ProfileSource = 'shared' | 'datadog' | 'local';

// Layered profile input
export interface LayeredProfileInput {
  shared?: PartialProfile;
  datadog?: PartialProfile;
  local?: PartialProfile;
}

// Validation error with source context
export interface ValidationError {
  source: ProfileSource | 'merged';
  field: string;
  message: string;
  value: unknown;
}

// Validation result
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
}

// Merge options
export interface MergeOptions {
  /** How to handle array fields: 'replace' (default) or 'append' */
  arrayStrategy?: 'replace' | 'append';
  /** Whether null values in higher layers should clear lower layer values */
  nullClearsValue?: boolean;
}

// Default values for profile fields
export const DEFAULTS: Required<Omit<ProfileData, 'name'>> = {
  email: null,
  timezone: 'UTC',
  locale: 'en-US',
  theme: 'system',
  notifications: {
    email: true,
    push: true,
    digest: 'daily',
  },
  privacy: {
    analytics: true,
    shareUsage: false,
  },
  modelPreferences: {
    default: 'claude-sonnet-4-20250514',
    coding: null,
    analysis: null,
    creative: null,
  },
  toolPermissions: {
    webSearch: true,
    codeExecution: false,
    fileSystem: true,
    externalApis: false,
  },
  customInstructions: '',
};
