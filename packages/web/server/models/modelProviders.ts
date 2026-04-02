import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  getDurableModelsDir,
  getDurableProfilesDir,
} from '@personal-agent/core';

export type ModelProviderApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages' | 'google-generative-ai';
export type ModelProviderInputType = 'text' | 'image';

export interface ModelProviderCostConfig {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelProviderModelConfig {
  id: string;
  name?: string;
  api?: ModelProviderApi;
  baseUrl?: string;
  reasoning: boolean;
  input: ModelProviderInputType[];
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  cost?: ModelProviderCostConfig;
  compat?: Record<string, unknown>;
}

export interface ModelProviderConfig {
  id: string;
  baseUrl?: string;
  api?: ModelProviderApi;
  apiKey?: string;
  authHeader: boolean;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  modelOverrides?: Record<string, unknown>;
  models: ModelProviderModelConfig[];
}

export interface ModelProviderState {
  profile: string;
  filePath: string;
  providers: ModelProviderConfig[];
}

export interface EditableModelProviderConfig {
  baseUrl?: string;
  api?: ModelProviderApi;
  apiKey?: string;
  authHeader?: boolean;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  modelOverrides?: Record<string, unknown>;
}

export interface EditableModelProviderModelConfig {
  name?: string;
  api?: ModelProviderApi;
  baseUrl?: string;
  reasoning?: boolean;
  input?: ModelProviderInputType[];
  contextWindow?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
  cost?: Partial<ModelProviderCostConfig>;
  compat?: Record<string, unknown>;
}

export interface ModelProviderFileOptions {
  profilesDir?: string;
  modelsDir?: string;
}

type JsonRecord = Record<string, unknown>;

function normalizeProfile(profile: string): string {
  const normalized = profile.trim();
  if (!normalized) {
    throw new Error('profile is required');
  }
  return normalized;
}

function normalizeProviderId(providerId: string): string {
  const normalized = providerId.trim();
  if (!normalized) {
    throw new Error('provider is required');
  }
  return normalized;
}

function normalizeModelId(modelId: string): string {
  const normalized = modelId.trim();
  if (!normalized) {
    throw new Error('model is required');
  }
  return normalized;
}

function resolveProfilesDir(options: ModelProviderFileOptions = {}): string {
  const explicitProfilesDir = options.profilesDir?.trim();
  if (explicitProfilesDir) {
    return explicitProfilesDir;
  }

  const explicitLegacyModelsDir = options.modelsDir?.trim();
  if (explicitLegacyModelsDir) {
    return explicitLegacyModelsDir;
  }

  return getDurableProfilesDir();
}

function resolveLegacyModelsDir(options: ModelProviderFileOptions = {}): string {
  const normalized = options.modelsDir?.trim();
  if (normalized) {
    return normalized;
  }
  return getDurableModelsDir();
}

function resolveLegacyModelProvidersFilePath(profile: string, options: ModelProviderFileOptions = {}): string {
  const normalizedProfile = normalizeProfile(profile);
  const fileName = normalizedProfile === 'shared' ? 'global.json' : `${normalizedProfile}.json`;
  return join(resolveLegacyModelsDir(options), fileName);
}

export function resolveModelProvidersFilePath(profile: string, options: ModelProviderFileOptions = {}): string {
  return join(resolveProfilesDir(options), normalizeProfile(profile), 'models.json');
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRawConfig(filePath: string): JsonRecord {
  if (!existsSync(filePath)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Expected ${filePath} to contain a JSON object.`);
  }

  return parsed;
}

function readWritableRawConfig(profile: string, options: ModelProviderFileOptions = {}): JsonRecord {
  const canonicalPath = resolveModelProvidersFilePath(profile, options);
  if (existsSync(canonicalPath)) {
    return readRawConfig(canonicalPath);
  }

  const legacyPath = resolveLegacyModelProvidersFilePath(profile, options);
  if (existsSync(legacyPath)) {
    return readRawConfig(legacyPath);
  }

  return {};
}

function writeRawConfig(filePath: string, config: JsonRecord): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
}

function finalizeCanonicalWrite(profile: string, filePath: string, options: ModelProviderFileOptions = {}): void {
  const legacyPath = resolveLegacyModelProvidersFilePath(profile, options);
  if (legacyPath !== filePath && existsSync(legacyPath)) {
    rmSync(legacyPath, { force: true });
  }
}

function ensureProvidersObject(config: JsonRecord): Record<string, unknown> {
  if (!isRecord(config.providers)) {
    config.providers = {};
  }
  return config.providers as Record<string, unknown>;
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readOptionalStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const entries = Object.entries(value)
    .filter(([, entryValue]) => typeof entryValue === 'string')
    .map(([key, entryValue]) => [key, (entryValue as string).trim()] as const)
    .filter(([, entryValue]) => entryValue.length > 0);

  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
}

function readOptionalObject(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return Object.keys(value).length > 0 ? value : undefined;
}

function readModelInputs(value: unknown): ModelProviderInputType[] {
  if (!Array.isArray(value)) {
    return ['text'];
  }

  const inputs = value
    .filter((entry): entry is ModelProviderInputType => entry === 'text' || entry === 'image');

  if (inputs.length === 0) {
    return ['text'];
  }

  return inputs.includes('image') ? ['text', 'image'] : ['text'];
}

function readCost(value: unknown): ModelProviderCostConfig | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const input = readOptionalNumber(value.input);
  const output = readOptionalNumber(value.output);
  const cacheRead = readOptionalNumber(value.cacheRead);
  const cacheWrite = readOptionalNumber(value.cacheWrite);

  if (input === undefined && output === undefined && cacheRead === undefined && cacheWrite === undefined) {
    return undefined;
  }

  return {
    input: input ?? 0,
    output: output ?? 0,
    cacheRead: cacheRead ?? 0,
    cacheWrite: cacheWrite ?? 0,
  };
}

function readModelConfig(modelId: string, value: unknown): ModelProviderModelConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    id: modelId,
    name: readOptionalString(value.name),
    api: readOptionalString(value.api) as ModelProviderApi | undefined,
    baseUrl: readOptionalString(value.baseUrl),
    reasoning: value.reasoning === true,
    input: readModelInputs(value.input),
    contextWindow: readOptionalNumber(value.contextWindow),
    maxTokens: readOptionalNumber(value.maxTokens),
    headers: readOptionalStringRecord(value.headers),
    cost: readCost(value.cost),
    compat: readOptionalObject(value.compat),
  };
}

function readProviderConfig(providerId: string, value: unknown): ModelProviderConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const modelsSource = Array.isArray(value.models) ? value.models : [];
  const models = modelsSource
    .map((entry) => {
      if (!isRecord(entry)) {
        return null;
      }

      const modelId = readOptionalString(entry.id);
      if (!modelId) {
        return null;
      }

      return readModelConfig(modelId, entry);
    })
    .filter((entry): entry is ModelProviderModelConfig => entry !== null);

  return {
    id: providerId,
    baseUrl: readOptionalString(value.baseUrl),
    api: readOptionalString(value.api) as ModelProviderApi | undefined,
    apiKey: readOptionalString(value.apiKey),
    authHeader: value.authHeader === true,
    headers: readOptionalStringRecord(value.headers),
    compat: readOptionalObject(value.compat),
    modelOverrides: readOptionalObject(value.modelOverrides),
    models,
  };
}

export function readModelProvidersState(profile: string, options: ModelProviderFileOptions = {}): ModelProviderState {
  const normalizedProfile = normalizeProfile(profile);
  const filePath = resolveModelProvidersFilePath(normalizedProfile, options);
  const config = readWritableRawConfig(normalizedProfile, options);
  const providersSource = isRecord(config.providers) ? config.providers : {};

  const providers = Object.entries(providersSource)
    .map(([providerId, value]) => readProviderConfig(providerId, value))
    .filter((entry): entry is ModelProviderConfig => entry !== null)
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    profile: normalizedProfile,
    filePath,
    providers,
  };
}

function applyProviderUpdate(target: JsonRecord, update: EditableModelProviderConfig): void {
  const baseUrl = readOptionalString(update.baseUrl);
  const api = readOptionalString(update.api) as ModelProviderApi | undefined;
  const apiKey = readOptionalString(update.apiKey);
  const headers = readOptionalStringRecord(update.headers);
  const compat = readOptionalObject(update.compat);
  const modelOverrides = readOptionalObject(update.modelOverrides);

  if (baseUrl) target.baseUrl = baseUrl;
  else delete target.baseUrl;

  if (api) target.api = api;
  else delete target.api;

  if (apiKey) target.apiKey = apiKey;
  else delete target.apiKey;

  if (update.authHeader === true) target.authHeader = true;
  else delete target.authHeader;

  if (headers) target.headers = headers;
  else delete target.headers;

  if (compat) target.compat = compat;
  else delete target.compat;

  if (modelOverrides) target.modelOverrides = modelOverrides;
  else delete target.modelOverrides;
}

function applyModelUpdate(target: JsonRecord, modelId: string, update: EditableModelProviderModelConfig): void {
  const name = readOptionalString(update.name);
  const api = readOptionalString(update.api) as ModelProviderApi | undefined;
  const baseUrl = readOptionalString(update.baseUrl);
  const input = readModelInputs(update.input);
  const contextWindow = readOptionalNumber(update.contextWindow);
  const maxTokens = readOptionalNumber(update.maxTokens);
  const headers = readOptionalStringRecord(update.headers);
  const compat = readOptionalObject(update.compat);
  const cost = readCost(update.cost);

  target.id = modelId;

  if (name) target.name = name;
  else delete target.name;

  if (api) target.api = api;
  else delete target.api;

  if (baseUrl) target.baseUrl = baseUrl;
  else delete target.baseUrl;

  if (update.reasoning === true) target.reasoning = true;
  else delete target.reasoning;

  target.input = input;

  if (contextWindow !== undefined) target.contextWindow = contextWindow;
  else delete target.contextWindow;

  if (maxTokens !== undefined) target.maxTokens = maxTokens;
  else delete target.maxTokens;

  if (headers) target.headers = headers;
  else delete target.headers;

  if (cost) target.cost = cost;
  else delete target.cost;

  if (compat) target.compat = compat;
  else delete target.compat;
}

export function upsertModelProvider(
  profile: string,
  providerId: string,
  update: EditableModelProviderConfig,
  options: ModelProviderFileOptions = {},
): ModelProviderState {
  const normalizedProfile = normalizeProfile(profile);
  const normalizedProviderId = normalizeProviderId(providerId);
  const filePath = resolveModelProvidersFilePath(normalizedProfile, options);
  const config = readWritableRawConfig(normalizedProfile, options);
  const providers = ensureProvidersObject(config);
  const provider = isRecord(providers[normalizedProviderId]) ? providers[normalizedProviderId] as JsonRecord : {};

  applyProviderUpdate(provider, update);
  providers[normalizedProviderId] = provider;
  writeRawConfig(filePath, config);
  finalizeCanonicalWrite(normalizedProfile, filePath, options);
  return readModelProvidersState(normalizedProfile, options);
}

export function removeModelProvider(
  profile: string,
  providerId: string,
  options: ModelProviderFileOptions = {},
): { removed: boolean; state: ModelProviderState } {
  const normalizedProfile = normalizeProfile(profile);
  const normalizedProviderId = normalizeProviderId(providerId);
  const filePath = resolveModelProvidersFilePath(normalizedProfile, options);
  const config = readWritableRawConfig(normalizedProfile, options);
  const providers = ensureProvidersObject(config);
  const removed = Object.prototype.hasOwnProperty.call(providers, normalizedProviderId);

  delete providers[normalizedProviderId];
  writeRawConfig(filePath, config);
  finalizeCanonicalWrite(normalizedProfile, filePath, options);

  return {
    removed,
    state: readModelProvidersState(normalizedProfile, options),
  };
}

export function upsertModelProviderModel(
  profile: string,
  providerId: string,
  modelId: string,
  update: EditableModelProviderModelConfig,
  options: ModelProviderFileOptions = {},
): ModelProviderState {
  const normalizedProfile = normalizeProfile(profile);
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = normalizeModelId(modelId);
  const filePath = resolveModelProvidersFilePath(normalizedProfile, options);
  const config = readWritableRawConfig(normalizedProfile, options);
  const providers = ensureProvidersObject(config);
  const provider = isRecord(providers[normalizedProviderId]) ? providers[normalizedProviderId] as JsonRecord : {};
  const models = Array.isArray(provider.models)
    ? provider.models.filter((entry): entry is JsonRecord => isRecord(entry))
    : [];
  const existingIndex = models.findIndex((entry) => readOptionalString(entry.id) === normalizedModelId);
  const model = existingIndex >= 0 ? models[existingIndex] : {};

  applyModelUpdate(model, normalizedModelId, update);

  if (existingIndex >= 0) {
    models[existingIndex] = model;
  } else {
    models.push(model);
  }

  provider.models = models;
  providers[normalizedProviderId] = provider;
  writeRawConfig(filePath, config);
  finalizeCanonicalWrite(normalizedProfile, filePath, options);
  return readModelProvidersState(normalizedProfile, options);
}

export function removeModelProviderModel(
  profile: string,
  providerId: string,
  modelId: string,
  options: ModelProviderFileOptions = {},
): { removed: boolean; state: ModelProviderState } {
  const normalizedProfile = normalizeProfile(profile);
  const normalizedProviderId = normalizeProviderId(providerId);
  const normalizedModelId = normalizeModelId(modelId);
  const filePath = resolveModelProvidersFilePath(normalizedProfile, options);
  const config = readWritableRawConfig(normalizedProfile, options);
  const providers = ensureProvidersObject(config);
  const provider = isRecord(providers[normalizedProviderId]) ? providers[normalizedProviderId] as JsonRecord : null;

  if (!provider) {
    return {
      removed: false,
      state: readModelProvidersState(normalizedProfile, options),
    };
  }

  const models = Array.isArray(provider.models)
    ? provider.models.filter((entry): entry is JsonRecord => isRecord(entry))
    : [];
  const remainingModels = models.filter((entry) => readOptionalString(entry.id) !== normalizedModelId);
  const removed = remainingModels.length !== models.length;

  provider.models = remainingModels;
  providers[normalizedProviderId] = provider;
  writeRawConfig(filePath, config);
  finalizeCanonicalWrite(normalizedProfile, filePath, options);

  return {
    removed,
    state: readModelProvidersState(normalizedProfile, options),
  };
}
