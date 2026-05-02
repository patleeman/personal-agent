import { describe, expect, it, vi } from 'vitest';

vi.mock('./modelProviders.js', () => ({
  readModelProvidersState: vi.fn(),
  upsertModelProvider: vi.fn(),
  removeModelProvider: vi.fn(),
  upsertModelProviderModel: vi.fn(),
  removeModelProviderModel: vi.fn(),
}));

vi.mock('./providerAuth.js', () => ({
  readProviderAuthState: vi.fn(),
  setProviderApiKey: vi.fn(),
  removeProviderCredential: vi.fn(),
  startProviderOAuthLogin: vi.fn(),
  getProviderOAuthLoginState: vi.fn(),
  submitProviderOAuthLoginInput: vi.fn(),
  cancelProviderOAuthLogin: vi.fn(),
}));

vi.mock('../middleware/index.js', () => ({
  refreshAllLiveSessionModelRegistries: vi.fn(),
  reloadAllLiveSessionAuth: vi.fn(),
}));

import {
  readModelProvidersCapability,
  saveModelProviderCapability,
  deleteModelProviderCapability,
  saveModelProviderModelCapability,
  deleteModelProviderModelCapability,
  readProviderAuthCapability,
  setProviderApiKeyCapability,
  removeProviderCredentialCapability,
  startProviderOAuthLoginCapability,
  readProviderOAuthLoginCapability,
  submitProviderOAuthLoginInputCapability,
  cancelProviderOAuthLoginCapability,
  ProviderDesktopCapabilityInputError,
  type ProviderDesktopCapabilityContext,
} from './providerDesktopCapability.js';

import * as modelProviders from './modelProviders.js';
import * as providerAuth from './providerAuth.js';
import * as middleware from '../middleware/index.js';

function createContext(overrides?: Partial<ProviderDesktopCapabilityContext>): ProviderDesktopCapabilityContext {
  return {
    getCurrentProfile: () => 'test-profile',
    materializeWebProfile: vi.fn(),
    getAuthFile: () => '/tmp/test-auth.json',
    ...overrides,
  };
}

describe('readModelProvidersCapability', () => {
  it('returns provider state for the current profile', () => {
    vi.mocked(modelProviders.readModelProvidersState).mockReturnValue({ providers: {} } as never);
    const context = createContext();
    const result = readModelProvidersCapability(context);
    expect(modelProviders.readModelProvidersState).toHaveBeenCalledWith('test-profile');
    expect(result).toEqual({ providers: {} });
  });
});

describe('saveModelProviderCapability', () => {
  it('saves a provider and refreshes registries', () => {
    vi.mocked(modelProviders.upsertModelProvider).mockReturnValue({ providers: { openai: {} } } as never);
    const context = createContext();
    const result = saveModelProviderCapability(context, { provider: ' openai ' });
    expect(modelProviders.upsertModelProvider).toHaveBeenCalledWith('test-profile', 'openai', expect.any(Object));
    expect(middleware.refreshAllLiveSessionModelRegistries).toHaveBeenCalled();
    expect((context.materializeWebProfile as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('test-profile');
    expect(result).toEqual({ providers: { openai: {} } });
  });

  it('throws on empty provider', () => {
    expect(() => saveModelProviderCapability(createContext(), { provider: '' }))
      .toThrow(ProviderDesktopCapabilityInputError);
  });
});

describe('deleteModelProviderCapability', () => {
  it('removes a provider and refreshes registries', () => {
    vi.mocked(modelProviders.removeModelProvider).mockReturnValue({ state: { providers: {} } } as never);
    const context = createContext();
    deleteModelProviderCapability(context, ' openai ');
    expect(modelProviders.removeModelProvider).toHaveBeenCalledWith('test-profile', 'openai');
    expect(middleware.refreshAllLiveSessionModelRegistries).toHaveBeenCalled();
  });

  it('throws on empty provider', () => {
    expect(() => deleteModelProviderCapability(createContext(), '')).toThrow(ProviderDesktopCapabilityInputError);
  });
});

describe('saveModelProviderModelCapability', () => {
  it('saves a model under a provider', () => {
    vi.mocked(modelProviders.upsertModelProviderModel).mockReturnValue({ providers: { openai: { models: {} } } } as never);
    const context = createContext();
    const result = saveModelProviderModelCapability(context, { provider: 'openai', modelId: 'gpt-4' });
    expect(modelProviders.upsertModelProviderModel).toHaveBeenCalledWith('test-profile', 'openai', 'gpt-4', expect.any(Object));
    expect(result).toEqual({ providers: { openai: { models: {} } } });
  });

  it('throws on empty provider', () => {
    expect(() => saveModelProviderModelCapability(createContext(), { provider: '', modelId: 'gpt-4' }))
      .toThrow(ProviderDesktopCapabilityInputError);
  });

  it('throws on empty modelId', () => {
    expect(() => saveModelProviderModelCapability(createContext(), { provider: 'openai', modelId: '' }))
      .toThrow(ProviderDesktopCapabilityInputError);
  });
});

describe('deleteModelProviderModelCapability', () => {
  it('removes a model from a provider', () => {
    vi.mocked(modelProviders.removeModelProviderModel).mockReturnValue({ state: { providers: {} } } as never);
    const context = createContext();
    deleteModelProviderModelCapability(context, ' openai ', ' gpt-4 ');
    expect(modelProviders.removeModelProviderModel).toHaveBeenCalledWith('test-profile', 'openai', 'gpt-4');
  });
});

describe('readProviderAuthCapability', () => {
  it('reads auth state', () => {
    vi.mocked(providerAuth.readProviderAuthState).mockReturnValue({ providers: {} } as never);
    const context = createContext();
    const result = readProviderAuthCapability(context);
    expect(providerAuth.readProviderAuthState).toHaveBeenCalledWith('/tmp/test-auth.json');
    expect(result).toEqual({ providers: {} });
  });
});

describe('setProviderApiKeyCapability', () => {
  it('sets an api key and reloads auth', () => {
    vi.mocked(providerAuth.setProviderApiKey).mockReturnValue({ providers: { openai: {} } } as never);
    const context = createContext();
    const result = setProviderApiKeyCapability(context, ' openai ', ' sk-123 ');
    expect(providerAuth.setProviderApiKey).toHaveBeenCalledWith('/tmp/test-auth.json', 'openai', 'sk-123');
    expect(middleware.reloadAllLiveSessionAuth).toHaveBeenCalled();
    expect(result).toEqual({ providers: { openai: {} } });
  });

  it('throws on empty provider', () => {
    expect(() => setProviderApiKeyCapability(createContext(), '', 'key'))
      .toThrow(ProviderDesktopCapabilityInputError);
  });

  it('throws on empty apiKey', () => {
    expect(() => setProviderApiKeyCapability(createContext(), 'openai', ''))
      .toThrow(ProviderDesktopCapabilityInputError);
  });
});

describe('removeProviderCredentialCapability', () => {
  it('removes a credential and reloads auth', () => {
    vi.mocked(providerAuth.removeProviderCredential).mockReturnValue({ providers: {} } as never);
    const context = createContext();
    removeProviderCredentialCapability(context, ' openai ');
    expect(providerAuth.removeProviderCredential).toHaveBeenCalledWith('/tmp/test-auth.json', 'openai');
    expect(middleware.reloadAllLiveSessionAuth).toHaveBeenCalled();
  });
});

describe('OAuth login capabilities', () => {
  it('startProviderOAuthLoginCapability delegates', () => {
    vi.mocked(providerAuth.startProviderOAuthLogin).mockReturnValue({ loginId: 'abc' } as never);
    const context = createContext();
    const result = startProviderOAuthLoginCapability(context, 'github');
    expect(providerAuth.startProviderOAuthLogin).toHaveBeenCalledWith('/tmp/test-auth.json', 'github');
    expect(result).toEqual({ loginId: 'abc' });
  });

  it('readProviderOAuthLoginCapability delegates', () => {
    vi.mocked(providerAuth.getProviderOAuthLoginState).mockReturnValue({ status: 'pending' } as never);
    const result = readProviderOAuthLoginCapability('login-1');
    expect(providerAuth.getProviderOAuthLoginState).toHaveBeenCalledWith('login-1');
    expect(result).toEqual({ status: 'pending' });
  });

  it('submitProviderOAuthLoginInputCapability delegates', () => {
    vi.mocked(providerAuth.submitProviderOAuthLoginInput).mockReturnValue({ status: 'completed' } as never);
    const result = submitProviderOAuthLoginInputCapability('login-1', 'code123');
    expect(providerAuth.submitProviderOAuthLoginInput).toHaveBeenCalledWith('login-1', 'code123');
    expect(result).toEqual({ status: 'completed' });
  });

  it('cancelProviderOAuthLoginCapability delegates', () => {
    vi.mocked(providerAuth.cancelProviderOAuthLogin).mockReturnValue({ status: 'cancelled' } as never);
    const result = cancelProviderOAuthLoginCapability('login-1');
    expect(providerAuth.cancelProviderOAuthLogin).toHaveBeenCalledWith('login-1');
    expect(result).toEqual({ status: 'cancelled' });
  });
});
