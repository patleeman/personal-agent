import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SavedModelPreferences {
  currentModel: string;
  currentThinkingLevel: string;
  currentPresetId: string;
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

  const exactMatch = models.find((candidate) => candidate.id === normalizedModel);
  if (exactMatch) {
    return {
      model: exactMatch.id,
      provider: exactMatch.provider,
    };
  }

  const slashIndex = normalizedModel.indexOf('/');
  if (slashIndex > 0 && slashIndex < normalizedModel.length - 1) {
    return {
      provider: normalizedModel.slice(0, slashIndex),
      model: normalizedModel.slice(slashIndex + 1),
    };
  }

  return {
    model: normalizedModel,
    provider: '',
  };
}

function normalizeSettingsDefaultModelProvider(settings: Record<string, unknown>, models: ModelPreferenceOption[]): boolean {
  const defaultModel = readNonEmptyString(settings.defaultModel);
  if (!defaultModel || models.length === 0) {
    return false;
  }

  const slashIndex = defaultModel.indexOf('/');
  if (slashIndex > 0 && slashIndex < defaultModel.length - 1) {
    const provider = defaultModel.slice(0, slashIndex);
    const model = defaultModel.slice(slashIndex + 1);
    const changed = settings.defaultProvider !== provider || settings.defaultModel !== model;
    settings.defaultProvider = provider;
    settings.defaultModel = model;
    return changed;
  }

  const storedProvider = readNonEmptyString(settings.defaultProvider);
  const exactMatches = models.filter((candidate) => candidate.id === defaultModel);
  if (exactMatches.length === 0) {
    return false;
  }

  if (storedProvider && exactMatches.some((candidate) => candidate.provider === storedProvider)) {
    return false;
  }

  if (exactMatches.length !== 1) {
    return false;
  }

  const nextProvider = exactMatches[0]!.provider;
  if (!nextProvider || storedProvider === nextProvider) {
    return false;
  }

  settings.defaultProvider = nextProvider;
  return true;
}

export function normalizeSavedModelPreferences(settingsFile: string, models: ModelPreferenceOption[] = []): SavedModelPreferences {
  const settings = readSettingsObject(settingsFile);
  const changed = normalizeSettingsDefaultModelProvider(settings, models);
  if (changed) {
    mkdirSync(dirname(settingsFile), { recursive: true });
    writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  }

  return readSavedModelPreferences(settingsFile, models);
}

export function readSavedModelPreferences(settingsFile: string, models: ModelPreferenceOption[] = []): SavedModelPreferences {
  const parsed = readSettingsObject(settingsFile);
  const defaultModel = readNonEmptyString(parsed.defaultModel);
  const defaultThinkingLevel = readNonEmptyString(parsed.defaultThinkingLevel);

  const resolved = resolveModelPreference(defaultModel, models);
  return {
    currentModel: resolved.model,
    currentThinkingLevel: defaultThinkingLevel,
    currentPresetId: '',
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
    const modelValue = input.model ?? '';
    const normalizedModel = readNonEmptyString(modelValue);

    if (!normalizedModel) {
      delete settings.defaultModel;
      delete settings.defaultProvider;
      delete settings.defaultModelPreset;
    } else {
      delete settings.defaultModelPreset;
      const resolved = resolveModelPreference(normalizedModel, models);
      settings.defaultModel = resolved.model;
      if (resolved.provider) {
        settings.defaultProvider = resolved.provider;
      } else {
        delete settings.defaultProvider;
      }
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

  return readSavedModelPreferences(settingsFile, models);
}
