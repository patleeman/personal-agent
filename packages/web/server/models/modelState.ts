import { getAvailableModels } from '../conversations/liveSessions.js';
import { normalizeSavedModelPreferences } from './modelPreferences.js';

const BUILT_IN_MODELS = [
  { id: 'claude-opus-4-6', provider: 'anthropic', name: 'Claude Opus 4.6', context: 200_000 },
  { id: 'claude-sonnet-4-6', provider: 'anthropic', name: 'Claude Sonnet 4.6', context: 200_000 },
  { id: 'claude-haiku-4-6', provider: 'anthropic', name: 'Claude Haiku 4.6', context: 200_000 },
  { id: 'gpt-5.4', provider: 'openai-codex', name: 'GPT-5.4', context: 128_000 },
  { id: 'gpt-5.2', provider: 'openai-codex', name: 'GPT-5.2', context: 128_000 },
  { id: 'gpt-5.1-codex-mini', provider: 'openai-codex', name: 'GPT-5.1 Codex Mini', context: 128_000 },
  { id: 'gpt-4o', provider: 'openai', name: 'GPT-4o', context: 128_000 },
  { id: 'gemini-2.5-pro', provider: 'google', name: 'Gemini 2.5 Pro', context: 1_000_000 },
  { id: 'gemini-3.1-pro-high', provider: 'google', name: 'Gemini 3.1 Pro High', context: 1_000_000 },
];

export function listModelDefinitions() {
  try {
    const live = getAvailableModels();
    if (live.length > 0) {
      return live;
    }
  } catch {
    // Fall back to built-ins when the live registry cannot be materialized.
  }

  return BUILT_IN_MODELS;
}

export function readModelState(settingsFile: string) {
  const models = listModelDefinitions();
  const saved = normalizeSavedModelPreferences(settingsFile, models);
  const modelIds = new Set(models.map((model) => model.id));
  const currentModel = (saved.currentModel && modelIds.has(saved.currentModel))
    ? saved.currentModel
    : (models[0]?.id || '');

  return {
    currentModel,
    currentThinkingLevel: saved.currentThinkingLevel,
    models,
  };
}
