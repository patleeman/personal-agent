import type { DeferredResumeSummary } from '../shared/types';

export interface ConversationInitialModelPreferenceState {
  conversationId: string;
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  hasExplicitServiceTier: boolean;
}

export interface ConversationInitialDeferredResumeState {
  conversationId: string;
  resumes: DeferredResumeSummary[];
}

export interface ConversationDraftHydrationState {
  conversationId: string;
  enableAutoModeOnLoad?: boolean;
}

export interface ConversationLocationState {
  initialModelPreferenceState?: ConversationInitialModelPreferenceState;
  initialDeferredResumeState?: ConversationInitialDeferredResumeState;
  draftHydrationState?: ConversationDraftHydrationState;
}

export const DRAFT_SERVICE_TIER_DISABLED_SENTINEL = '__pa_draft_fast_mode_disabled__';

export function resolveDraftConversationServiceTierState(
  storedServiceTier: string,
  defaultServiceTier: string,
): { currentServiceTier: string; hasExplicitServiceTier: boolean } {
  const normalizedStoredServiceTier = storedServiceTier.trim();
  if (normalizedStoredServiceTier === DRAFT_SERVICE_TIER_DISABLED_SENTINEL) {
    return { currentServiceTier: '', hasExplicitServiceTier: true };
  }

  if (normalizedStoredServiceTier) {
    return { currentServiceTier: normalizedStoredServiceTier, hasExplicitServiceTier: true };
  }

  return {
    currentServiceTier: defaultServiceTier.trim(),
    hasExplicitServiceTier: false,
  };
}

export function buildConversationServiceTierPreferenceInput(input: {
  currentServiceTier: string;
  hasExplicitServiceTier: boolean;
}): { serviceTier?: string | null } {
  if (!input.hasExplicitServiceTier) {
    return {};
  }

  return { serviceTier: input.currentServiceTier.trim() || null };
}

export function resolveFastModeToggleServiceTier(input: {
  enableFastMode: boolean;
  defaultServiceTier: string;
}): string | null {
  if (input.enableFastMode) {
    return input.defaultServiceTier === 'priority' ? '' : 'priority';
  }

  return input.defaultServiceTier === 'priority' ? null : '';
}

export function buildConversationInitialModelPreferenceState(input: {
  conversationId: string;
  currentModel?: string;
  currentThinkingLevel?: string;
  currentServiceTier?: string;
  hasExplicitServiceTier?: boolean;
  defaultModel?: string;
  defaultThinkingLevel?: string;
  defaultServiceTier?: string;
}): ConversationInitialModelPreferenceState {
  const normalizedCurrentServiceTier = input.currentServiceTier?.trim() || '';
  const hasExplicitServiceTier = Boolean(input.hasExplicitServiceTier);

  return {
    conversationId: input.conversationId,
    currentModel: input.currentModel?.trim() || input.defaultModel?.trim() || '',
    currentThinkingLevel: input.currentThinkingLevel?.trim() || input.defaultThinkingLevel?.trim() || '',
    currentServiceTier: hasExplicitServiceTier
      ? normalizedCurrentServiceTier
      : normalizedCurrentServiceTier || input.defaultServiceTier?.trim() || '',
    hasExplicitServiceTier,
  };
}

export function resolveConversationInitialModelPreferenceState(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  locationState: unknown;
  defaultModel: string;
  defaultThinkingLevel: string;
  defaultServiceTier: string;
}): ConversationInitialModelPreferenceState | null {
  if (input.draft || !input.conversationId || !input.locationState || typeof input.locationState !== 'object') {
    return null;
  }

  const candidate = (input.locationState as ConversationLocationState).initialModelPreferenceState;
  if (!candidate || typeof candidate !== 'object' || candidate.conversationId !== input.conversationId) {
    return null;
  }

  return buildConversationInitialModelPreferenceState({
    conversationId: candidate.conversationId,
    currentModel: typeof candidate.currentModel === 'string' ? candidate.currentModel : '',
    currentThinkingLevel: typeof candidate.currentThinkingLevel === 'string' ? candidate.currentThinkingLevel : '',
    currentServiceTier: typeof candidate.currentServiceTier === 'string' ? candidate.currentServiceTier : '',
    hasExplicitServiceTier: typeof candidate.hasExplicitServiceTier === 'boolean' ? candidate.hasExplicitServiceTier : false,
    defaultModel: input.defaultModel,
    defaultThinkingLevel: input.defaultThinkingLevel,
    defaultServiceTier: input.defaultServiceTier,
  });
}

export function resolveConversationInitialDeferredResumeState(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  locationState: unknown;
}): DeferredResumeSummary[] | null {
  if (input.draft || !input.conversationId || !input.locationState || typeof input.locationState !== 'object') {
    return null;
  }

  const candidate = (input.locationState as ConversationLocationState).initialDeferredResumeState;
  if (!candidate || typeof candidate !== 'object' || candidate.conversationId !== input.conversationId) {
    return null;
  }

  return Array.isArray(candidate.resumes) ? candidate.resumes : [];
}

export function resolveConversationDraftHydrationState(input: {
  draft: boolean;
  conversationId: string | null | undefined;
  locationState: unknown;
}): ConversationDraftHydrationState | null {
  if (input.draft || !input.conversationId || !input.locationState || typeof input.locationState !== 'object') {
    return null;
  }

  const candidate = (input.locationState as ConversationLocationState).draftHydrationState;
  if (!candidate || typeof candidate !== 'object' || candidate.conversationId !== input.conversationId) {
    return null;
  }

  return {
    conversationId: candidate.conversationId,
    ...(candidate.enableAutoModeOnLoad === true ? { enableAutoModeOnLoad: true } : {}),
  };
}
