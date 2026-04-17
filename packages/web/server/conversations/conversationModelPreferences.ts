import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import { type AgentSession, type SessionManager } from '@mariozechner/pi-coding-agent';
import { supportsXhigh, type Model } from '@mariozechner/pi-ai';
import {
  getSupportedServiceTiersForModel,
  modelSupportsServiceTier,
  normalizeServiceTierValue,
  type ServiceTierValue,
} from '../models/modelServiceTiers.js';

const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';
const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];
const THINKING_LEVELS_WITH_XHIGH: ThinkingLevel[] = [...THINKING_LEVELS, 'xhigh'];
type ServiceTier = ServiceTierValue;
const SERVICE_TIER_CUSTOM_TYPE = 'conversation-service-tier';

export interface ConversationModelPreferenceState {
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
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

function clampServiceTier(
  serviceTier: ServiceTier | '',
  model: Pick<Model<any>, 'id'> | null | undefined,
): ServiceTier | '' {
  if (!serviceTier) {
    return '';
  }

  if (!model) {
    return serviceTier;
  }

  return modelSupportsServiceTier(model, serviceTier) ? serviceTier : '';
}

function getAvailableThinkingLevels(model: Model<any> | null | undefined): ThinkingLevel[] {
  if (!model?.reasoning) {
    return ['off'];
  }

  return supportsXhigh(model) ? THINKING_LEVELS_WITH_XHIGH : THINKING_LEVELS;
}

function clampThinkingLevel(level: ThinkingLevel | '', model: Model<any> | null | undefined): ThinkingLevel {
  const availableLevels = getAvailableThinkingLevels(model);
  if (!level) {
    return availableLevels.includes(DEFAULT_THINKING_LEVEL) ? DEFAULT_THINKING_LEVEL : availableLevels[availableLevels.length - 1] ?? 'off';
  }

  if (availableLevels.includes(level)) {
    return level;
  }

  return availableLevels[availableLevels.length - 1] ?? 'off';
}

export function modelSupportsServiceTiers(model: Pick<Model<any>, 'id'> | null | undefined): boolean {
  return getSupportedServiceTiersForModel(model).length > 0;
}

function resolveModelById(modelId: string, models: Model<any>[]): Model<any> | null {
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

function readServiceTierOverride(
  branch: Array<{ type: string; customType?: string; data?: unknown }>,
): { currentServiceTier: string; hasExplicitServiceTier: boolean } {
  for (let index = branch.length - 1; index >= 0; index -= 1) {
    const entry = branch[index];
    if (!entry || entry.type !== 'custom' || entry.customType !== SERVICE_TIER_CUSTOM_TYPE) {
      continue;
    }

    const data = entry.data as { serviceTier?: unknown } | undefined;
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
  models: Model<any>[],
): {
  currentModel: string;
  currentThinkingLevel: ThinkingLevel | '';
  currentServiceTier: ServiceTier | '';
  currentModelDefinition: Model<any> | null;
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
  models: Model<any>[],
): {
  currentModel: string;
  currentThinkingLevel: string;
  currentServiceTier: string;
  nextModel: Model<any> | null;
  shouldAppendModelChange: boolean;
  nextPersistedThinkingLevel: ThinkingLevel | null;
  nextServiceTierOverride: ServiceTier | null | undefined;
} {
  const resolved = buildResolvedState(snapshot, defaults, models);
  const requestedModel = input.model === undefined ? undefined : readNonEmptyString(input.model ?? '');
  const requestedThinkingLevel = input.thinkingLevel === undefined ? undefined : normalizeThinkingLevel(input.thinkingLevel ?? '');
  const requestedThinkingClearsToDefault = requestedThinkingLevel !== undefined && requestedThinkingLevel === '';
  const requestedServiceTier = input.serviceTier === undefined ? undefined : normalizeServiceTier(input.serviceTier ?? '');
  const requestedServiceTierClearsToDefault = requestedServiceTier !== undefined && requestedServiceTier === '';

  if (requestedModel !== undefined && !requestedModel) {
    throw new Error('model required');
  }

  const nextModel = requestedModel !== undefined
    ? resolveModelById(requestedModel, models)
    : resolved.currentModelDefinition;

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

    if (effectiveThinkingLevel !== resolved.currentThinkingLevel || (requestedThinkingClearsToDefault && snapshot.hasExplicitThinkingLevel)) {
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
  let nextServiceTierOverride: ServiceTier | null | undefined;

  if (requestedServiceTier !== undefined) {
    const fallbackServiceTier = clampServiceTier(normalizeServiceTier(defaults.currentServiceTier), nextModel);
    const effectiveServiceTier = clampServiceTier(requestedServiceTier || fallbackServiceTier, nextModel);
    nextServiceTierForDisplay = effectiveServiceTier;

    if (requestedServiceTier) {
      if (!effectiveServiceTier) {
        if (snapshot.hasExplicitServiceTier) {
          nextServiceTierOverride = null;
        }
      } else if (effectiveServiceTier !== resolved.currentServiceTier || !snapshot.hasExplicitServiceTier) {
        nextServiceTierOverride = effectiveServiceTier;
      }
    } else if (requestedServiceTierClearsToDefault && snapshot.hasExplicitServiceTier) {
      nextServiceTierOverride = null;
    }
  } else if (shouldAppendModelChange) {
    const fallbackServiceTier = clampServiceTier(normalizeServiceTier(defaults.currentServiceTier), nextModel);
    const effectiveServiceTier = clampServiceTier(resolved.currentServiceTier || fallbackServiceTier, nextModel);
    nextServiceTierForDisplay = effectiveServiceTier;

    if (snapshot.hasExplicitServiceTier && effectiveServiceTier !== resolved.currentServiceTier) {
      nextServiceTierOverride = effectiveServiceTier || null;
    }
  }

  return {
    currentModel,
    currentThinkingLevel: nextThinkingLevelForDisplay,
    currentServiceTier: nextServiceTierForDisplay,
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
  models: Model<any>[],
): ConversationModelPreferenceState {
  const resolved = buildResolvedState(snapshot, defaults, models);
  return {
    currentModel: resolved.currentModel,
    currentThinkingLevel: resolved.currentThinkingLevel,
    currentServiceTier: resolved.currentServiceTier,
  };
}

function appendConversationServiceTierOverride(
  sessionManager: Pick<SessionManager, 'appendCustomEntry'>,
  serviceTier: ServiceTier | null,
): void {
  sessionManager.appendCustomEntry(SERVICE_TIER_CUSTOM_TYPE, { serviceTier });
}

export function applyConversationModelPreferencesToSessionManager(
  sessionManager: Pick<SessionManager, 'appendCustomEntry' | 'appendModelChange' | 'appendThinkingLevelChange' | 'buildSessionContext' | 'getBranch'>,
  input: ConversationModelPreferenceInput,
  defaults: ConversationModelPreferenceDefaults,
  models: Model<any>[],
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
  };
}

export async function applyConversationModelPreferencesToLiveSession(
  session: Pick<AgentSession, 'setModel' | 'setThinkingLevel' | 'sessionManager'>,
  input: ConversationModelPreferenceInput,
  defaults: ConversationModelPreferenceDefaults,
  models: Model<any>[],
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
  };
}
