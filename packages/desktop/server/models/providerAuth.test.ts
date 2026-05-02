import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readProviderAuthState, removeProviderCredential, setProviderApiKey } from './providerAuth.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-provider-auth-'));
  tempDirs.push(dir);
  return dir;
}

describe('readProviderAuthState', () => {
  it('returns built-in Pi API-key providers for a missing auth file', () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');

    const state = readProviderAuthState(authFile);

    expect(state.authFile).toBe(authFile);
    expect(Array.isArray(state.providers)).toBe(true);

    const openai = state.providers.find((entry) => entry.id === 'openai');
    expect(openai).toMatchObject({
      id: 'openai',
      authType: 'none',
      hasStoredCredential: false,
      apiKeySupported: true,
    });

    expect(state.providers.some((entry) => entry.id === 'anthropic')).toBe(true);
    expect(state.providers.some((entry) => entry.id === 'openrouter')).toBe(true);
    expect(state.providers.some((entry) => entry.id === 'exa')).toBe(true);

    const exa = state.providers.find((entry) => entry.id === 'exa');
    expect(exa).toMatchObject({
      id: 'exa',
      authType: 'none',
      hasStoredCredential: false,
      apiKeySupported: true,
    });
  });
});

describe('setProviderApiKey', () => {
  it('writes API keys to auth.json and marks provider as api_key', () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');

    const state = setProviderApiKey(authFile, 'custom-test-provider', 'test-secret');

    const parsed = JSON.parse(readFileSync(authFile, 'utf-8')) as Record<string, unknown>;
    expect(parsed['custom-test-provider']).toEqual({
      type: 'api_key',
      key: 'test-secret',
    });

    const provider = state.providers.find((entry) => entry.id === 'custom-test-provider');
    expect(provider).toMatchObject({
      id: 'custom-test-provider',
      authType: 'api_key',
      hasStoredCredential: true,
      apiKeySupported: false,
      modelCount: 0,
    });
  });

  it('preserves existing provider credentials when adding another key', () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');

    setProviderApiKey(authFile, 'provider-one', 'key-one');
    setProviderApiKey(authFile, 'provider-two', 'key-two');

    const parsed = JSON.parse(readFileSync(authFile, 'utf-8')) as Record<string, unknown>;
    expect(parsed['provider-one']).toEqual({ type: 'api_key', key: 'key-one' });
    expect(parsed['provider-two']).toEqual({ type: 'api_key', key: 'key-two' });
  });

  it('rejects empty provider ids and API keys', () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');

    expect(() => setProviderApiKey(authFile, '', 'abc')).toThrow('provider is required');
    expect(() => setProviderApiKey(authFile, 'provider', '')).toThrow('apiKey is required');
  });
});

describe('removeProviderCredential', () => {
  it('removes stored credentials for a provider', () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');

    setProviderApiKey(authFile, 'custom-test-provider', 'test-secret');
    const state = removeProviderCredential(authFile, 'custom-test-provider');

    const parsed = JSON.parse(readFileSync(authFile, 'utf-8')) as Record<string, unknown>;
    expect(parsed['custom-test-provider']).toBeUndefined();

    const provider = state.providers.find((entry) => entry.id === 'custom-test-provider');
    expect(provider).toBeUndefined();
  });

  it('rejects empty provider ids', () => {
    const dir = createTempDir();
    const authFile = join(dir, 'auth.json');

    expect(() => removeProviderCredential(authFile, '   ')).toThrow('provider is required');
  });
});
