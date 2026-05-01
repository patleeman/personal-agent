import { createModelRegistryForAuthFile } from '../models/modelRegistry.js';
import { OpenAITranscriptionProvider } from './openaiApiProvider.js';
import { OpenAICodexRealtimeTranscriptionProvider } from './openaiCodexRealtimeProvider.js';
import { PlannedTranscriptionProvider, StaticTranscriptionProviderRegistry } from './registry.js';
import type { TranscriptionProviderRegistry, TranscriptionSettings } from './types.js';

export function createTranscriptionProviderRegistry(input: {
  authFile: string;
  settings: TranscriptionSettings;
}): TranscriptionProviderRegistry {
  const modelRegistry = createModelRegistryForAuthFile(input.authFile);

  return new StaticTranscriptionProviderRegistry([
    new OpenAICodexRealtimeTranscriptionProvider({
      modelRegistry,
      model: input.settings.model,
    }),
    new OpenAITranscriptionProvider({
      modelRegistry,
      model: input.settings.model,
    }),
    new PlannedTranscriptionProvider('whisperkit-local', 'WhisperKit local', ['file', 'stream']),
  ]);
}

export * from './settings.js';
export * from './types.js';
