import { describe, expect, it } from 'vitest';
import {
  findMatchingModelPreset,
  formatModelPresetModelArgument,
  listModelPresetTargets,
  readModelPresetLibrary,
} from './index.js';

describe('model preset parsing', () => {
  it('parses fallback targets and matches presets by fallback model', () => {
    const library = readModelPresetLibrary({
      defaultModelPreset: 'balanced',
      modelPresets: {
        balanced: {
          description: 'Default work',
          model: 'openai-codex/gpt-5.4',
          thinkingLevel: 'high',
          fallbacks: [
            {
              model: 'desktop/qwen-reap',
              thinkingLevel: 'medium',
            },
            'anthropic/claude-sonnet-4-6:high',
          ],
        },
      },
    });

    expect(library.defaultPresetId).toBe('balanced');
    expect(library.presets).toHaveLength(1);

    const preset = library.presets[0];
    const targets = listModelPresetTargets(preset).map((target) => formatModelPresetModelArgument(target));

    expect(targets).toEqual([
      'openai-codex/gpt-5.4:high',
      'desktop/qwen-reap:medium',
      'anthropic/claude-sonnet-4-6:high',
    ]);
    expect(findMatchingModelPreset(library, {
      modelRef: 'desktop/qwen-reap',
      thinkingLevel: 'medium',
    })?.id).toBe('balanced');
  });
});
