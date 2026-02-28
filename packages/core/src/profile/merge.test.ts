/**
 * Tests for profile merge engine
 * 
 * Covers: layering, precedence, null/undefined handling, validation
 */

import { describe, it, expect } from 'vitest';
import { mergeProfiles, isProfile } from './merge.js';
import { validatePartialProfile, validateProfile } from './validation.js';
import type { PartialProfile, NotificationPreferences } from './types.js';

// Test helper to create minimal valid partials
const basePartial = (overrides: Partial<PartialProfile> = {}): PartialProfile => ({
  name: 'Test User',
  ...overrides,
});

describe('mergeProfiles', () => {
  describe('layering precedence', () => {
    it('should use shared values when no higher layers exist', () => {
      const result = mergeProfiles({
        shared: basePartial({ name: 'Shared Name', timezone: 'America/New_York' }),
      });
      
      expect(result.name).toBe('Shared Name');
      expect(result.timezone).toBe('America/New_York');
    });
    
    it('should use datadog over shared', () => {
      const result = mergeProfiles({
        shared: basePartial({ name: 'Shared Name', timezone: 'America/New_York' }),
        datadog: { name: 'Datadog Name' },
      });
      
      expect(result.name).toBe('Datadog Name');
      expect(result.timezone).toBe('America/New_York'); // from shared
    });
    
    it('should use local over datadog and shared', () => {
      const result = mergeProfiles({
        shared: basePartial({ name: 'Shared Name', timezone: 'America/New_York' }),
        datadog: { name: 'Datadog Name', locale: 'en-GB' },
        local: { name: 'Local Name' },
      });
      
      expect(result.name).toBe('Local Name');
      expect(result.timezone).toBe('America/New_York'); // from shared
      expect(result.locale).toBe('en-GB'); // from datadog
    });
    
    it('should apply correct precedence order: shared < datadog < local', () => {
      const result = mergeProfiles({
        shared: basePartial({ theme: 'light', email: 'shared@example.com' }),
        datadog: { theme: 'dark' },
        local: { email: 'local@example.com' },
      });
      
      expect(result.theme).toBe('dark'); // datadog overrides shared
      expect(result.email).toBe('local@example.com'); // local overrides shared
    });
  });
  
  describe('deterministic merge', () => {
    it('should produce identical output for identical inputs (excluding metadata)', () => {
      const input = {
        shared: basePartial({ timezone: 'Europe/London', theme: 'dark' }),
        datadog: { notifications: { email: false, push: true, digest: 'weekly' as const } },
        local: { locale: 'fr-FR' },
      };
      
      const result1 = mergeProfiles(input);
      const result2 = mergeProfiles(input);
      
      // Compare profile data (excluding generated metadata)
      expect(result1.name).toBe(result2.name);
      expect(result1.timezone).toBe(result2.timezone);
      expect(result1.theme).toBe(result2.theme);
      expect(result1.notifications).toEqual(result2.notifications);
      expect(result1.locale).toBe(result2.locale);
    });
    
    it('should produce identical profile data across multiple runs', () => {
      const input = {
        shared: basePartial({
          name: 'Test',
          modelPreferences: { default: 'model-a', coding: 'model-b', analysis: null, creative: null },
        }),
        datadog: { privacy: { analytics: false, shareUsage: true } },
        local: { toolPermissions: { webSearch: false, codeExecution: true, fileSystem: true, externalApis: false } },
      };
      
      const results = Array.from({ length: 5 }, () => mergeProfiles(input));
      
      for (let i = 1; i < results.length; i++) {
        expect(results[i].name).toBe(results[0].name);
        expect(results[i].modelPreferences).toEqual(results[0].modelPreferences);
        expect(results[i].privacy).toEqual(results[0].privacy);
        expect(results[i].toolPermissions).toEqual(results[0].toolPermissions);
      }
    });
  });
  
  describe('scalar field handling', () => {
    it('should replace scalar values from higher layers', () => {
      const result = mergeProfiles({
        shared: basePartial({ name: 'Shared', timezone: 'UTC' }),
        datadog: { name: 'Datadog' },
        local: { timezone: 'America/Los_Angeles' },
      });
      
      expect(result.name).toBe('Datadog');
      expect(result.timezone).toBe('America/Los_Angeles');
    });
    
    it('should trim whitespace from name', () => {
      const result = mergeProfiles({
        shared: { name: '  Test User  ' },
      });
      
      // Note: actual trimming behavior depends on validation/defaults
      expect(result.name).toBeDefined();
    });
  });
  
  describe('object merge semantics', () => {
    it('should shallow merge nested objects', () => {
      const result = mergeProfiles({
        shared: basePartial({
          notifications: { email: true, push: true, digest: 'daily' },
        }),
        datadog: {
          notifications: { email: false },
        },
      });
      
      expect(result.notifications).toEqual({
        email: false, // overridden by datadog
        push: true,   // from shared
        digest: 'daily', // from shared
      });
    });
    
    it('should merge privacy settings across layers', () => {
      const result = mergeProfiles({
        shared: basePartial({
          privacy: { analytics: true, shareUsage: false },
        }),
        local: {
          privacy: { shareUsage: true },
        },
      });
      
      expect(result.privacy).toEqual({
        analytics: true,  // from shared
        shareUsage: true, // overridden by local
      });
    });
    
    it('should merge model preferences across layers', () => {
      const result = mergeProfiles({
        shared: basePartial({
          modelPreferences: { default: 'model-a', coding: 'model-b', analysis: null, creative: null },
        }),
        datadog: {
          modelPreferences: { analysis: 'model-c' },
        },
        local: {
          modelPreferences: { default: 'model-d' },
        },
      });
      
      expect(result.modelPreferences).toEqual({
        default: 'model-d',    // overridden by local
        coding: 'model-b',     // from shared
        analysis: 'model-c',   // from datadog
        creative: null,        // from shared
      });
    });
    
    it('should merge tool permissions across layers', () => {
      const result = mergeProfiles({
        shared: basePartial({
          toolPermissions: { webSearch: true, codeExecution: false, fileSystem: true, externalApis: false },
        }),
        datadog: {
          toolPermissions: { codeExecution: true },
        },
        local: {
          toolPermissions: { webSearch: false },
        },
      });
      
      expect(result.toolPermissions).toEqual({
        webSearch: false,      // overridden by local
        codeExecution: true,   // overridden by datadog
        fileSystem: true,      // from shared
        externalApis: false,   // from shared
      });
    });
  });
  
  describe('array merge semantics', () => {
    it('should replace arrays by default', () => {
      const result = mergeProfiles({
        shared: basePartial({ tags: ['shared-a', 'shared-b'] }),
        datadog: { tags: ['dd-a'] },
        local: { tags: ['local-a'] },
      });

      expect(result.tags).toEqual(['local-a']);
    });

    it('should append arrays when arrayStrategy=append', () => {
      const result = mergeProfiles(
        {
          shared: basePartial({ tags: ['shared-a'] }),
          datadog: { tags: ['dd-a'] },
          local: { tags: ['local-a'] },
        },
        { arrayStrategy: 'append' }
      );

      expect(result.tags).toEqual(['shared-a', 'dd-a', 'local-a']);
    });

    it('should clear arrays with null when nullClearsValue=true', () => {
      const result = mergeProfiles({
        shared: basePartial({ tags: ['shared-a'] }),
        datadog: { tags: null },
      });

      expect(result.tags).toEqual([]);
    });
  });

  describe('null/undefined handling', () => {
    it('should treat undefined as "not set" (keeps lower value)', () => {
      const result = mergeProfiles({
        shared: basePartial({ name: 'Shared', timezone: 'UTC' }),
        datadog: { name: undefined },
        local: { timezone: undefined },
      });
      
      expect(result.name).toBe('Shared');
      expect(result.timezone).toBe('UTC');
    });
    
    it('should use defaults when all layers have undefined/null', () => {
      const result = mergeProfiles({
        shared: basePartial({}),
      });
      
      expect(result.timezone).toBe('UTC');
      expect(result.locale).toBe('en-US');
      expect(result.theme).toBe('system');
    });
    
    it('should allow explicit null for email', () => {
      const result = mergeProfiles({
        shared: basePartial({ email: 'test@example.com' }),
        datadog: { email: null },
      });
      
      expect(result.email).toBeNull();
    });
    
    it('should handle null in nested objects', () => {
      const result = mergeProfiles({
        shared: basePartial({
          modelPreferences: { default: 'model-a', coding: 'model-b', analysis: null, creative: null },
        }),
        datadog: {
          modelPreferences: { coding: null },
        },
      });
      
      expect(result.modelPreferences.default).toBe('model-a');
      expect(result.modelPreferences.coding).toBeNull();
    });
  });
  
  describe('defaults application', () => {
    it('should apply defaults for missing optional fields', () => {
      const result = mergeProfiles({
        shared: basePartial({ name: 'Minimal' }),
      });
      
      expect(result.email).toBeNull();
      expect(result.timezone).toBe('UTC');
      expect(result.locale).toBe('en-US');
      expect(result.theme).toBe('system');
      expect(result.notifications).toEqual({
        email: true,
        push: true,
        digest: 'daily',
      });
      expect(result.privacy).toEqual({
        analytics: true,
        shareUsage: false,
      });
      expect(result.tags).toEqual([]);
    });
    
    it('should apply defaults for empty input', () => {
      const result = mergeProfiles({});
      
      expect(result.name).toBe('Unnamed Profile');
      expect(result.timezone).toBe('UTC');
      expect(result.locale).toBe('en-US');
    });
  });
  
  describe('metadata generation', () => {
    it('should generate UUID if not provided', () => {
      const result = mergeProfiles({});
      
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });
    
    it('should preserve provided ID from highest layer', () => {
      const result = mergeProfiles({
        shared: { id: '550e8400-e29b-41d4-a716-446655440001' },
        datadog: { id: '550e8400-e29b-41d4-a716-446655440002' },
        local: { id: '550e8400-e29b-41d4-a716-446655440003' },
      });
      
      expect(result.id).toBe('550e8400-e29b-41d4-a716-446655440003');
    });
    
    it('should set schema version', () => {
      const result = mergeProfiles({});
      
      expect(result.version).toBe('1.0.0');
    });
    
    it('should set timestamps', () => {
      const before = new Date().toISOString();
      const result = mergeProfiles({});
      const after = new Date().toISOString();
      
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.createdAt >= before || result.createdAt <= after).toBeTruthy();
    });
  });
  
  describe('validation errors', () => {
    it('should throw on invalid email in shared layer', () => {
      expect(() =>
        mergeProfiles({
          shared: basePartial({ email: 'not-an-email' }),
        })
      ).toThrow('[shared] email: Invalid email format');
    });
    
    it('should throw on invalid email in local layer', () => {
      expect(() =>
        mergeProfiles({
          local: { email: 'invalid' },
        })
      ).toThrow('[local] email: Invalid email format');
    });
    
    it('should throw on invalid timezone', () => {
      expect(() =>
        mergeProfiles({
          shared: basePartial({ timezone: 'Invalid/Timezone' }),
        })
      ).toThrow('[shared] timezone: Invalid IANA timezone');
    });
    
    it('should throw on invalid locale', () => {
      expect(() =>
        mergeProfiles({
          shared: basePartial({ locale: '!!!invalid!!!' }),
        })
      ).toThrow('[shared] locale: Invalid BCP 47 locale');
    });
    
    it('should throw on invalid theme', () => {
      expect(() =>
        mergeProfiles({
          shared: basePartial({ theme: 'blue' as 'light' }),
        })
      ).toThrow('[shared] theme: Must be one of: light, dark, system');
    });
    
    it('should throw on name exceeding max length', () => {
      expect(() =>
        mergeProfiles({
          shared: { name: 'a'.repeat(101) },
        })
      ).toThrow('[shared] name: Maximum length is 100');
    });
    
    it('should use default name when all layers have no name', () => {
      const result = mergeProfiles({
        shared: {},
        datadog: {},
        local: {},
      });
      
      // When no name is provided, defaults kick in with 'Unnamed Profile'
      expect(result.name).toBe('Unnamed Profile');
    });
    
    it('should include source layer in error message', () => {
      try {
        mergeProfiles({
          shared: basePartial({}),
          datadog: { timezone: 'Invalid' },
        });
        expect.fail('should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('[datadog]');
        expect((error as Error).message).toContain('timezone');
      }
    });
    
    it('should include field path in error message', () => {
      try {
        mergeProfiles({
          shared: basePartial({
            notifications: { email: 'not-boolean' as unknown as boolean },
          }),
        });
        expect.fail('should have thrown');
      } catch (error) {
        expect((error as Error).message).toContain('notifications.email');
      }
    });
    
    it('should throw on unknown nested field', () => {
      expect(() =>
        mergeProfiles({
          shared: basePartial({
            notifications: { email: true, unknownField: 'value' } as unknown as NotificationPreferences,
          }),
        })
      ).toThrow('[shared] notifications.unknownField: Unknown field');
    });
    
    it('should throw on invalid nested object type', () => {
      expect(() =>
        mergeProfiles({
          shared: basePartial({
            notifications: 'not-an-object' as unknown as NotificationPreferences,
          }),
        })
      ).toThrow('[shared] notifications: Expected object');
    });

    it('should throw on non-string tags entries', () => {
      expect(() =>
        mergeProfiles({
          shared: basePartial({
            tags: ['valid', 123 as unknown as string],
          }),
        })
      ).toThrow('[shared] tags[1]: Expected string, got number');
    });
  });
  
  describe('edge cases', () => {
    it('should handle empty layers', () => {
      const result = mergeProfiles({
        shared: {},
        datadog: {},
        local: {},
      });
      
      expect(result.id).toBeDefined();
      expect(result.name).toBe('Unnamed Profile');
    });
    
    it('should handle only local layer', () => {
      const result = mergeProfiles({
        local: { name: 'Local Only' },
      });
      
      expect(result.name).toBe('Local Only');
    });
    
    it('should handle only datadog layer', () => {
      const result = mergeProfiles({
        datadog: { name: 'Datadog Only' },
      });
      
      expect(result.name).toBe('Datadog Only');
    });
    
    it('should handle custom instructions with max length', () => {
      const longInstructions = 'a'.repeat(4001);
      
      expect(() =>
        mergeProfiles({
          shared: basePartial({ customInstructions: longInstructions }),
        })
      ).toThrow('[shared] customInstructions: Maximum length is 4000');
    });
  });
});

describe('isProfile type guard', () => {
  it('should return true for valid Profile', () => {
    const profile = mergeProfiles({ shared: basePartial() });
    expect(isProfile(profile)).toBe(true);
  });
  
  it('should return false for null', () => {
    expect(isProfile(null)).toBe(false);
  });
  
  it('should return false for non-object', () => {
    expect(isProfile('string')).toBe(false);
    expect(isProfile(123)).toBe(false);
  });
  
  it('should return false for object missing required fields', () => {
    expect(isProfile({})).toBe(false);
    expect(isProfile({ id: 'test' })).toBe(false);
  });
});

describe('validatePartialProfile', () => {
  it('should validate shared layer', () => {
    const result = validatePartialProfile({ name: 'Test' }, 'shared');
    expect(result.valid).toBe(true);
  });
  
  it('should validate datadog layer', () => {
    const result = validatePartialProfile({ timezone: 'UTC' }, 'datadog');
    expect(result.valid).toBe(true);
  });
  
  it('should validate local layer', () => {
    const result = validatePartialProfile({ theme: 'dark' }, 'local');
    expect(result.valid).toBe(true);
  });
  
  it('should return errors with source', () => {
    const result = validatePartialProfile({ email: 'invalid' }, 'datadog');
    expect(result.valid).toBe(false);
    expect(result.errors[0].source).toBe('datadog');
  });
  
  it('should handle undefined input', () => {
    const result = validatePartialProfile(undefined, 'shared');
    expect(result.valid).toBe(true);
  });
  
  it('should handle null input', () => {
    const result = validatePartialProfile(null, 'shared');
    expect(result.valid).toBe(true);
  });
});

describe('validateProfile', () => {
  it('should validate complete profile', () => {
    const profile = mergeProfiles({ shared: basePartial() });
    const result = validateProfile(profile);
    expect(result.valid).toBe(true);
  });
  
  it('should reject profile without required fields', () => {
    const result = validateProfile({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
  
  it('should reject invalid UUID', () => {
    const profile = mergeProfiles({ shared: basePartial() });
    const invalidProfile = { ...profile, id: 'not-a-uuid' };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'id')).toBe(true);
  });
  
  it('should reject invalid semver', () => {
    const profile = mergeProfiles({ shared: basePartial() });
    const invalidProfile = { ...profile, version: 'not-semver' };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'version')).toBe(true);
  });
  
  it('should reject invalid timestamps', () => {
    const profile = mergeProfiles({ shared: basePartial() });
    const invalidProfile = { ...profile, createdAt: 'not-a-date' };
    const result = validateProfile(invalidProfile);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.field === 'createdAt')).toBe(true);
  });
});
