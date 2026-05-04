import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { normalizeSavedModelPreferences, readSavedModelPreferences, writeSavedModelPreferences } from './modelPreferences.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-model-prefs-'));
  tempDirs.push(dir);
  return dir;
}

describe('readSavedModelPreferences', () => {
  it('returns empty values when the settings file is missing', () => {
    const dir = createTempDir();
    expect(readSavedModelPreferences(join(dir, 'settings.json'))).toEqual({
      currentModel: '',
      currentVisionModel: '',
      currentThinkingLevel: '',
      currentServiceTier: '',
      currentPresetId: '',
    });
  });

  it('reads the default model, thinking level, and service tier from settings.json', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ defaultModel: 'gpt-5.4', defaultThinkingLevel: 'xhigh', defaultServiceTier: 'priority' }));

    expect(readSavedModelPreferences(file)).toEqual({
      currentModel: 'gpt-5.4',
      currentVisionModel: '',
      currentThinkingLevel: 'xhigh',
      currentServiceTier: 'priority',
      currentPresetId: '',
    });
  });

  it('falls back safely on invalid JSON', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{not json');

    expect(readSavedModelPreferences(file)).toEqual({
      currentModel: '',
      currentVisionModel: '',
      currentThinkingLevel: '',
      currentServiceTier: '',
      currentPresetId: '',
    });
  });
});

describe('normalizeSavedModelPreferences', () => {
  it('splits provider/model strings and rewrites the settings file', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ defaultModel: 'anthropic/claude-sonnet-4-6' }));

    expect(normalizeSavedModelPreferences(file, [{ id: 'claude-sonnet-4-6', provider: 'anthropic' }])).toEqual({
      currentModel: 'claude-sonnet-4-6',
      currentVisionModel: '',
      currentThinkingLevel: '',
      currentServiceTier: '',
      currentPresetId: '',
    });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
    });
  });

  it('infers the provider when a single exact model match exists', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ defaultModel: 'gpt-5.4' }));

    expect(normalizeSavedModelPreferences(file, [{ id: 'gpt-5.4', provider: 'openai-codex' }])).toEqual({
      currentModel: 'gpt-5.4',
      currentVisionModel: '',
      currentThinkingLevel: '',
      currentServiceTier: '',
      currentPresetId: '',
    });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
    });
  });

  it('does not rewrite ambiguous or already-matching provider settings', () => {
    const ambiguousDir = createTempDir();
    const ambiguousFile = join(ambiguousDir, 'settings.json');
    writeFileSync(ambiguousFile, JSON.stringify({ defaultModel: 'gpt-5.4' }));

    expect(
      normalizeSavedModelPreferences(ambiguousFile, [
        { id: 'gpt-5.4', provider: 'openai-codex' },
        { id: 'gpt-5.4', provider: 'openrouter' },
      ]),
    ).toEqual({
      currentModel: 'gpt-5.4',
      currentVisionModel: '',
      currentThinkingLevel: '',
      currentServiceTier: '',
      currentPresetId: '',
    });
    expect(JSON.parse(readFileSync(ambiguousFile, 'utf-8'))).toEqual({ defaultModel: 'gpt-5.4' });

    const matchingDir = createTempDir();
    const matchingFile = join(matchingDir, 'settings.json');
    writeFileSync(
      matchingFile,
      JSON.stringify({
        defaultProvider: 'openai-codex',
        defaultModel: 'gpt-5.4',
      }),
    );

    expect(
      normalizeSavedModelPreferences(matchingFile, [
        { id: 'gpt-5.4', provider: 'openai-codex' },
        { id: 'gpt-5.4', provider: 'openrouter' },
      ]),
    ).toEqual({
      currentModel: 'gpt-5.4',
      currentVisionModel: '',
      currentThinkingLevel: '',
      currentServiceTier: '',
      currentPresetId: '',
    });
    expect(JSON.parse(readFileSync(matchingFile, 'utf-8'))).toEqual({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
    });
  });
});

describe('writeSavedModelPreferences', () => {
  it('writes model, provider, thinking level, and service tier while preserving unrelated settings', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ theme: 'cobalt2' }));

    writeSavedModelPreferences({ model: 'gpt-5.4', thinkingLevel: 'high', serviceTier: 'priority' }, file, [
      { id: 'gpt-5.4', provider: 'openai-codex' },
    ]);

    expect(readSavedModelPreferences(file)).toEqual({
      currentModel: 'gpt-5.4',
      currentVisionModel: '',
      currentThinkingLevel: 'high',
      currentServiceTier: 'priority',
      currentPresetId: '',
    });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      theme: 'cobalt2',
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
      defaultThinkingLevel: 'high',
      defaultServiceTier: 'priority',
    });
  });

  it('writes and reads the preferred vision model separately from the default model', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');

    writeSavedModelPreferences({ visionModel: 'openai/gpt-4o' }, file, [{ id: 'gpt-4o', provider: 'openai' }]);

    expect(readSavedModelPreferences(file, [{ id: 'gpt-4o', provider: 'openai' }])).toEqual({
      currentModel: '',
      currentVisionModel: 'openai/gpt-4o',
      currentThinkingLevel: '',
      currentServiceTier: '',
      currentPresetId: '',
    });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultVisionProvider: 'openai',
      defaultVisionModel: 'gpt-4o',
    });
  });

  it('clears persisted preferences when given empty values', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        defaultProvider: 'openai-codex',
        defaultModel: 'gpt-5.4',
        defaultVisionProvider: 'openai',
        defaultVisionModel: 'gpt-4o',
        defaultThinkingLevel: 'xhigh',
        defaultServiceTier: 'priority',
        theme: 'cobalt2',
      }),
    );

    writeSavedModelPreferences({ model: '', visionModel: '', thinkingLevel: '', serviceTier: '' }, file);

    expect(readSavedModelPreferences(file)).toEqual({
      currentModel: '',
      currentVisionModel: '',
      currentThinkingLevel: '',
      currentServiceTier: '',
      currentPresetId: '',
    });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({ theme: 'cobalt2' });
  });

  it('accepts provider/model strings directly', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');

    writeSavedModelPreferences({ model: 'anthropic/claude-sonnet-4-6' }, file);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultProvider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
    });
  });

  it('preserves raw model ids that already contain slashes', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');

    writeSavedModelPreferences({ model: 'openrouter/free' }, file, [{ id: 'openrouter/free', provider: 'openrouter' }]);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultProvider: 'openrouter',
      defaultModel: 'openrouter/free',
    });
  });

  it('clears only thinking level and service tier when model is left untouched', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        defaultProvider: 'openai-codex',
        defaultModel: 'gpt-5.4',
        defaultThinkingLevel: 'high',
        defaultServiceTier: 'priority',
      }),
    );

    writeSavedModelPreferences({ thinkingLevel: null, serviceTier: null }, file, [{ id: 'gpt-5.4', provider: 'openai-codex' }]);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
    });
  });

  it('ignores invalid service tiers in settings.json and when writing updates', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ defaultServiceTier: 'turbo' }));

    expect(readSavedModelPreferences(file)).toEqual({
      currentModel: '',
      currentVisionModel: '',
      currentThinkingLevel: '',
      currentServiceTier: '',
      currentPresetId: '',
    });

    writeSavedModelPreferences({ serviceTier: 'turbo' }, file);
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({});
  });
});
