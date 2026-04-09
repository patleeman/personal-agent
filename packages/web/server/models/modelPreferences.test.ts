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
    expect(readSavedModelPreferences(join(dir, 'settings.json'))).toEqual({ currentModel: '', currentThinkingLevel: '', currentPresetId: '' });
  });

  it('reads the default model and thinking level from settings.json', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ defaultModel: 'gpt-5.4', defaultThinkingLevel: 'xhigh' }));

    expect(readSavedModelPreferences(file)).toEqual({ currentModel: 'gpt-5.4', currentThinkingLevel: 'xhigh', currentPresetId: '' });
  });

  it('falls back safely on invalid JSON', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{not json');

    expect(readSavedModelPreferences(file)).toEqual({ currentModel: '', currentThinkingLevel: '', currentPresetId: '' });
  });
});

describe('normalizeSavedModelPreferences', () => {
  it('splits provider/model strings and rewrites the settings file', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ defaultModel: 'anthropic/claude-sonnet-4-6' }));

    expect(normalizeSavedModelPreferences(file, [
      { id: 'claude-sonnet-4-6', provider: 'anthropic' },
    ])).toEqual({
      currentModel: 'claude-sonnet-4-6',
      currentThinkingLevel: '',
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

    expect(normalizeSavedModelPreferences(file, [
      { id: 'gpt-5.4', provider: 'openai-codex' },
    ])).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: '',
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

    expect(normalizeSavedModelPreferences(ambiguousFile, [
      { id: 'gpt-5.4', provider: 'openai-codex' },
      { id: 'gpt-5.4', provider: 'openrouter' },
    ])).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: '',
      currentPresetId: '',
    });
    expect(JSON.parse(readFileSync(ambiguousFile, 'utf-8'))).toEqual({ defaultModel: 'gpt-5.4' });

    const matchingDir = createTempDir();
    const matchingFile = join(matchingDir, 'settings.json');
    writeFileSync(matchingFile, JSON.stringify({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
    }));

    expect(normalizeSavedModelPreferences(matchingFile, [
      { id: 'gpt-5.4', provider: 'openai-codex' },
      { id: 'gpt-5.4', provider: 'openrouter' },
    ])).toEqual({
      currentModel: 'gpt-5.4',
      currentThinkingLevel: '',
      currentPresetId: '',
    });
    expect(JSON.parse(readFileSync(matchingFile, 'utf-8'))).toEqual({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
    });
  });
});

describe('writeSavedModelPreferences', () => {
  it('writes model, provider, and thinking level while preserving unrelated settings', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ theme: 'cobalt2' }));

    writeSavedModelPreferences({ model: 'gpt-5.4', thinkingLevel: 'high' }, file, [
      { id: 'gpt-5.4', provider: 'openai-codex' },
    ]);

    expect(readSavedModelPreferences(file)).toEqual({ currentModel: 'gpt-5.4', currentThinkingLevel: 'high', currentPresetId: '' });
    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      theme: 'cobalt2',
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
      defaultThinkingLevel: 'high',
    });
  });

  it('clears persisted preferences when given empty values', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
      defaultThinkingLevel: 'xhigh',
      theme: 'cobalt2',
    }));

    writeSavedModelPreferences({ model: '', thinkingLevel: '' }, file);

    expect(readSavedModelPreferences(file)).toEqual({ currentModel: '', currentThinkingLevel: '', currentPresetId: '' });
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

    writeSavedModelPreferences({ model: 'openrouter/free' }, file, [
      { id: 'openrouter/free', provider: 'openrouter' },
    ]);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultProvider: 'openrouter',
      defaultModel: 'openrouter/free',
    });
  });

  it('clears only thinking level when model is left untouched', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
      defaultThinkingLevel: 'high',
    }));

    writeSavedModelPreferences({ thinkingLevel: null }, file, [
      { id: 'gpt-5.4', provider: 'openai-codex' },
    ]);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
    });
  });
});
