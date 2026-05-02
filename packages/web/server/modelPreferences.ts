import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SavedModelPreferences {
  currentModel: string;
  currentThinkingLevel: string;
}

export interface ModelPreferenceOption {
  id: string;
  provider: string;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function readSettingsObject(settingsFile: string): Record<string, unknown> {
  if (!existsSync(settingsFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    return { ...(parsed as Record<string, unknown>) };
  } catch {
    return {};
  }
}

function resolveModelPreference(model: string, models: ModelPreferenceOption[]): { model: string; provider: string } {
  const normalizedModel = readNonEmptyString(model);
  if (!normalizedModel) {
    return { model: '', provider: '' };
  }

  const slashIndex = normalizedModel.indexOf('/');
  if (slashIndex > 0 && slashIndex < normalizedModel.length - 1) {
    return {
      provider: normalizedModel.slice(0, slashIndex),
      model: normalizedModel.slice(slashIndex + 1),
    };
  }

  const matchedModel = models.find((candidate) => candidate.id === normalizedModel);
  return {
    model: normalizedModel,
    provider: matchedModel?.provider ?? '',
  };
}

export function readSavedModelPreferences(settingsFile: string): SavedModelPreferences {
  const parsed = readSettingsObject(settingsFile);

  return {
    currentModel: readNonEmptyString(parsed.defaultModel),
    currentThinkingLevel: readNonEmptyString(parsed.defaultThinkingLevel),
  };
}

export function writeSavedModelPreferences(
  input: {
    model?: string | null;
    thinkingLevel?: string | null;
  },
  settingsFile: string,
  models: ModelPreferenceOption[] = [],
): SavedModelPreferences {
  const settings = readSettingsObject(settingsFile);

  if (input.model !== undefined) {
    const resolved = resolveModelPreference(input.model ?? '', models);
    if (resolved.model) {
      settings.defaultModel = resolved.model;
      if (resolved.provider) {
        settings.defaultProvider = resolved.provider;
      } else {
        delete settings.defaultProvider;
      }
    } else {
      delete settings.defaultModel;
      delete settings.defaultProvider;
    }
  }

  if (input.thinkingLevel !== undefined) {
    const normalizedThinkingLevel = readNonEmptyString(input.thinkingLevel ?? '');
    if (normalizedThinkingLevel) {
      settings.defaultThinkingLevel = normalizedThinkingLevel;
    } else {
      delete settings.defaultThinkingLevel;
    }
  }

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');

  return readSavedModelPreferences(settingsFile);
}
