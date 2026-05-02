import { describe, expect, it, vi } from 'vitest';
import {
  isOnePasswordReference,
  resolveConfiguredAllowlistEntries,
  resolveConfiguredValue,
} from './secret-resolver.js';

describe('isOnePasswordReference', () => {
  it('detects 1Password references', () => {
    expect(isOnePasswordReference('op://Assistant/ITEM/field')).toBe(true);
    expect(isOnePasswordReference(' op://Assistant/ITEM/field ')).toBe(true);
  });

  it('returns false for non-reference values', () => {
    expect(isOnePasswordReference('plain-token')).toBe(false);
    expect(isOnePasswordReference('')).toBe(false);
  });
});

describe('resolveConfiguredValue', () => {
  it('returns undefined for undefined/empty values', () => {
    expect(resolveConfiguredValue(undefined, { fieldName: 'TOKEN' })).toBeUndefined();
    expect(resolveConfiguredValue('   ', { fieldName: 'TOKEN' })).toBeUndefined();
  });

  it('returns non-reference values unchanged (trimmed)', () => {
    expect(resolveConfiguredValue('  abc123  ', { fieldName: 'TOKEN' })).toBe('abc123');
  });

  it('resolves 1Password references using the provided reader', () => {
    const readReference = vi.fn((reference: string) => {
      expect(reference).toBe('op://Assistant/ITEM/field');
      return 'resolved-secret';
    });

    const result = resolveConfiguredValue('op://Assistant/ITEM/field', {
      fieldName: 'TOKEN',
      readReference,
    });

    expect(result).toBe('resolved-secret');
    expect(readReference).toHaveBeenCalledTimes(1);
  });

  it('throws a helpful error when a reference cannot be resolved', () => {
    const readReference = vi.fn(() => {
      throw new Error('access denied');
    });

    expect(() => resolveConfiguredValue('op://Assistant/ITEM/field', {
      fieldName: 'TOKEN',
      readReference,
    })).toThrow('TOKEN uses a 1Password reference but it could not be resolved: access denied');
  });
});

describe('resolveConfiguredAllowlistEntries', () => {
  it('resolves plain values and comma-separated entries', () => {
    const allowlist = resolveConfiguredAllowlistEntries([
      '123',
      '456,789',
      '   ',
      '100',
    ], { fieldName: 'ALLOWLIST' });

    expect([...allowlist]).toEqual(['123', '456', '789', '100']);
  });

  it('resolves references before parsing entries', () => {
    const readReference = vi.fn((reference: string) => {
      expect(reference).toBe('op://Assistant/TELEGRAM_BOT/TELEGRAM_CHAT_ID');
      return '111,222';
    });

    const allowlist = resolveConfiguredAllowlistEntries([
      'op://Assistant/TELEGRAM_BOT/TELEGRAM_CHAT_ID',
      '333',
    ], {
      fieldName: 'ALLOWLIST',
      readReference,
    });

    expect([...allowlist]).toEqual(['111', '222', '333']);
    expect(readReference).toHaveBeenCalledTimes(1);
  });
});
