import { describe, expect, it } from 'vitest';
import { THINKING_LEVEL_OPTIONS, getModelSelectableServiceTierOptions, groupModelsByProvider } from './modelPreferences';

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

  it('builds service tier options in UI order from the tiers supported by the selected model', () => {
    expect(getModelSelectableServiceTierOptions(
      { supportedServiceTiers: ['scale', 'priority', 'auto', 'default', 'flex'] },
      { includeDefaultOption: true },
    )).toEqual([
      { value: '', label: 'Default' },
      { value: 'auto', label: 'Auto' },
      { value: 'default', label: 'Default' },
      { value: 'flex', label: 'Flex' },
      { value: 'priority', label: 'Priority' },
      { value: 'scale', label: 'Scale' },
    ]);
    expect(getModelSelectableServiceTierOptions({ supportedServiceTiers: [] })).toEqual([]);
    expect(getModelSelectableServiceTierOptions(null)).toEqual([]);
  });

  it('builds selectable service tier options with an unset or default choice', () => {
    expect(getModelSelectableServiceTierOptions({ supportedServiceTiers: ['priority', 'auto'] })).toEqual([
      { value: '', label: 'Unset' },
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
