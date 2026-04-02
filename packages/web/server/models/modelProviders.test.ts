import { mkdtempSync, readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  readModelProvidersState,
  removeModelProvider,
  removeModelProviderModel,
  resolveModelProvidersFilePath,
  upsertModelProvider,
  upsertModelProviderModel,
} from './modelProviders.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-model-providers-'));
  tempDirs.push(dir);
  return dir;
}

describe('resolveModelProvidersFilePath', () => {
  it('uses per-profile models.json paths', () => {
    const dir = createTempDir();

    expect(resolveModelProvidersFilePath('shared', { profilesDir: dir })).toBe(join(dir, 'shared', 'models.json'));
    expect(resolveModelProvidersFilePath('assistant', { profilesDir: dir })).toBe(join(dir, 'assistant', 'models.json'));
  });
});

describe('readModelProvidersState', () => {
  it('returns an empty state when the file is missing', () => {
    const dir = createTempDir();

    expect(readModelProvidersState('assistant', { profilesDir: dir })).toEqual({
      profile: 'assistant',
      filePath: join(dir, 'assistant', 'models.json'),
      providers: [],
    });
  });
});

describe('upsertModelProvider', () => {
  it('writes provider overrides to the profile models file', () => {
    const dir = createTempDir();

    const state = upsertModelProvider('assistant', 'openrouter', {
      baseUrl: 'https://openrouter.ai/api/v1',
      api: 'openai-completions',
      apiKey: 'OPENROUTER_API_KEY',
      authHeader: true,
      headers: {
        'x-app': 'personal-agent',
      },
      compat: {
        supportsDeveloperRole: false,
      },
    }, { profilesDir: dir });

    expect(state.providers).toEqual([
      {
        id: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        api: 'openai-completions',
        apiKey: 'OPENROUTER_API_KEY',
        authHeader: true,
        headers: {
          'x-app': 'personal-agent',
        },
        compat: {
          supportsDeveloperRole: false,
        },
        modelOverrides: undefined,
        models: [],
      },
    ]);

    expect(JSON.parse(readFileSync(join(dir, 'assistant', 'models.json'), 'utf-8'))).toEqual({
      providers: {
        openrouter: {
          baseUrl: 'https://openrouter.ai/api/v1',
          api: 'openai-completions',
          apiKey: 'OPENROUTER_API_KEY',
          authHeader: true,
          headers: {
            'x-app': 'personal-agent',
          },
          compat: {
            supportsDeveloperRole: false,
          },
        },
      },
    });
  });

  it('preserves existing models when updating provider-level settings', () => {
    const dir = createTempDir();

    upsertModelProviderModel('assistant', 'desktop', 'qwen-reap', {
      name: 'Qwen REAP',
      reasoning: true,
      input: ['text'],
      contextWindow: 262144,
      maxTokens: 32768,
    }, { profilesDir: dir });

    const state = upsertModelProvider('assistant', 'desktop', {
      baseUrl: 'http://desktop:8000/v1',
      api: 'openai-completions',
    }, { profilesDir: dir });

    expect(state.providers[0]?.models.map((model) => model.id)).toEqual(['qwen-reap']);
  });
});

describe('upsertModelProviderModel', () => {
  it('adds and updates models under a provider', () => {
    const dir = createTempDir();

    upsertModelProvider('assistant', 'desktop', {
      baseUrl: 'http://desktop:8000/v1',
      api: 'openai-completions',
      apiKey: 'local-dev',
    }, { profilesDir: dir });

    const first = upsertModelProviderModel('assistant', 'desktop', 'qwen-reap', {
      name: 'Qwen 3.5 28B A3B REAP (Desktop)',
      reasoning: true,
      input: ['text'],
      contextWindow: 262144,
      maxTokens: 32768,
      cost: {
        input: 0,
        output: 0,
      },
      compat: {
        supportsDeveloperRole: false,
      },
    }, { profilesDir: dir });

    expect(first.providers[0]?.models).toEqual([
      {
        id: 'qwen-reap',
        name: 'Qwen 3.5 28B A3B REAP (Desktop)',
        api: undefined,
        baseUrl: undefined,
        reasoning: true,
        input: ['text'],
        contextWindow: 262144,
        maxTokens: 32768,
        headers: undefined,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        compat: {
          supportsDeveloperRole: false,
        },
      },
    ]);

    const second = upsertModelProviderModel('assistant', 'desktop', 'qwen-reap', {
      name: 'Qwen REAP',
      reasoning: false,
      input: ['text', 'image'],
      contextWindow: 131072,
      maxTokens: 16384,
    }, { profilesDir: dir });

    expect(second.providers[0]?.models[0]).toMatchObject({
      id: 'qwen-reap',
      name: 'Qwen REAP',
      reasoning: false,
      input: ['text', 'image'],
      contextWindow: 131072,
      maxTokens: 16384,
    });
  });
});

describe('removeModelProvider', () => {
  it('removes a provider from the config file', () => {
    const dir = createTempDir();

    upsertModelProvider('assistant', 'desktop', {
      baseUrl: 'http://desktop:8000/v1',
      api: 'openai-completions',
    }, { profilesDir: dir });

    const result = removeModelProvider('assistant', 'desktop', { profilesDir: dir });

    expect(result.removed).toBe(true);
    expect(result.state.providers).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, 'assistant', 'models.json'), 'utf-8'))).toEqual({
      providers: {},
    });
  });
});

describe('removeModelProviderModel', () => {
  it('removes a model while keeping the provider entry', () => {
    const dir = createTempDir();

    upsertModelProvider('assistant', 'desktop', {
      baseUrl: 'http://desktop:8000/v1',
      api: 'openai-completions',
    }, { profilesDir: dir });
    upsertModelProviderModel('assistant', 'desktop', 'qwen-reap', {
      name: 'Qwen REAP',
      reasoning: true,
      input: ['text'],
    }, { profilesDir: dir });

    const result = removeModelProviderModel('assistant', 'desktop', 'qwen-reap', { profilesDir: dir });

    expect(result.removed).toBe(true);
    expect(result.state.providers).toEqual([
      {
        id: 'desktop',
        baseUrl: 'http://desktop:8000/v1',
        api: 'openai-completions',
        apiKey: undefined,
        authHeader: false,
        headers: undefined,
        compat: undefined,
        modelOverrides: undefined,
        models: [],
      },
    ]);
  });
});
