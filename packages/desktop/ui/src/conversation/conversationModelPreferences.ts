import { DRAFT_SERVICE_TIER_DISABLED_SENTINEL, resolveFastModeToggleServiceTier } from './conversationInitialState';

export type DraftPreferenceStorageAction = { kind: 'clear' } | { kind: 'persist'; value: string };

export interface DraftModelPreferenceUpdate {
  storage: DraftPreferenceStorageAction;
  currentModel: string;
}

export interface DraftThinkingPreferenceUpdate {
  storage: DraftPreferenceStorageAction;
  currentThinkingLevel: string;
}

export interface DraftServiceTierPreferenceUpdate {
  storage: DraftPreferenceStorageAction;
  currentServiceTier: string;
  hasExplicitServiceTier: boolean;
  savedServiceTierLabel: string;
}

export function resolveDraftModelPreferenceUpdate(input: { modelId: string; defaultModel: string }): DraftModelPreferenceUpdate {
  return {
    storage: input.modelId === input.defaultModel ? { kind: 'clear' } : { kind: 'persist', value: input.modelId },
    currentModel: input.modelId,
  };
}

export function resolveDraftThinkingPreferenceUpdate(input: {
  thinkingLevel: string;
  defaultThinkingLevel: string;
}): DraftThinkingPreferenceUpdate {
  const currentThinkingLevel = input.thinkingLevel || input.defaultThinkingLevel;

  return {
    storage:
      !input.thinkingLevel || input.thinkingLevel === input.defaultThinkingLevel
        ? { kind: 'clear' }
        : { kind: 'persist', value: input.thinkingLevel },
    currentThinkingLevel,
  };
}

export function resolveDraftServiceTierPreferenceUpdate(input: {
  enableFastMode: boolean;
  defaultServiceTier: string;
}): DraftServiceTierPreferenceUpdate {
  const serviceTier = resolveFastModeToggleServiceTier(input);

  if (serviceTier === null) {
    return {
      storage: { kind: 'persist', value: DRAFT_SERVICE_TIER_DISABLED_SENTINEL },
      currentServiceTier: '',
      hasExplicitServiceTier: true,
      savedServiceTierLabel: '',
    };
  }

  if (!serviceTier || serviceTier === input.defaultServiceTier) {
    return {
      storage: { kind: 'clear' },
      currentServiceTier: serviceTier || input.defaultServiceTier,
      hasExplicitServiceTier: false,
      savedServiceTierLabel: input.enableFastMode ? 'priority' : '',
    };
  }

  return {
    storage: { kind: 'persist', value: serviceTier },
    currentServiceTier: serviceTier,
    hasExplicitServiceTier: true,
    savedServiceTierLabel: input.enableFastMode ? 'priority' : '',
  };
}
