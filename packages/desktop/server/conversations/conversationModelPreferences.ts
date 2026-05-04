import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import { type Api, getSupportedThinkingLevels, type Model } from '@mariozechner/pi-ai';
import { type AgentSession, type SessionManager } from '@mariozechner/pi-coding-agent';

import {
  getSupportedServiceTiersForModel,
  modelSupportsServiceTier,
  normalizeServiceTierValue,
  type ServiceTierValue,
} from '../models/modelServiceTiers.js';

const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';
type ServiceTier = ServiceTierValue;
type ServiceTierOverride = ServiceTier | '' | null;
const SERVICE_TIER_CUSTOM_TYPE = 'conversation-service-tier';

export interface ConversationModelPreferenceState {
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  hasExplicitServiceTier: boolean;
}

export interface ConversationModelPreferenceDefaults {
  currentModel?: string;
  currentThinkingLevel?: string;
  currentServiceTier?: string;
}

export interface ConversationModelPreferenceInput {
  model?: string | null;
  thinkingLevel?: string | null;
  serviceTier?: string | null;
}

export interface ConversationModelPreferenceSnapshot {
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  hasExplicitModel: boolean;
  hasExplicitThinkingLevel: boolean;
  hasExplicitServiceTier: boolean;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function normalizeThinkingLevel(value: unknown): ThinkingLevel | '' {
  const normalized = readNonEmptyString(value).toLowerCase();
  switch (normalized) {
    case 'off':
    case 'minimal':
    case 'low':
    case 'medium':
    case 'high':
    case 'xhigh':
      return normalized;
    default:
      return '';
  }
}

function normalizeServiceTier(value: unknown): ServiceTier | '' {
  return normalizeServiceTierValue(value);
}

function clampServiceTier(serviceTier: ServiceTier | '', model: Pick<Model<Api>, 'id'> | null | undefined): ServiceTier | '' {
  if (!serviceTier) {
    return '';
  }

  if (!model) {
    return serviceTier;
  }

  return modelSupportsServiceTier(model, serviceTier) ? serviceTier : '';
}

function getAvailableThinkingLevels(model: Model<Api> | null | undefined): ThinkingLevel[] {
  if (!model?.reasoning) {
    return ['off'];
  }

  return getSupportedThinkingLevels(model) as ThinkingLevel[];
}

function clampThinkingLevel(level: ThinkingLevel | '', model: Model<Api> | null | undefined): ThinkingLevel {
  const availableLevels = getAvailableThinkingLevels(model);
  if (!level) {
    return availableLevels.includes(DEFAULT_THINKING_LEVEL)
      ? DEFAULT_THINKING_LEVEL
      : (availableLevels[availableLevels.length - 1] ?? 'off');
  }

  if (availableLevels.includes(level)) {
    return level;
  }

  return availableLevels[availableLevels.length - 1] ?? 'off';
}

export function modelSupportsServiceTiers(model: Pick<Model<Api>, 'id'> | null | undefined): boolean {
  return getSupportedServiceTiersForModel(model).length > 0;
}

function resolveModelById(modelId: string, models: Model<Api>[]): Model<Api> | null {
  if (!modelId) {
    return null;
  }

  const exactMatch = models.find((candidate) => candidate.id === modelId);
  if (exactMatch) {
    return exactMatch;
  }

  const slashIndex = modelId.indexOf('/');
  if (slashIndex > 0 && slashIndex < modelId.length - 1) {
    const provider = modelId.slice(0, slashIndex);
    const id = modelId.slice(slashIndex + 1);
    return models.find((candidate) => candidate.provider === provider && candidate.id === id) ?? null;
  }

  return null;
}

function readServiceTierOverride(branch: Array<{ type: string; customType?: string; data?: unknown }>): {
  currentServiceTier: string;
  hasExplicitServiceTier: boolean;
} {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!entry || entry.type !== 'custom' || entry.customType !== SERVICE_TIER_CUSTOM_TYPE) {
      continue;
    }

    const data = entry.data as { serviceTier?: unknown } | undefined;
    if (data?.serviceTier === null) {
      return { currentServiceTier: '', hasExplicitServiceTier: true };
    }

    const serviceTier = normalizeServiceTier(data?.serviceTier);
    if (serviceTier) {
      return { currentServiceTier: serviceTier, hasExplicitServiceTier: true };
    }

    return { currentServiceTier: '', hasExplicitServiceTier: false };
  }

  return { currentServiceTier: '', hasExplicitServiceTier: false };
}

function buildResolvedState(
  snapshot: ConversationModelPreferenceSnapshot,
  defaults: ConversationModelPreferenceDefaults,
  models: Model<Api>[],
): {
  currentModel: string;
  currentThinkingLevel: ThinkingLevel | '';
  currentServiceTier: ServiceTier | '';
  currentModelDefinition: Model<Api> | null;
} {
  const fallbackModel = readNonEmptyString(defaults.currentModel);
  const currentModel = snapshot.currentModel || fallbackModel;
  const currentModelDefinition = resolveModelById(currentModel, models);
  const fallbackThinkingLevel = normalizeThinkingLevel(defaults.currentThinkingLevel);
  const fallbackServiceTier = clampServiceTier(normalizeServiceTier(defaults.currentServiceTier), currentModelDefinition);
  const currentThinkingLevel = snapshot.hasExplicitThinkingLevel
    ? normalizeThinkingLevel(snapshot.currentThinkingLevel)
    : fallbackThinkingLevel;
  const currentServiceTier = snapshot.hasExplicitServiceTier
    ? clampServiceTier(normalizeServiceTier(snapshot.currentServiceTier), currentModelDefinition)
    : fallbackServiceTier;

  return {
    currentModel,
    currentThinkingLevel,
    currentServiceTier,
    currentModelDefinition,
  };
}

function computeNextConversationModelPreferences(
  snapshot: ConversationModelPreferenceSnapshot,
  input: ConversationModelPreferenceInput,
  defaults: ConversationModelPreferenceDefaults,
  models: Model<Api>[],
): {
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  hasExplicitServiceTier: boolean;
  nextModel: Model<Api> | null;
  shouldAppendModelChange: boolean;
  nextPersistedThinkingLevel: ThinkingLevel | null;
  nextServiceTierOverride: ServiceTierOverride | undefined;
} {
  const resolved = buildResolvedState(snapshot, defaults, models);
  const requestedModel = input.model === undefined ? undefined : readNonEmptyString(input.model ?? '');
  const requestedThinkingLevel = input.thinkingLevel === undefined ? undefined : normalizeThinkingLevel(input.thinkingLevel ?? '');
  const requestedThinkingClearsToDefault = requestedThinkingLevel !== undefined && requestedThinkingLevel === '';
  const requestedServiceTier =
    input.serviceTier === undefined || input.serviceTier === null ? input.serviceTier : normalizeServiceTier(input.serviceTier);
  const requestedServiceTierClearsToDefault =
    requestedServiceTier !== undefined && requestedServiceTier !== null && requestedServiceTier === '';
  const requestedServiceTierDisables = requestedServiceTier === null;

  if (requestedModel !== undefined && !requestedModel) {
    throw new Error('model required');
  }

  const nextModel = requestedModel !== undefined ? resolveModelById(requestedModel, models) : resolved.currentModelDefinition;

  if (requestedModel !== undefined && !nextModel) {
    throw new Error(`Unknown model: ${requestedModel}`);
  }

  const currentModel = nextModel?.id ?? resolved.currentModel;
  const shouldAppendModelChange = requestedModel !== undefined && currentModel !== resolved.currentModel;

  let nextThinkingLevelForDisplay = resolved.currentThinkingLevel;
  let nextPersistedThinkingLevel: ThinkingLevel | null = null;

  if (requestedThinkingLevel !== undefined) {
    const fallbackThinkingLevel = normalizeThinkingLevel(defaults.currentThinkingLevel);
    const desiredThinkingLevel = requestedThinkingLevel || fallbackThinkingLevel || DEFAULT_THINKING_LEVEL;
    const effectiveThinkingLevel = clampThinkingLevel(desiredThinkingLevel, nextModel);
    nextThinkingLevelForDisplay = effectiveThinkingLevel;

    if (
      effectiveThinkingLevel !== resolved.currentThinkingLevel ||
      (requestedThinkingClearsToDefault && snapshot.hasExplicitThinkingLevel)
    ) {
      nextPersistedThinkingLevel = effectiveThinkingLevel;
    }
  } else if (shouldAppendModelChange && resolved.currentThinkingLevel) {
    const effectiveThinkingLevel = clampThinkingLevel(resolved.currentThinkingLevel, nextModel);
    nextThinkingLevelForDisplay = effectiveThinkingLevel;
    if (effectiveThinkingLevel !== resolved.currentThinkingLevel) {
      nextPersistedThinkingLevel = effectiveThinkingLevel;
    }
  }

  let nextServiceTierForDisplay = resolved.currentServiceTier;
  let nextServiceTierOverride: ServiceTierOverride | undefined;

  if (requestedServiceTierDisables) {
    nextServiceTierForDisplay = '';
    if (!snapshot.hasExplicitServiceTier || resolved.currentServiceTier !== '') {
      nextServiceTierOverride = null;
    }
  } else if (requestedServiceTier !== undefined) {
    const fallbackServiceTier = clampServiceTier(normalizeServiceTier(defaults.currentServiceTier), nextModel);
    const effectiveServiceTier = clampServiceTier(requestedServiceTier || fallbackServiceTier, nextModel);
    nextServiceTierForDisplay = effectiveServiceTier;

    if (requestedServiceTier) {
      if (!effectiveServiceTier) {
        if (snapshot.hasExplicitServiceTier) {
          nextServiceTierOverride = '';
        }
      } else if (effectiveServiceTier !== resolved.currentServiceTier || !snapshot.hasExplicitServiceTier) {
        nextServiceTierOverride = effectiveServiceTier;
      }
    } else if (requestedServiceTierClearsToDefault && snapshot.hasExplicitServiceTier) {
      nextServiceTierOverride = '';
    }
  } else if (shouldAppendModelChange) {
    const fallbackServiceTier = clampServiceTier(normalizeServiceTier(defaults.currentServiceTier), nextModel);
    const effectiveServiceTier = snapshot.hasExplicitServiceTier
      ? clampServiceTier(normalizeServiceTier(snapshot.currentServiceTier), nextModel)
      : clampServiceTier(resolved.currentServiceTier || fallbackServiceTier, nextModel);
    nextServiceTierForDisplay = effectiveServiceTier;

    if (snapshot.hasExplicitServiceTier && effectiveServiceTier !== resolved.currentServiceTier) {
      nextServiceTierOverride = effectiveServiceTier || '';
    }
  }

  return {
    currentModel,
    currentThinkingLevel: nextThinkingLevelForDisplay,
    currentServiceTier: nextServiceTierForDisplay,
    hasExplicitServiceTier: nextServiceTierOverride === undefined ? snapshot.hasExplicitServiceTier : nextServiceTierOverride !== '',
    nextModel,
    shouldAppendModelChange,
    nextPersistedThinkingLevel,
    nextServiceTierOverride,
  };
}

export function readConversationModelPreferenceSnapshot(
  sessionManager: Pick<SessionManager, 'buildSessionContext' | 'getBranch'>,
): ConversationModelPreferenceSnapshot {
  const context = sessionManager.buildSessionContext();
  const branch = sessionManager.getBranch();
  const serviceTier = readServiceTierOverride(branch);

  return {
    currentModel: context.model?.modelId ?? '',
    currentThinkingLevel: context.thinkingLevel ?? '',
    currentServiceTier: serviceTier.currentServiceTier,
    hasExplicitModel: branch.some((entry) => entry.type === 'model_change'),
    hasExplicitThinkingLevel: branch.some((entry) => entry.type === 'thinking_level_change'),
    hasExplicitServiceTier: serviceTier.hasExplicitServiceTier,
  };
}

export function resolveConversationModelPreferenceState(
  snapshot: ConversationModelPreferenceSnapshot,
  defaults: ConversationModelPreferenceDefaults,
  models: Model<Api>[],
): ConversationModelPreferenceState {
  const resolved = buildResolvedState(snapshot, defaults, models);
  return {
    currentModel: resolved.currentModel,
    currentThinkingLevel: resolved.currentThinkingLevel,
    currentServiceTier: resolved.currentServiceTier,
    hasExplicitServiceTier: snapshot.hasExplicitServiceTier,
  };
}

function appendConversationServiceTierOverride(
  sessionManager: Pick<SessionManager, 'appendCustomEntry'>,
  serviceTier: ServiceTierOverride,
): void {
  sessionManager.appendCustomEntry(SERVICE_TIER_CUSTOM_TYPE, { serviceTier });
}

export function applyConversationModelPreferencesToSessionManager(
  sessionManager: Pick<
    SessionManager,
    'appendCustomEntry' | 'appendModelChange' | 'appendThinkingLevelChange' | 'buildSessionContext' | 'getBranch'
  >,
  input: ConversationModelPreferenceInput,
  defaults: ConversationModelPreferenceDefaults,
  models: Model<Api>[],
): ConversationModelPreferenceState {
  const snapshot = readConversationModelPreferenceSnapshot(sessionManager);
  const next = computeNextConversationModelPreferences(snapshot, input, defaults, models);

  if (next.shouldAppendModelChange && next.nextModel) {
    sessionManager.appendModelChange(next.nextModel.provider, next.nextModel.id);
  }

  if (next.nextPersistedThinkingLevel) {
    sessionManager.appendThinkingLevelChange(next.nextPersistedThinkingLevel);
  }

  if (next.nextServiceTierOverride !== undefined) {
    appendConversationServiceTierOverride(sessionManager, next.nextServiceTierOverride);
  }

  return {
    currentModel: next.currentModel,
    currentThinkingLevel: next.currentThinkingLevel,
    currentServiceTier: next.currentServiceTier,
    hasExplicitServiceTier: next.hasExplicitServiceTier,
  };
}

export async function applyConversationModelPreferencesToLiveSession(
  session: Pick<AgentSession, 'setModel' | 'setThinkingLevel' | 'sessionManager'>,
  input: ConversationModelPreferenceInput,
  defaults: ConversationModelPreferenceDefaults,
  models: Model<Api>[],
): Promise<ConversationModelPreferenceState> {
  const snapshot = readConversationModelPreferenceSnapshot(session.sessionManager);
  const next = computeNextConversationModelPreferences(snapshot, input, defaults, models);

  if (next.shouldAppendModelChange && next.nextModel) {
    await session.setModel(next.nextModel);
    session.sessionManager.appendModelChange(next.nextModel.provider, next.nextModel.id);
  }

  if (next.nextPersistedThinkingLevel) {
    session.setThinkingLevel(next.nextPersistedThinkingLevel);
    session.sessionManager.appendThinkingLevelChange(next.nextPersistedThinkingLevel);
  }

  if (next.nextServiceTierOverride !== undefined) {
    appendConversationServiceTierOverride(session.sessionManager, next.nextServiceTierOverride);
  }

  return {
    currentModel: next.currentModel,
    currentThinkingLevel: next.currentThinkingLevel,
    currentServiceTier: next.currentServiceTier,
    hasExplicitServiceTier: next.hasExplicitServiceTier,
  };
}
