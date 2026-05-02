import { describe, expect, it } from 'vitest';
import { DRAFT_SERVICE_TIER_DISABLED_SENTINEL } from './conversationInitialState';
import {
  resolveDraftModelPreferenceUpdate,
  resolveDraftServiceTierPreferenceUpdate,
  resolveDraftThinkingPreferenceUpdate,
} from './conversationModelPreferences';

describe('conversationModelPreferences', () => {
  it('clears draft model storage when selecting the default model', () => {
    expect(resolveDraftModelPreferenceUpdate({ modelId: 'default-model', defaultModel: 'default-model' })).toEqual({
      storage: { kind: 'clear' },
      currentModel: 'default-model',
    });
  });

  it('persists draft model storage when selecting a non-default model', () => {
    expect(resolveDraftModelPreferenceUpdate({ modelId: 'claude', defaultModel: 'default-model' })).toEqual({
      storage: { kind: 'persist', value: 'claude' },
      currentModel: 'claude',
    });
  });

  it('normalizes draft thinking level selection against the default', () => {
    expect(resolveDraftThinkingPreferenceUpdate({ thinkingLevel: '', defaultThinkingLevel: 'medium' })).toEqual({
      storage: { kind: 'clear' },
      currentThinkingLevel: 'medium',
    });
    expect(resolveDraftThinkingPreferenceUpdate({ thinkingLevel: 'high', defaultThinkingLevel: 'medium' })).toEqual({
      storage: { kind: 'persist', value: 'high' },
      currentThinkingLevel: 'high',
    });
  });

  it('persists the disabled sentinel when fast mode is explicitly disabled over a priority default', () => {
    expect(resolveDraftServiceTierPreferenceUpdate({ enableFastMode: false, defaultServiceTier: 'priority' })).toEqual({
      storage: { kind: 'persist', value: DRAFT_SERVICE_TIER_DISABLED_SENTINEL },
      currentServiceTier: '',
      hasExplicitServiceTier: true,
      savedServiceTierLabel: '',
    });
  });

  it('clears draft service tier storage when the toggle matches the default', () => {
    expect(resolveDraftServiceTierPreferenceUpdate({ enableFastMode: true, defaultServiceTier: 'priority' })).toEqual({
      storage: { kind: 'clear' },
      currentServiceTier: 'priority',
      hasExplicitServiceTier: false,
      savedServiceTierLabel: 'priority',
    });
    expect(resolveDraftServiceTierPreferenceUpdate({ enableFastMode: false, defaultServiceTier: '' })).toEqual({
      storage: { kind: 'clear' },
      currentServiceTier: '',
      hasExplicitServiceTier: false,
      savedServiceTierLabel: '',
    });
  });

  it('persists priority when enabling fast mode over a non-priority default', () => {
    expect(resolveDraftServiceTierPreferenceUpdate({ enableFastMode: true, defaultServiceTier: '' })).toEqual({
      storage: { kind: 'persist', value: 'priority' },
      currentServiceTier: 'priority',
      hasExplicitServiceTier: true,
      savedServiceTierLabel: 'priority',
    });
  });
});
