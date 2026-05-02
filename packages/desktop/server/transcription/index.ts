import { dirname, join } from 'node:path';

import { LocalWhisperTranscriptionProvider } from './localWhisperProvider.js';
import { StaticTranscriptionProviderRegistry } from './registry.js';
import type { TranscriptionProviderRegistry, TranscriptionSettings } from './types.js';

export function createTranscriptionProviderRegistry(input: {
  authFile: string;
  settings: TranscriptionSettings;
}): TranscriptionProviderRegistry {
  return new StaticTranscriptionProviderRegistry([
    new LocalWhisperTranscriptionProvider({
      model: input.settings.model,
      modelRootPath: join(dirname(input.authFile), 'transcription-models'),
    }),
  ]);
}

export * from './settings.js';
export * from './types.js';
