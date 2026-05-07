import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockCredential = { type: 'api_key'; key: string } | { type: 'oauth'; accessToken?: string };

type MockOAuthProvider = {
  id: string;
  name: string;
  usesCallbackServer?: boolean;
};

type MockLoginHandlers = {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onPrompt: (prompt: { message: string; placeholder?: unknown; allowEmpty?: boolean }) => Promise<string>;
  onProgress: (message: string) => void;
  onManualCodeInput: () => Promise<string>;
  signal: AbortSignal;
};

const mockState = vi.hoisted(() => ({
  credentialStoreByFile: new Map<string, Map<string, MockCredential>>(),
  envAuthProvidersByFile: new Map<string, Set<string>>(),
  loginImplementationsByKey: new Map<
    string,
    (handlers: MockLoginHandlers, storage: { set: (provider: string, credential: MockCredential) => void }) => Promise<void>
  >(),
  modelEntriesByFile: new Map<string, Array<{ provider?: unknown }>>(),
  oauthProvidersByFile: new Map<string, MockOAuthProvider[]>(),
}));

function getCredentialsForFile(authFile: string): Map<string, MockCredential> {
  const existing = mockState.credentialStoreByFile.get(authFile);
  if (existing) {
    return existing;
  }

  const next = new Map<string, MockCredential>();
  mockState.credentialStoreByFile.set(authFile, next);
  return next;
}

function resetMockState(): void {
  mockState.credentialStoreByFile.clear();
  mockState.envAuthProvidersByFile.clear();
  mockState.loginImplementationsByKey.clear();
  mockState.modelEntriesByFile.clear();
  mockState.oauthProvidersByFile.clear();
}

function setStoredCredential(authFile: string, provider: string, credential: MockCredential): void {
  getCredentialsForFile(authFile).set(provider, credential);
}

function setEnvAuthProviders(authFile: string, providers: string[]): void {
  mockState.envAuthProvidersByFile.set(authFile, new Set(providers));
}

function setModelEntries(authFile: string, entries: Array<{ provider?: unknown }>): void {
  mockState.modelEntriesByFile.set(authFile, entries);
}

function setOAuthProviders(authFile: string, providers: MockOAuthProvider[]): void {
  mockState.oauthProvidersByFile.set(authFile, providers);
}

function setLoginImplementation(
  authFile: string,
  provider: string,
  implementation: (handlers: MockLoginHandlers, storage: { set: (provider: string, credential: MockCredential) => void }) => Promise<void>,
): void {
  mockState.loginImplementationsByKey.set(`${authFile}:${provider}`, implementation);
}

vi.mock('@earendil-works/pi-coding-agent', () => {
  class FakeAuthStorage {
    constructor(private readonly authFile: string) {}

    static create(authFile: string) {
      return new FakeAuthStorage(authFile);
    }

    get(provider: string) {
      return getCredentialsForFile(this.authFile).get(provider);
    }

    hasAuth(provider: string) {
      return mockState.envAuthProvidersByFile.get(this.authFile)?.has(provider) ?? false;
    }

    list() {
      return [...getCredentialsForFile(this.authFile).keys()];
    }

    getOAuthProviders() {
      return mockState.oauthProvidersByFile.get(this.authFile) ?? [];
    }

    set(provider: string, credential: MockCredential) {
      getCredentialsForFile(this.authFile).set(provider, credential);
    }

    remove(provider: string) {
      getCredentialsForFile(this.authFile).delete(provider);
    }

    async login(provider: string, handlers: MockLoginHandlers) {
      const implementation = mockState.loginImplementationsByKey.get(`${this.authFile}:${provider}`);
      if (!implementation) {
        throw new Error(`No login mock registered for ${provider}`);
      }

      return implementation(handlers, {
        set: (targetProvider, credential) => {
          this.set(targetProvider, credential);
        },
      });
    }
  }

  return {
    AuthStorage: FakeAuthStorage,
  };
});

vi.mock('./modelRegistry.js', () => ({
  createModelRegistryForAuthFile: (authFile: string) => ({
    getAvailable: () => mockState.modelEntriesByFile.get(authFile) ?? [],
  }),
}));

async function loadProviderAuth() {
  return import('./providerAuth.js');
}

async function flushAsyncWork(): Promise<void> {
  for (let index = 0; index < 10; index += 1) {
    await Promise.resolve();
  }
}

describe('providerAuth OAuth helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useRealTimers();
    resetMockState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('summarizes provider auth state across api key, oauth, environment, and model-backed providers', async () => {
    const { readProviderAuthState } = await loadProviderAuth();
    const authFile = '/tmp/provider-auth.json';

    setModelEntries(authFile, [
      { provider: 'custom-oauth' },
      { provider: 'custom-oauth' },
      { provider: ' env-provider ' },
      { provider: '' },
    ]);
    setOAuthProviders(authFile, [
      { id: 'custom-oauth', name: 'Custom OAuth', usesCallbackServer: true },
      { id: 'oauth-only', name: 'OAuth Only' },
    ]);
    setStoredCredential(authFile, 'custom-oauth', { type: 'oauth', accessToken: 'oauth-token' });
    setStoredCredential(authFile, 'api-provider', { type: 'api_key', key: 'api-key' });
    setEnvAuthProviders(authFile, ['env-provider']);

    const state = readProviderAuthState(authFile);

    expect(state.authFile).toBe(authFile);
    expect(state.providers.find((entry) => entry.id === 'custom-oauth')).toMatchObject({
      id: 'custom-oauth',
      authType: 'oauth',
      hasStoredCredential: true,
      modelCount: 2,
      oauthSupported: true,
      oauthProviderName: 'Custom OAuth',
      oauthUsesCallbackServer: true,
    });
    expect(state.providers.find((entry) => entry.id === 'api-provider')).toMatchObject({
      id: 'api-provider',
      authType: 'api_key',
      hasStoredCredential: true,
      apiKeySupported: false,
    });
    expect(state.providers.find((entry) => entry.id === 'env-provider')).toMatchObject({
      id: 'env-provider',
      authType: 'environment',
      hasStoredCredential: false,
      modelCount: 1,
    });
    expect(state.providers.find((entry) => entry.id === 'oauth-only')).toMatchObject({
      id: 'oauth-only',
      authType: 'none',
      oauthSupported: true,
      oauthProviderName: 'OAuth Only',
    });
    expect(state.providers.find((entry) => entry.id === 'openai')).toMatchObject({
      id: 'openai',
      authType: 'none',
      apiKeySupported: true,
    });
  });

  it('tracks successful oauth logins with listeners, prompts, manual code entry, and completion', async () => {
    const {
      getProviderOAuthLoginState,
      startProviderOAuthLogin,
      submitProviderOAuthLoginInput,
      subscribeProviderOAuthLogin,
      subscribeProviderOAuthLogins,
    } = await loadProviderAuth();
    const authFile = '/tmp/provider-auth.json';

    setOAuthProviders(authFile, [{ id: 'openrouter', name: 'OpenRouter' }]);
    setLoginImplementation(authFile, 'openrouter', async (handlers, storage) => {
      handlers.onAuth({
        url: 'https://auth.example/openrouter',
        instructions: 'Open the browser and approve access.',
      });
      handlers.onProgress(' first progress ');
      const code = await handlers.onPrompt({
        message: 'Enter the approval code',
        placeholder: '123456',
        allowEmpty: false,
      });
      handlers.onProgress(`prompt:${code}`);
      const redirectUrl = await handlers.onManualCodeInput();
      handlers.onProgress(`manual:${redirectUrl}`);
      storage.set('openrouter', { type: 'oauth', accessToken: 'stored-token' });
    });

    const noopUnsubscribe = subscribeProviderOAuthLogin('   ', vi.fn());
    noopUnsubscribe();

    const globalListener = vi.fn();
    const unsubscribeGlobal = subscribeProviderOAuthLogins(globalListener);
    const initialState = startProviderOAuthLogin(authFile, ' openrouter ');
    const loginListener = vi.fn();
    const unsubscribeLogin = subscribeProviderOAuthLogin(initialState.id, loginListener);

    expect(initialState).toMatchObject({
      provider: 'openrouter',
      providerName: 'OpenRouter',
      status: 'running',
    });

    await flushAsyncWork();

    expect(getProviderOAuthLoginState(initialState.id)).toMatchObject({
      id: initialState.id,
      status: 'running',
      authUrl: 'https://auth.example/openrouter',
      authInstructions: 'Open the browser and approve access.',
      prompt: {
        message: 'Enter the approval code',
        placeholder: '123456',
        allowEmpty: false,
        manualCode: false,
      },
      progress: ['first progress'],
    });
    expect(globalListener).toHaveBeenCalled();

    expect(() => submitProviderOAuthLoginInput(initialState.id, '   ')).toThrow('Input is required');

    const afterPromptSubmit = submitProviderOAuthLoginInput(initialState.id, '123456');
    expect(afterPromptSubmit.prompt).toBeNull();

    await flushAsyncWork();

    expect(getProviderOAuthLoginState(initialState.id)).toMatchObject({
      status: 'running',
      prompt: {
        message: 'Paste redirect URL below, or complete login in your browser.',
        placeholder: 'https://localhost:1455/auth/callback?code=...',
        allowEmpty: false,
        manualCode: true,
      },
      progress: ['first progress', 'prompt:123456'],
    });

    submitProviderOAuthLoginInput(initialState.id, 'https://localhost:1455/auth/callback?code=abc');
    await flushAsyncWork();

    expect(getProviderOAuthLoginState(initialState.id)).toMatchObject({
      status: 'completed',
      error: '',
      prompt: null,
      progress: ['first progress', 'prompt:123456', 'manual:https://localhost:1455/auth/callback?code=abc'],
    });
    expect(loginListener).toHaveBeenCalled();

    unsubscribeLogin();
    unsubscribeGlobal();
  });

  it('cancels earlier running logins for the same provider and supports explicit cancellation', async () => {
    const { cancelProviderOAuthLogin, getProviderOAuthLoginState, startProviderOAuthLogin } = await loadProviderAuth();
    const authFile = '/tmp/provider-auth.json';

    setOAuthProviders(authFile, [{ id: 'openrouter', name: 'OpenRouter' }]);
    setLoginImplementation(authFile, 'openrouter', async (handlers) => {
      await handlers.onPrompt({
        message: 'Enter any value',
        allowEmpty: true,
      });
    });

    const firstRun = startProviderOAuthLogin(authFile, 'openrouter');
    await flushAsyncWork();

    const secondRun = startProviderOAuthLogin(authFile, 'openrouter');
    await flushAsyncWork();

    expect(getProviderOAuthLoginState(firstRun.id)).toMatchObject({ status: 'cancelled', prompt: null });
    expect(getProviderOAuthLoginState(secondRun.id)).toMatchObject({ status: 'running' });

    expect(cancelProviderOAuthLogin(secondRun.id)).toMatchObject({ status: 'cancelled', prompt: null });
    expect(cancelProviderOAuthLogin(secondRun.id)).toMatchObject({ status: 'cancelled', prompt: null });
  });

  it('validates oauth login start and submit flows, reports failures, and prunes old finished runs', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-09T18:00:00.000Z'));

    const { cancelProviderOAuthLogin, getProviderOAuthLoginState, startProviderOAuthLogin, submitProviderOAuthLoginInput } =
      await loadProviderAuth();
    const authFile = '/tmp/provider-auth.json';

    setOAuthProviders(authFile, [
      { id: 'missing-credential', name: 'Missing Credential' },
      { id: 'network-failure', name: 'Network Failure' },
      { id: 'no-prompt', name: 'No Prompt' },
    ]);
    setLoginImplementation(authFile, 'missing-credential', async () => {});
    setLoginImplementation(authFile, 'network-failure', async () => {
      throw new Error('network down');
    });
    setLoginImplementation(authFile, 'no-prompt', async (handlers) => {
      await new Promise<void>((_, reject) => {
        handlers.signal.addEventListener('abort', () => reject(new Error('Login cancelled')));
      });
    });

    expect(() => startProviderOAuthLogin(authFile, '   ')).toThrow('provider is required');
    expect(() => startProviderOAuthLogin(authFile, 'unknown-provider')).toThrow('Provider does not support OAuth login: unknown-provider');
    expect(() => submitProviderOAuthLoginInput('missing-run', 'value')).toThrow('OAuth login not found: missing-run');
    expect(() => cancelProviderOAuthLogin('missing-run')).toThrow('OAuth login not found: missing-run');

    const missingCredentialRun = startProviderOAuthLogin(authFile, 'missing-credential');
    await flushAsyncWork();
    expect(getProviderOAuthLoginState(missingCredentialRun.id)).toMatchObject({
      status: 'failed',
      error: 'OAuth login for missing-credential did not persist credentials.',
    });
    expect(() => submitProviderOAuthLoginInput(missingCredentialRun.id, 'value')).toThrow(
      `OAuth login is not running: ${missingCredentialRun.id}`,
    );

    const networkFailureRun = startProviderOAuthLogin(authFile, 'network-failure');
    await flushAsyncWork();
    expect(getProviderOAuthLoginState(networkFailureRun.id)).toMatchObject({
      status: 'failed',
      error: 'network down',
    });

    const noPromptRun = startProviderOAuthLogin(authFile, 'no-prompt');
    await flushAsyncWork();
    expect(() => submitProviderOAuthLoginInput(noPromptRun.id, 'value')).toThrow('OAuth login is not waiting for input');
    expect(cancelProviderOAuthLogin(noPromptRun.id)).toMatchObject({ status: 'cancelled' });

    vi.setSystemTime(new Date('2026-04-09T18:31:00.000Z'));
    expect(getProviderOAuthLoginState(missingCredentialRun.id)).toBeNull();
    expect(getProviderOAuthLoginState(networkFailureRun.id)).toBeNull();
    expect(getProviderOAuthLoginState(noPromptRun.id)).toBeNull();
  });
});
