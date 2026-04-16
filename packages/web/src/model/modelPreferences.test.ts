import { describe, expect, it } from 'vitest';
import { SERVICE_TIER_OPTIONS, THINKING_LEVEL_OPTIONS, getModelSelectableServiceTierOptions, getModelSupportedServiceTierOptions, groupModelsByProvider } from './modelPreferences';

describe('model preferences helpers', () => {
  it('exports the supported thinking levels in UI order', () => {
    expect(THINKING_LEVEL_OPTIONS.map((option) => option.value)).toEqual([
      '',
      'off',
      'low',
      'medium',
      'high',
      'xhigh',
    ]);
  });

  it('exports the supported service tiers in UI order', () => {
    expect(SERVICE_TIER_OPTIONS.map((option) => option.value)).toEqual([
      '',
      'auto',
      'default',
      'flex',
      'priority',
      'scale',
    ]);
  });

  it('filters service tier options to the tiers supported by the selected model', () => {
    expect(getModelSupportedServiceTierOptions({ supportedServiceTiers: ['priority', 'auto'] })).toEqual([
      { value: 'auto', label: 'Auto' },
      { value: 'priority', label: 'Priority' },
    ]);
    expect(getModelSupportedServiceTierOptions({ supportedServiceTiers: [] })).toEqual([]);
    expect(getModelSupportedServiceTierOptions(null)).toEqual([]);
  });

  it('builds selectable service tier options with an optional default choice', () => {
    expect(getModelSelectableServiceTierOptions({ supportedServiceTiers: ['priority', 'auto'] })).toEqual([
      { value: 'auto', label: 'Auto' },
      { value: 'priority', label: 'Priority' },
    ]);
    expect(getModelSelectableServiceTierOptions(
      { supportedServiceTiers: ['priority', 'auto'] },
      { includeDefaultOption: true },
    )).toEqual([
      { value: '', label: 'Default' },
      { value: 'auto', label: 'Auto' },
      { value: 'priority', label: 'Priority' },
    ]);
  });

  it('groups models by provider while preserving original order', () => {
    expect(groupModelsByProvider([
      { id: 'gpt-5.4', provider: 'openai', name: 'GPT-5.4', context: 272_000 },
      { id: 'claude-sonnet-4-6', provider: 'anthropic', name: 'Claude Sonnet 4.6', context: 200_000 },
      { id: 'gpt-5.5-mini', provider: 'openai', name: 'GPT-5.5 Mini', context: 128_000 },
    ])).toEqual([
      ['openai', [
        { id: 'gpt-5.4', provider: 'openai', name: 'GPT-5.4', context: 272_000 },
        { id: 'gpt-5.5-mini', provider: 'openai', name: 'GPT-5.5 Mini', context: 128_000 },
      ]],
      ['anthropic', [
        { id: 'claude-sonnet-4-6', provider: 'anthropic', name: 'Claude Sonnet 4.6', context: 200_000 },
      ]],
    ]);
  });
});
