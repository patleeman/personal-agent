import { describe, expect, it } from 'vitest';
import {
  DRAFT_SERVICE_TIER_DISABLED_SENTINEL,
  buildConversationInitialModelPreferenceState,
  buildConversationServiceTierPreferenceInput,
  resolveConversationDraftHydrationState,
  resolveConversationInitialDeferredResumeState,
  resolveConversationInitialModelPreferenceState,
  resolveDraftConversationServiceTierState,
  resolveFastModeToggleServiceTier,
} from './conversationInitialState';

describe('conversation initial state helpers', () => {
  it('resolves draft service-tier persistence without confusing default priority for an explicit choice', () => {
    expect(resolveDraftConversationServiceTierState('', 'priority')).toEqual({
      currentServiceTier: 'priority',
      hasExplicitServiceTier: false,
    });

    expect(resolveDraftConversationServiceTierState('standard', 'priority')).toEqual({
      currentServiceTier: 'standard',
      hasExplicitServiceTier: true,
    });

    expect(resolveDraftConversationServiceTierState(DRAFT_SERVICE_TIER_DISABLED_SENTINEL, 'priority')).toEqual({
      currentServiceTier: '',
      hasExplicitServiceTier: true,
    });
  });

  it('only persists service tier when the user made an explicit choice', () => {
    expect(buildConversationServiceTierPreferenceInput({
      currentServiceTier: 'priority',
      hasExplicitServiceTier: false,
    })).toEqual({});

    expect(buildConversationServiceTierPreferenceInput({
      currentServiceTier: 'priority',
      hasExplicitServiceTier: true,
    })).toEqual({ serviceTier: 'priority' });

    expect(buildConversationServiceTierPreferenceInput({
      currentServiceTier: '',
      hasExplicitServiceTier: true,
    })).toEqual({ serviceTier: null });
  });

  it('turns fast-mode toggles into the persisted service-tier override', () => {
    expect(resolveFastModeToggleServiceTier({ enableFastMode: true, defaultServiceTier: '' })).toBe('priority');
    expect(resolveFastModeToggleServiceTier({ enableFastMode: true, defaultServiceTier: 'priority' })).toBe('');
    expect(resolveFastModeToggleServiceTier({ enableFastMode: false, defaultServiceTier: 'priority' })).toBeNull();
    expect(resolveFastModeToggleServiceTier({ enableFastMode: false, defaultServiceTier: '' })).toBe('');
  });

  it('normalizes initial model preference state with defaults', () => {
    expect(buildConversationInitialModelPreferenceState({
      conversationId: 'conv-1',
      currentModel: '',
      currentThinkingLevel: ' high ',
      currentServiceTier: '',
      hasExplicitServiceTier: false,
      defaultModel: ' default-model ',
      defaultThinkingLevel: 'medium',
      defaultServiceTier: 'priority',
    })).toEqual({
      conversationId: 'conv-1',
      currentModel: 'default-model',
      currentThinkingLevel: 'high',
      currentServiceTier: 'priority',
      hasExplicitServiceTier: false,
    });
  });

  it('accepts initial model preference state only for the active saved conversation', () => {
    const locationState = {
      initialModelPreferenceState: {
        conversationId: 'conv-1',
        currentModel: 'model-a',
        currentThinkingLevel: 'low',
        currentServiceTier: 'priority',
        hasExplicitServiceTier: true,
      },
    };

    expect(resolveConversationInitialModelPreferenceState({
      draft: false,
      conversationId: 'conv-1',
      locationState,
      defaultModel: 'model-default',
      defaultThinkingLevel: 'medium',
      defaultServiceTier: '',
    })).toEqual(locationState.initialModelPreferenceState);

    expect(resolveConversationInitialModelPreferenceState({
      draft: true,
      conversationId: 'conv-1',
      locationState,
      defaultModel: 'model-default',
      defaultThinkingLevel: 'medium',
      defaultServiceTier: '',
    })).toBeNull();

    expect(resolveConversationInitialModelPreferenceState({
      draft: false,
      conversationId: 'conv-2',
      locationState,
      defaultModel: 'model-default',
      defaultThinkingLevel: 'medium',
      defaultServiceTier: '',
    })).toBeNull();
  });

  it('accepts initial deferred-resume and draft-hydration state only for the active saved conversation', () => {
    const resumes = [{ id: 'resume-1', status: 'scheduled', dueAt: '2026-05-01T12:00:00.000Z' }];
    const locationState = {
      initialDeferredResumeState: { conversationId: 'conv-1', resumes },
      draftHydrationState: { conversationId: 'conv-1', enableAutoModeOnLoad: true },
    };

    expect(resolveConversationInitialDeferredResumeState({
      draft: false,
      conversationId: 'conv-1',
      locationState,
    })).toBe(resumes);

    expect(resolveConversationDraftHydrationState({
      draft: false,
      conversationId: 'conv-1',
      locationState,
    })).toEqual({ conversationId: 'conv-1', enableAutoModeOnLoad: true });

    expect(resolveConversationInitialDeferredResumeState({
      draft: false,
      conversationId: 'conv-2',
      locationState,
    })).toBeNull();

    expect(resolveConversationDraftHydrationState({
      draft: true,
      conversationId: 'conv-1',
      locationState,
    })).toBeNull();
  });
});
