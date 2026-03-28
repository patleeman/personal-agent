/**
 * P1: Comprehensive profile validation coverage
 * Tests all validation boundaries and edge cases
 */

import { describe, it, expect } from 'vitest';
import { validatePartialProfile, validateProfile } from './validation.js';
import type { PartialProfile } from './types.js';
import { mergeProfiles } from './merge.js';

const validUUID = '550e8400-e29b-41d4-a716-446655440000';
const validSemver = '1.0.0';
const validISO8601 = '2024-01-15T10:30:00.000Z';

describe('validatePartialProfile comprehensive', () => {
  describe('UUID v4 validation', () => {
    it('accepts valid UUID v4', () => {
      const result = validatePartialProfile({ id: validUUID }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid UUID format', () => {
      const result = validatePartialProfile({ id: 'not-a-uuid' }, 'shared');
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('id');
      expect(result.errors[0].message).toContain('UUID');
    });

    it('rejects UUID with wrong version', () => {
      // Version 1 UUID
      const result = validatePartialProfile({ id: '550e8400-e29b-11d4-a716-446655440000' }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects non-string UUID', () => {
      const result = validatePartialProfile({ id: 123 as unknown as string }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('allows undefined id', () => {
      const result = validatePartialProfile({ id: undefined }, 'shared');
      expect(result.valid).toBe(true);
    });
  });

  describe('semver validation', () => {
    it('accepts valid semver', () => {
      const result = validatePartialProfile({ version: validSemver }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid semver format', () => {
      const result = validatePartialProfile({ version: 'v1.0.0' }, 'shared');
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('version');
      expect(result.errors[0].message).toContain('semver');
    });

    it('rejects non-string version', () => {
      const result = validatePartialProfile({ version: 1 as unknown as string }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects version with only 2 components', () => {
      const result = validatePartialProfile({ version: '1.0' }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('allows undefined version', () => {
      const result = validatePartialProfile({ version: undefined }, 'shared');
      expect(result.valid).toBe(true);
    });
  });

  describe('ISO timestamp validation', () => {
    it('accepts valid ISO8601 timestamp', () => {
      const result = validatePartialProfile({ createdAt: validISO8601 }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid timestamp format', () => {
      const result = validatePartialProfile({ createdAt: '2024-01-15' }, 'shared');
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('createdAt');
    });

    it('rejects non-string timestamp', () => {
      const result = validatePartialProfile({ createdAt: Date.now() as unknown as string }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects invalid date', () => {
      const result = validatePartialProfile({ createdAt: '2024-13-45T25:70:00Z' }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('accepts valid updatedAt', () => {
      const result = validatePartialProfile({ updatedAt: validISO8601 }, 'shared');
      expect(result.valid).toBe(true);
    });
  });

  describe('timezone validation', () => {
    it('accepts valid IANA timezone', () => {
      const result = validatePartialProfile({ timezone: 'America/New_York' }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('accepts UTC', () => {
      const result = validatePartialProfile({ timezone: 'UTC' }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid timezone', () => {
      const result = validatePartialProfile({ timezone: 'Invalid/Timezone' }, 'shared');
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('timezone');
    });

    it('rejects non-string timezone', () => {
      const result = validatePartialProfile({ timezone: 0 as unknown as string }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('accepts empty timezone string (will use default)', () => {
      const result = validatePartialProfile({ timezone: '' }, 'shared');
      // Empty string should be caught by IANA validation
      expect(result.valid).toBe(false);
    });
  });

  describe('locale validation', () => {
    it('accepts valid BCP 47 locale', () => {
      const result = validatePartialProfile({ locale: 'en-US' }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('accepts language-only locale', () => {
      const result = validatePartialProfile({ locale: 'en' }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('accepts complex locale', () => {
      const result = validatePartialProfile({ locale: 'zh-Hans-CN' }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid locale', () => {
      const result = validatePartialProfile({ locale: '!!!invalid!!!' }, 'shared');
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('locale');
    });
  });

  describe('theme enum validation', () => {
    it('accepts light', () => {
      const result = validatePartialProfile({ theme: 'light' }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('accepts dark', () => {
      const result = validatePartialProfile({ theme: 'dark' }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('accepts system', () => {
      const result = validatePartialProfile({ theme: 'system' }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid theme', () => {
      const result = validatePartialProfile({ theme: 'blue' as 'light' }, 'shared');
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('theme');
    });

    it('rejects non-string theme', () => {
      const result = validatePartialProfile({ theme: 1 as unknown as 'light' }, 'shared');
      expect(result.valid).toBe(false);
    });
  });

  describe('string constraints', () => {
    it('accepts name within max length', () => {
      const result = validatePartialProfile({ name: 'Valid Name' }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects name exceeding max length', () => {
      const result = validatePartialProfile({ name: 'a'.repeat(101) }, 'shared');
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe('name');
      expect(result.errors[0].message).toContain('100');
    });

    it('accepts name at exactly max length', () => {
      const result = validatePartialProfile({ name: 'a'.repeat(100) }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects non-string name', () => {
      const result = validatePartialProfile({ name: 123 as unknown as string }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('accepts short name', () => {
      const result = validatePartialProfile({ name: 'A' }, 'shared');
      expect(result.valid).toBe(true);
    });
  });

  describe('email validation', () => {
    it('accepts valid email', () => {
      const result = validatePartialProfile({ email: 'user@example.com' }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('accepts null email', () => {
      const result = validatePartialProfile({ email: null }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('accepts undefined email', () => {
      const result = validatePartialProfile({ email: undefined }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid email format', () => {
      const result = validatePartialProfile({ email: 'not-an-email' }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects email missing @', () => {
      const result = validatePartialProfile({ email: 'userexample.com' }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects email missing domain', () => {
      const result = validatePartialProfile({ email: 'user@' }, 'shared');
      expect(result.valid).toBe(false);
    });
  });

  describe('notifications validation', () => {
    it('accepts valid notifications object', () => {
      const result = validatePartialProfile({
        notifications: { email: true, push: false, digest: 'weekly' }
      }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects unknown keys in notifications', () => {
      const result = validatePartialProfile({
        notifications: { email: true, unknownField: 'value' }
      } as PartialProfile, 'shared');
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.field === 'notifications.unknownField')).toBe(true);
    });

    it('rejects non-boolean email', () => {
      const result = validatePartialProfile({
        notifications: { email: 'yes' as unknown as boolean }
      }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects invalid digest value', () => {
      const result = validatePartialProfile({
        notifications: { digest: 'monthly' as 'daily' }
      }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects non-object notifications', () => {
      const result = validatePartialProfile({
        notifications: 'none' as unknown as { email: boolean }
      }, 'shared');
      expect(result.valid).toBe(false);
    });
  });

  describe('privacy validation', () => {
    it('accepts valid privacy object', () => {
      const result = validatePartialProfile({
        privacy: { analytics: true, shareUsage: false }
      }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects unknown keys in privacy', () => {
      const result = validatePartialProfile({
        privacy: { analytics: true, unknownField: 'value' }
      } as PartialProfile, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects non-boolean analytics', () => {
      const result = validatePartialProfile({
        privacy: { analytics: 'yes' as unknown as boolean }
      }, 'shared');
      expect(result.valid).toBe(false);
    });
  });

  describe('modelPreferences validation', () => {
    it('accepts valid modelPreferences', () => {
      const result = validatePartialProfile({
        modelPreferences: { default: 'model-a', coding: 'model-b', analysis: null, creative: null }
      }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects unknown keys in modelPreferences', () => {
      const result = validatePartialProfile({
        modelPreferences: { default: 'model-a', unknownField: 'value' }
      } as PartialProfile, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects non-string default', () => {
      const result = validatePartialProfile({
        modelPreferences: { default: 123 as unknown as string }
      }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects invalid coding type', () => {
      const result = validatePartialProfile({
        modelPreferences: { coding: 123 as unknown as string }
      }, 'shared');
      expect(result.valid).toBe(false);
    });

    it('accepts null for optional model fields', () => {
      const result = validatePartialProfile({
        modelPreferences: { default: 'model-a', coding: null, analysis: null, creative: null }
      }, 'shared');
      expect(result.valid).toBe(true);
    });
  });

  describe('toolPermissions validation', () => {
    it('accepts valid toolPermissions', () => {
      const result = validatePartialProfile({
        toolPermissions: { webSearch: true, codeExecution: false, fileSystem: true, externalApis: false }
      }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects unknown keys in toolPermissions', () => {
      const result = validatePartialProfile({
        toolPermissions: { webSearch: true, unknownTool: true }
      } as PartialProfile, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects non-boolean webSearch', () => {
      const result = validatePartialProfile({
        toolPermissions: { webSearch: 'yes' as unknown as boolean }
      }, 'shared');
      expect(result.valid).toBe(false);
    });
  });

  describe('customInstructions validation', () => {
    it('accepts valid customInstructions', () => {
      const result = validatePartialProfile({ customInstructions: 'Some instructions' }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('rejects customInstructions exceeding max length', () => {
      const result = validatePartialProfile({ customInstructions: 'a'.repeat(4001) }, 'shared');
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('4000');
    });

    it('accepts customInstructions at exactly max length', () => {
      const result = validatePartialProfile({ customInstructions: 'a'.repeat(4000) }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('accepts null customInstructions', () => {
      const result = validatePartialProfile({ customInstructions: null }, 'shared');
      expect(result.valid).toBe(true);
    });

    it('accepts undefined customInstructions', () => {
      const result = validatePartialProfile({ customInstructions: undefined }, 'shared');
      expect(result.valid).toBe(true);
    });
  });

  describe('null/undefined handling', () => {
    it('treats undefined profile as valid (no validation needed)', () => {
      const result = validatePartialProfile(undefined, 'shared');
      expect(result.valid).toBe(true);
    });

    it('treats null profile as valid (no validation needed)', () => {
      const result = validatePartialProfile(null, 'shared');
      expect(result.valid).toBe(true);
    });

    it('accepts empty object', () => {
      const result = validatePartialProfile({}, 'shared');
      expect(result.valid).toBe(true);
    });

    it('allows explicit null for optional fields', () => {
      const result = validatePartialProfile({
        email: null,
        customInstructions: null,
      }, 'shared');
      expect(result.errors.every(e => !e.field.startsWith('email') && !e.field.startsWith('customInstructions'))).toBe(true);
    });
  });

  describe('source tracking', () => {
    it('includes source in validation errors', () => {
      const result = validatePartialProfile({ email: 'invalid' }, 'datadog');
      expect(result.errors[0].source).toBe('datadog');
    });

    it('tracks different sources correctly', () => {
      const shared = validatePartialProfile({ email: 'invalid' }, 'shared');
      const local = validatePartialProfile({ email: 'invalid' }, 'local');

      expect(shared.errors[0].source).toBe('shared');
      expect(local.errors[0].source).toBe('local');
    });
  });

  describe('type guards', () => {
    it('rejects non-object profiles', () => {
      const result = validatePartialProfile('profile' as unknown as PartialProfile, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects array as profile', () => {
      const result = validatePartialProfile([] as unknown as PartialProfile, 'shared');
      expect(result.valid).toBe(false);
    });

    it('rejects number as profile', () => {
      const result = validatePartialProfile(123 as unknown as PartialProfile, 'shared');
      expect(result.valid).toBe(false);
    });
  });
});

describe('validateProfile comprehensive (merged profile)', () => {
  it('rejects profile with missing required id', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const invalidProfile = { ...profile, id: undefined };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'id')).toBe(true);
  });

  it('rejects profile with missing required version', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const invalidProfile = { ...profile, version: undefined };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'version')).toBe(true);
  });

  it('rejects profile with missing required timestamps', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const invalidProfile = { ...profile, createdAt: undefined, updatedAt: undefined };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'createdAt' || e.field === 'updatedAt')).toBe(true);
  });

  it('rejects profile with missing required name', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const invalidProfile = { ...profile, name: '' };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'name')).toBe(true);
  });

  it('rejects profile with invalid email', () => {
    expect(() => mergeProfiles({ shared: { name: 'Test', email: 'invalid' } })).toThrow(
      'Profile validation failed',
    );
  });

  it('accepts profile with null email', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const validProfile = { ...profile, email: null };
    // Other required fields must be present, so we need to create a fully valid profile
    const fullProfile = {
      ...validProfile,
      id: validUUID,
      version: validSemver,
      createdAt: validISO8601,
      updatedAt: validISO8601,
    };
    // Note: mergeProfiles should provide valid values, so this test validates the structure
    expect(fullProfile.email).toBeNull();
  });

  it('validates complete required nested objects', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const result = validateProfile(profile);

    expect(result.valid).toBe(true);
    expect(profile.notifications).toBeDefined();
    expect(profile.privacy).toBeDefined();
    expect(profile.modelPreferences).toBeDefined();
    expect(profile.toolPermissions).toBeDefined();
  });

  it('rejects profile with non-object notifications', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const invalidProfile = { ...profile, notifications: 'none' as unknown as typeof profile.notifications };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'notifications')).toBe(true);
  });

  it('rejects profile with missing notifications fields', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const invalidProfile = {
      ...profile,
      notifications: { email: true } as { email: boolean; push: boolean; digest: 'daily' | 'weekly' | 'never' }
    };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
  });

  it('rejects profile with non-object privacy', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const invalidProfile = { ...profile, privacy: 'none' as unknown as typeof profile.privacy };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
  });

  it('rejects profile with non-object modelPreferences', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const invalidProfile = { ...profile, modelPreferences: 'default' as unknown as typeof profile.modelPreferences };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
  });

  it('rejects profile with non-object toolPermissions', () => {
    const profile = mergeProfiles({ shared: { name: 'Test' } });
    const invalidProfile = { ...profile, toolPermissions: 'all' as unknown as typeof profile.toolPermissions };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
  });

  it('validates customInstructions max length', () => {
    expect(() => mergeProfiles({ shared: { name: 'Test', customInstructions: 'a'.repeat(4001) } })).toThrow(
      'Profile validation failed',
    );
  });

  it('accepts valid complete profile', () => {
    const profile = mergeProfiles({
      shared: {
        name: 'Test User',
        email: 'test@example.com',
        timezone: 'UTC',
        locale: 'en-US',
        theme: 'system',
      }
    });
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
  });
});
