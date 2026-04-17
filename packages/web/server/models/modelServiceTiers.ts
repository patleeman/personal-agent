import type { Model } from '@mariozechner/pi-ai';

export const SERVICE_TIER_VALUES = ['auto', 'default', 'flex', 'priority', 'scale'] as const;
export type ServiceTierValue = typeof SERVICE_TIER_VALUES[number];

// Single source of truth for model-level service tier support.
//
// Notes:
// - `models.dev` currently exposes service_tier metadata for GPT-5.4 and GPT-5.4 Mini
//   (priority mode).
// - We also include OpenAI Codex variants that are currently accepted by the live API
//   with `service_tier=priority` in local verification.
//
// Any model not listed here is treated as not supporting service tiers.
const MODEL_SERVICE_TIER_DEFINITIONS: Record<string, readonly ServiceTierValue[]> = {
  'gpt-5.2': ['priority'],
  'gpt-5.3-codex': ['priority'],
  'gpt-5.3-codex-spark': ['priority'],
  'gpt-5.4': ['priority'],
  'gpt-5.4-mini': ['priority'],
};

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

export function normalizeServiceTierValue(value: unknown): ServiceTierValue | '' {
  const normalized = readNonEmptyString(value).toLowerCase();
  return SERVICE_TIER_VALUES.includes(normalized as ServiceTierValue)
    ? (normalized as ServiceTierValue)
    : '';
}

export function getSupportedServiceTiersForModel(
  model: Pick<Model<any>, 'id'> | { id?: unknown } | null | undefined,
): ServiceTierValue[] {
  const normalizedId = readNonEmptyString(model?.id).toLowerCase();
  if (!normalizedId) {
    return [];
  }

  const supported = MODEL_SERVICE_TIER_DEFINITIONS[normalizedId];
  return supported ? [...supported] : [];
}

export function modelSupportsServiceTiers(
  model: Pick<Model<any>, 'id'> | { id?: unknown } | null | undefined,
): boolean {
  return getSupportedServiceTiersForModel(model).length > 0;
}

export function modelSupportsServiceTier(
  model: Pick<Model<any>, 'id'> | { id?: unknown } | null | undefined,
  serviceTier: unknown,
): boolean {
  const normalizedTier = normalizeServiceTierValue(serviceTier);
  if (!normalizedTier) {
    return false;
  }

  return getSupportedServiceTiersForModel(model).includes(normalizedTier);
}
