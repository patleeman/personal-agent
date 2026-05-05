import type { ModelInfo } from '../shared/types';

function normalizeModelId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export const THINKING_LEVEL_OPTIONS = [
  { value: '', label: 'Unset' },
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
] as const;

export function getModelThinkingLevelOptions(model: Pick<ModelInfo, 'reasoning'> | null | undefined) {
  if (!model?.reasoning) {
    // Non-reasoning models only support Off
    return THINKING_LEVEL_OPTIONS.filter((opt) => opt.value === '' || opt.value === 'off');
  }
  // Reasoning models support all levels — the Pi AI layer clamps invalid ones server-side
  return THINKING_LEVEL_OPTIONS;
}

const SERVICE_TIER_OPTIONS = [
  { value: '', label: 'Unset' },
  { value: 'auto', label: 'Auto' },
  { value: 'default', label: 'Default' },
  { value: 'flex', label: 'Flex' },
  { value: 'priority', label: 'Priority' },
  { value: 'scale', label: 'Scale' },
] as const;

function getModelSupportedServiceTierOptions(model: Pick<ModelInfo, 'supportedServiceTiers'> | null | undefined) {
  const supportedTiers = Array.isArray(model?.supportedServiceTiers) ? model.supportedServiceTiers : [];
  if (supportedTiers.length === 0) {
    return [];
  }

  return SERVICE_TIER_OPTIONS.filter((option) => option.value.length > 0 && supportedTiers.includes(option.value));
}

export function getModelSelectableServiceTierOptions(
  model: Pick<ModelInfo, 'supportedServiceTiers'> | null | undefined,
  options?: {
    includeDefaultOption?: boolean;
    defaultLabel?: string;
  },
) {
  const supportedOptions = getModelSupportedServiceTierOptions(model);
  if (supportedOptions.length === 0) {
    return [];
  }

  return [{ value: '', label: options?.includeDefaultOption ? (options.defaultLabel ?? 'Default') : 'Unset' }, ...supportedOptions];
}

export function hasSelectableModelId<T extends Pick<ModelInfo, 'id'>>(models: readonly T[], modelId: string | null | undefined): boolean {
  const normalizedModelId = normalizeModelId(modelId);
  return normalizedModelId.length > 0 && models.some((model) => model.id === normalizedModelId);
}

export function resolveSelectableModelId<T extends Pick<ModelInfo, 'id'>>(input: {
  requestedModel?: string | null;
  defaultModel?: string | null;
  models: readonly T[];
}): string {
  if (hasSelectableModelId(input.models, input.requestedModel)) {
    return normalizeModelId(input.requestedModel);
  }

  if (hasSelectableModelId(input.models, input.defaultModel)) {
    return normalizeModelId(input.defaultModel);
  }

  return input.models[0]?.id ?? '';
}

export function groupModelsByProvider<T extends Pick<ModelInfo, 'provider'>>(models: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();

  for (const model of models) {
    const current = groups.get(model.provider) ?? [];
    current.push(model);
    groups.set(model.provider, current);
  }

  return [...groups.entries()];
}
