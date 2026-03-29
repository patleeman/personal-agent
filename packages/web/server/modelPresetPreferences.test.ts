import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readSavedModelPresetPreferences, writeSavedModelPresetPreferences } from './modelPresetPreferences.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pa-web-model-preset-prefs-'));
  tempDirs.push(dir);
  return dir;
}

describe('model preset preferences', () => {
  it('reads saved presets from settings.json', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      defaultModelPreset: 'balanced',
      modelPresets: {
        balanced: {
          description: 'Default work',
          model: 'openai-codex/gpt-5.4',
          thinkingLevel: 'high',
          fallbacks: [{ model: 'desktop/qwen-reap', thinkingLevel: 'medium' }],
        },
      },
    }));

    expect(readSavedModelPresetPreferences(file)).toEqual({
      defaultPresetId: 'balanced',
      presets: [{
        id: 'balanced',
        description: 'Default work',
        model: 'openai-codex/gpt-5.4',
        thinkingLevel: 'high',
        fallbacks: [{ model: 'desktop/qwen-reap', thinkingLevel: 'medium' }],
        goodFor: [],
        avoidFor: [],
        instructionAddendum: '',
      }],
    });
  });

  it('writes presets and clears explicit defaults when a default preset is selected', () => {
    const dir = createTempDir();
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({
      theme: 'cobalt2',
      defaultProvider: 'openai-codex',
      defaultModel: 'gpt-5.4',
      defaultThinkingLevel: 'high',
    }));

    writeSavedModelPresetPreferences({
      defaultPresetId: 'balanced',
      presets: [{
        id: 'balanced',
        description: 'Default work',
        model: 'openai-codex/gpt-5.4',
        thinkingLevel: 'high',
        fallbacks: [{ model: 'desktop/qwen-reap', thinkingLevel: 'medium' }],
        goodFor: ['coding'],
        avoidFor: ['chores'],
        instructionAddendum: 'Use normal depth.',
      }],
    }, file);

    expect(JSON.parse(readFileSync(file, 'utf-8'))).toEqual({
      theme: 'cobalt2',
      defaultModelPreset: 'balanced',
      modelPresets: {
        balanced: {
          description: 'Default work',
          model: 'openai-codex/gpt-5.4',
          thinkingLevel: 'high',
          fallbacks: [{ model: 'desktop/qwen-reap', thinkingLevel: 'medium' }],
          goodFor: ['coding'],
          avoidFor: ['chores'],
          instructionAddendum: 'Use normal depth.',
        },
      },
    });
  });
});
