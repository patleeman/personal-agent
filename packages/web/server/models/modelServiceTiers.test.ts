import { describe, expect, it } from 'vitest';
import {
  getSupportedServiceTiersForModel,
  modelSupportsServiceTier,
  modelSupportsServiceTiers,
  normalizeServiceTierValue,
} from './modelServiceTiers.js';

describe('modelServiceTiers', () => {
  it('normalizes known tier values', () => {
    expect(normalizeServiceTierValue('priority')).toBe('priority');
    expect(normalizeServiceTierValue('  PRIORITY  ')).toBe('priority');
    expect(normalizeServiceTierValue('invalid')).toBe('');
  });

  it('returns supported tiers from model definitions', () => {
    expect(getSupportedServiceTiersForModel({ id: 'gpt-5.4' })).toEqual(['priority']);
    expect(getSupportedServiceTiersForModel({ id: 'gpt-5.3-codex' })).toEqual(['priority']);
    expect(getSupportedServiceTiersForModel({ id: 'gpt-4o' })).toEqual([]);
  });

  it('checks tier support per model', () => {
    expect(modelSupportsServiceTiers({ id: 'gpt-5.4' })).toBe(true);
    expect(modelSupportsServiceTier({ id: 'gpt-5.4' }, 'priority')).toBe(true);
    expect(modelSupportsServiceTier({ id: 'gpt-5.4' }, 'auto')).toBe(false);
    expect(modelSupportsServiceTiers({ id: 'gpt-4o' })).toBe(false);
  });
});
