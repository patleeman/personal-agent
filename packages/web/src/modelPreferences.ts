import type { ModelInfo } from './types';

export const THINKING_LEVEL_OPTIONS = [
  { value: '', label: 'Unset' },
  { value: 'off', label: 'Off' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
] as const;

export function groupModelsByProvider<T extends Pick<ModelInfo, 'provider'>>(models: T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();

  for (const model of models) {
    const current = groups.get(model.provider) ?? [];
    current.push(model);
    groups.set(model.provider, current);
  }

  return [...groups.entries()];
}
