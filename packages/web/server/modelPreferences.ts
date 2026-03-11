import { existsSync, readFileSync } from 'node:fs';

export interface SavedModelPreferences {
  currentModel: string;
  currentThinkingLevel: string;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

export function readSavedModelPreferences(settingsFile: string): SavedModelPreferences {
  if (!existsSync(settingsFile)) {
    return { currentModel: '', currentThinkingLevel: '' };
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as {
      defaultModel?: unknown;
      defaultThinkingLevel?: unknown;
    };

    return {
      currentModel: readNonEmptyString(parsed.defaultModel),
      currentThinkingLevel: readNonEmptyString(parsed.defaultThinkingLevel),
    };
  } catch {
    return { currentModel: '', currentThinkingLevel: '' };
  }
}
