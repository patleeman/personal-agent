import type { ModelProviderConfig, ModelProviderModelConfig } from '../shared/types';

const MAX_MODEL_TOKEN_LIMIT = 10_000_000;

export interface ProviderEditorDraft {
  id: string;
  baseUrl: string;
  api: string;
  apiKey: string;
  authHeader: boolean;
  headersText: string;
  compatText: string;
  modelOverridesText: string;
}

export interface ModelEditorDraft {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  acceptsImages: boolean;
  contextWindow: string;
  maxTokens: string;
  costInput: string;
  costOutput: string;
  costCacheRead: string;
  costCacheWrite: string;
  headersText: string;
  compatText: string;
}

export function formatJsonObject(value: Record<string, unknown> | Record<string, string> | undefined): string {
  if (!value || Object.keys(value).length === 0) {
    return '';
  }

  return JSON.stringify(value, null, 2);
}

export function createProviderEditorDraft(provider: ModelProviderConfig | null): ProviderEditorDraft {
  return {
    id: provider?.id ?? '',
    baseUrl: provider?.baseUrl ?? '',
    api: provider?.api ?? '',
    apiKey: provider?.apiKey ?? '',
    authHeader: provider?.authHeader ?? false,
    headersText: formatJsonObject(provider?.headers),
    compatText: formatJsonObject(provider?.compat),
    modelOverridesText: formatJsonObject(provider?.modelOverrides),
  };
}

export function createModelEditorDraft(model: ModelProviderModelConfig | null): ModelEditorDraft {
  return {
    id: model?.id ?? '',
    name: model?.name ?? '',
    api: model?.api ?? '',
    baseUrl: model?.baseUrl ?? '',
    reasoning: model?.reasoning ?? false,
    acceptsImages: model?.input.includes('image') ?? false,
    contextWindow: model?.contextWindow !== undefined ? String(model.contextWindow) : '128000',
    maxTokens: model?.maxTokens !== undefined ? String(model.maxTokens) : '16384',
    costInput: model?.cost !== undefined ? String(model.cost.input) : '0',
    costOutput: model?.cost !== undefined ? String(model.cost.output) : '0',
    costCacheRead: model?.cost !== undefined ? String(model.cost.cacheRead) : '0',
    costCacheWrite: model?.cost !== undefined ? String(model.cost.cacheWrite) : '0',
    headersText: formatJsonObject(model?.headers),
    compatText: formatJsonObject(model?.compat),
  };
}

export function parseOptionalJsonObject(text: string, label: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }

  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

export function parseOptionalStringRecord(text: string, label: string): Record<string, string> | undefined {
  const parsed = parseOptionalJsonObject(text, label);
  if (!parsed) {
    return undefined;
  }

  const entries = Object.entries(parsed);
  for (const [, value] of entries) {
    if (typeof value !== 'string') {
      throw new Error(`${label} values must all be strings.`);
    }
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

export function parseOptionalFiniteNumber(value: string, label: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(trimmed)) {
    throw new Error(`${label} must be a valid number.`);
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }

  return parsed;
}

export function parseOptionalPositiveInteger(value: string, label: string): number | undefined {
  const parsed = parseOptionalFiniteNumber(value, label);
  if (parsed === undefined) {
    return undefined;
  }

  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > MAX_MODEL_TOKEN_LIMIT) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

export function parseOptionalNonNegativeNumber(value: string, label: string): number | undefined {
  const parsed = parseOptionalFiniteNumber(value, label);
  if (parsed === undefined) {
    return undefined;
  }

  if (parsed < 0 || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) {
    throw new Error(`${label} must be a non-negative number.`);
  }

  return parsed;
}
