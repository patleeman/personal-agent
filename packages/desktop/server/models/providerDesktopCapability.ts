import { refreshAllLiveSessionModelRegistries, reloadAllLiveSessionAuth } from '../middleware/index.js';
import type { ModelProviderState } from './modelProviders.js';
import {
  readModelProvidersState,
  removeModelProvider,
  removeModelProviderModel,
  upsertModelProvider,
  upsertModelProviderModel,
} from './modelProviders.js';
import type { ProviderAuthState, ProviderOAuthLoginState } from './providerAuth.js';
import {
  cancelProviderOAuthLogin,
  getProviderOAuthLoginState,
  readProviderAuthState,
  removeProviderCredential,
  setProviderApiKey,
  startProviderOAuthLogin,
  submitProviderOAuthLoginInput,
} from './providerAuth.js';

export interface ProviderDesktopCapabilityContext {
  getCurrentProfile: () => string;
  materializeWebProfile: (profile: string) => void;
  getAuthFile: () => string;
}

class ProviderDesktopCapabilityInputError extends Error {}

function currentProfile(context: ProviderDesktopCapabilityContext): string {
  return context.getCurrentProfile();
}

function materialize(context: ProviderDesktopCapabilityContext): void {
  context.materializeWebProfile(currentProfile(context));
}

export function readModelProvidersCapability(context: ProviderDesktopCapabilityContext): ModelProviderState {
  return readModelProvidersState(currentProfile(context));
}

export function saveModelProviderCapability(
  context: ProviderDesktopCapabilityContext,
  input: {
    provider: string;
    baseUrl?: string;
    api?: string;
    apiKey?: string;
    authHeader?: boolean;
    headers?: Record<string, string>;
    compat?: Record<string, unknown>;
    modelOverrides?: Record<string, unknown>;
  },
): ModelProviderState {
  const provider = input.provider.trim();
  if (!provider) {
    throw new ProviderDesktopCapabilityInputError('provider required');
  }

  const state = upsertModelProvider(currentProfile(context), provider, {
    baseUrl: input.baseUrl,
    api: input.api as Parameters<typeof upsertModelProvider>[2]['api'],
    apiKey: input.apiKey,
    authHeader: input.authHeader,
    headers: input.headers,
    compat: input.compat,
    modelOverrides: input.modelOverrides,
  });
  materialize(context);
  refreshAllLiveSessionModelRegistries();
  return state;
}

export function deleteModelProviderCapability(context: ProviderDesktopCapabilityContext, providerInput: string): ModelProviderState {
  const provider = providerInput.trim();
  if (!provider) {
    throw new ProviderDesktopCapabilityInputError('provider required');
  }

  const result = removeModelProvider(currentProfile(context), provider);
  materialize(context);
  refreshAllLiveSessionModelRegistries();
  return result.state;
}

export function saveModelProviderModelCapability(
  context: ProviderDesktopCapabilityContext,
  input: {
    provider: string;
    modelId: string;
    name?: string;
    api?: string;
    baseUrl?: string;
    reasoning?: boolean;
    input?: Array<'text' | 'image'>;
    contextWindow?: number;
    maxTokens?: number;
    headers?: Record<string, string>;
    cost?: {
      input?: number;
      output?: number;
      cacheRead?: number;
      cacheWrite?: number;
    };
    compat?: Record<string, unknown>;
  },
): ModelProviderState {
  const provider = input.provider.trim();
  if (!provider) {
    throw new ProviderDesktopCapabilityInputError('provider required');
  }

  const modelId = input.modelId.trim();
  if (!modelId) {
    throw new ProviderDesktopCapabilityInputError('modelId required');
  }

  const state = upsertModelProviderModel(currentProfile(context), provider, modelId, {
    name: input.name,
    api: input.api as Parameters<typeof upsertModelProviderModel>[3]['api'],
    baseUrl: input.baseUrl,
    reasoning: input.reasoning,
    input: input.input,
    contextWindow: input.contextWindow,
    maxTokens: input.maxTokens,
    headers: input.headers,
    cost: input.cost,
    compat: input.compat,
  });
  materialize(context);
  refreshAllLiveSessionModelRegistries();
  return state;
}

export function deleteModelProviderModelCapability(
  context: ProviderDesktopCapabilityContext,
  providerInput: string,
  modelIdInput: string,
): ModelProviderState {
  const provider = providerInput.trim();
  if (!provider) {
    throw new ProviderDesktopCapabilityInputError('provider required');
  }

  const modelId = modelIdInput.trim();
  if (!modelId) {
    throw new ProviderDesktopCapabilityInputError('modelId required');
  }

  const result = removeModelProviderModel(currentProfile(context), provider, modelId);
  materialize(context);
  refreshAllLiveSessionModelRegistries();
  return result.state;
}

export function readProviderAuthCapability(context: ProviderDesktopCapabilityContext): ProviderAuthState {
  return readProviderAuthState(context.getAuthFile());
}

export function setProviderApiKeyCapability(
  context: ProviderDesktopCapabilityContext,
  providerInput: string,
  apiKeyInput: string,
): ProviderAuthState {
  const provider = providerInput.trim();
  if (!provider) {
    throw new ProviderDesktopCapabilityInputError('provider required');
  }

  const apiKey = apiKeyInput.trim();
  if (!apiKey) {
    throw new ProviderDesktopCapabilityInputError('apiKey required');
  }

  const state = setProviderApiKey(context.getAuthFile(), provider, apiKey);
  reloadAllLiveSessionAuth();
  return state;
}

export function removeProviderCredentialCapability(context: ProviderDesktopCapabilityContext, providerInput: string): ProviderAuthState {
  const provider = providerInput.trim();
  if (!provider) {
    throw new ProviderDesktopCapabilityInputError('provider required');
  }

  const state = removeProviderCredential(context.getAuthFile(), provider);
  reloadAllLiveSessionAuth();
  return state;
}

export function startProviderOAuthLoginCapability(
  context: ProviderDesktopCapabilityContext,
  providerInput: string,
): ProviderOAuthLoginState {
  return startProviderOAuthLogin(context.getAuthFile(), providerInput);
}

export function readProviderOAuthLoginCapability(loginId: string): ProviderOAuthLoginState | null {
  return getProviderOAuthLoginState(loginId);
}

export function submitProviderOAuthLoginInputCapability(loginId: string, value: string): ProviderOAuthLoginState {
  return submitProviderOAuthLoginInput(loginId, value);
}

export function cancelProviderOAuthLoginCapability(loginId: string): ProviderOAuthLoginState {
  return cancelProviderOAuthLogin(loginId);
}
