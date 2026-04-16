import { describe, expect, it } from 'vitest';
import { filterModelPickerItems } from './modelPicker';

const MODELS = [
  { id: 'gpt-5.4', provider: 'openai', name: 'GPT-5.4', context: 272_000 },
  { id: 'gpt-5.3-codex-spark', provider: 'openai-codex', name: 'GPT-5.3 Codex Spark', context: 128_000 },
  { id: 'kimi-k2-thinking', provider: 'kimi-coding', name: 'Kimi K2 Thinking', context: 262_144 },
] as const;

describe('filterModelPickerItems', () => {
  it('returns all models when no query is provided', () => {
    expect(filterModelPickerItems([...MODELS], '')).toEqual(MODELS);
  });

  it('fuzzy-filters models by id and display name', () => {
    expect(filterModelPickerItems([...MODELS], 'gpt54').map((model) => model.id)).toEqual(['gpt-5.4']);
    expect(filterModelPickerItems([...MODELS], 'spark').map((model) => model.id)).toEqual(['gpt-5.3-codex-spark']);
    expect(filterModelPickerItems([...MODELS], 'kimi thinking').map((model) => model.id)).toEqual(['kimi-k2-thinking']);
  });
});
