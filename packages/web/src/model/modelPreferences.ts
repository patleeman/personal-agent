import type { ModelInfo } from '../shared/types';

export const THINKING_LEVEL_OPTIONS = [
  { value: '', label: 'Unset' },
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
] as const;

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
  if (!options?.includeDefaultOption) {
    return supportedOptions;
  }

  return [{ value: '', label: options.defaultLabel ?? 'Default' }, ...supportedOptions];
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
