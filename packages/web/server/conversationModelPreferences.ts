import type { ThinkingLevel } from '@mariozechner/pi-agent-core';
import { type AgentSession, type SessionManager } from '@mariozechner/pi-coding-agent';
import { supportsXhigh, type Model } from '@mariozechner/pi-ai';

const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';
const THINKING_LEVELS: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high'];
const THINKING_LEVELS_WITH_XHIGH: ThinkingLevel[] = [...THINKING_LEVELS, 'xhigh'];

export interface ConversationModelPreferenceState {
  currentModel: string;
  currentThinkingLevel: string;
}

export interface ConversationModelPreferenceDefaults {
  currentModel?: string;
  currentThinkingLevel?: string;
}

export interface ConversationModelPreferenceInput {
  model?: string | null;
  thinkingLevel?: string | null;
}

export interface ConversationModelPreferenceSnapshot {
  currentModel: string;
  currentThinkingLevel: string;
  hasExplicitModel: boolean;
  hasExplicitThinkingLevel: boolean;
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

function buildResolvedState(
  snapshot: ConversationModelPreferenceSnapshot,
  defaults: ConversationModelPreferenceDefaults,
  models: Model<any>[],
): { currentModel: string; currentThinkingLevel: ThinkingLevel | ''; currentModelDefinition: Model<any> | null } {
  const fallbackModel = readNonEmptyString(defaults.currentModel);
  const currentModel = snapshot.currentModel || fallbackModel;
  const currentModelDefinition = resolveModelById(currentModel, models);
  const fallbackThinkingLevel = normalizeThinkingLevel(defaults.currentThinkingLevel);
  const currentThinkingLevel = snapshot.hasExplicitThinkingLevel
    ? normalizeThinkingLevel(snapshot.currentThinkingLevel)
    : fallbackThinkingLevel;

  return {
    currentModel,
    currentThinkingLevel,
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
  nextModel: Model<any> | null;
  shouldAppendModelChange: boolean;
  nextPersistedThinkingLevel: ThinkingLevel | null;
} {
  const resolved = buildResolvedState(snapshot, defaults, models);
  const requestedModel = input.model === undefined ? undefined : readNonEmptyString(input.model ?? '');
  const requestedThinkingLevel = input.thinkingLevel === undefined ? undefined : normalizeThinkingLevel(input.thinkingLevel ?? '');
  const requestedThinkingClearsToDefault = requestedThinkingLevel !== undefined && requestedThinkingLevel === '';

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

  return {
    currentModel,
    currentThinkingLevel: nextThinkingLevelForDisplay,
    nextModel,
    shouldAppendModelChange,
    nextPersistedThinkingLevel,
  };
}

export function readConversationModelPreferenceSnapshot(
  sessionManager: Pick<SessionManager, 'buildSessionContext' | 'getBranch'>,
): ConversationModelPreferenceSnapshot {
  const context = sessionManager.buildSessionContext();
  const branch = sessionManager.getBranch();

  return {
    currentModel: context.model?.modelId ?? '',
    currentThinkingLevel: context.thinkingLevel ?? '',
    hasExplicitModel: branch.some((entry) => entry.type === 'model_change'),
    hasExplicitThinkingLevel: branch.some((entry) => entry.type === 'thinking_level_change'),
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
  };
}

export function applyConversationModelPreferencesToSessionManager(
  sessionManager: Pick<SessionManager, 'appendModelChange' | 'appendThinkingLevelChange' | 'buildSessionContext' | 'getBranch'>,
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

  return {
    currentModel: next.currentModel,
    currentThinkingLevel: next.currentThinkingLevel,
  };
}

export function applyConversationModelPreferencesToLiveSession(
  session: Pick<AgentSession, 'agent' | 'sessionManager'>,
  input: ConversationModelPreferenceInput,
  defaults: ConversationModelPreferenceDefaults,
  models: Model<any>[],
): ConversationModelPreferenceState {
  const snapshot = readConversationModelPreferenceSnapshot(session.sessionManager);
  const next = computeNextConversationModelPreferences(snapshot, input, defaults, models);

  if (next.shouldAppendModelChange && next.nextModel) {
    session.agent.setModel(next.nextModel);
    session.sessionManager.appendModelChange(next.nextModel.provider, next.nextModel.id);
  }

  if (next.nextPersistedThinkingLevel) {
    session.agent.setThinkingLevel(next.nextPersistedThinkingLevel);
    session.sessionManager.appendThinkingLevelChange(next.nextPersistedThinkingLevel);
  }

  return {
    currentModel: next.currentModel,
    currentThinkingLevel: next.currentThinkingLevel,
  };
}
