import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readModelPresetLibrary } from '@personal-agent/resources';

export interface SavedModelPresetTargetState {
  model: string;
  thinkingLevel: string;
}

export interface SavedModelPresetState {
  id: string;
  description: string;
  model: string;
  thinkingLevel: string;
  fallbacks: SavedModelPresetTargetState[];
  goodFor: string[];
  avoidFor: string[];
  instructionAddendum: string;
}

export interface SavedModelPresetPreferencesState {
  defaultPresetId: string;
  presets: SavedModelPresetState[];
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

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readNonEmptyString(entry))
    .filter((entry): entry is string => entry.length > 0);
}

export function readSavedModelPresetPreferences(settingsFile: string): SavedModelPresetPreferencesState {
  const settings = readSettingsObject(settingsFile);
  const library = readModelPresetLibrary(settings);

  return {
    defaultPresetId: library.defaultPresetId,
    presets: library.presets.map((preset) => ({
      id: preset.id,
      description: preset.description,
      model: preset.modelRef,
      thinkingLevel: preset.thinkingLevel,
      fallbacks: preset.fallbacks.map((fallback) => ({
        model: fallback.modelRef,
        thinkingLevel: fallback.thinkingLevel,
      })),
      goodFor: [...preset.goodFor],
      avoidFor: [...preset.avoidFor],
      instructionAddendum: preset.instructionAddendum,
    })),
  };
}

function normalizeTargetState(value: SavedModelPresetTargetState, label: string): SavedModelPresetTargetState {
  const model = readNonEmptyString(value.model);
  if (!model) {
    throw new Error(`${label} model is required.`);
  }

  return {
    model,
    thinkingLevel: readNonEmptyString(value.thinkingLevel),
  };
}

function normalizePresetState(value: SavedModelPresetState): SavedModelPresetState {
  const id = readNonEmptyString(value.id);
  if (!id) {
    throw new Error('Preset id is required.');
  }

  const model = readNonEmptyString(value.model);
  if (!model) {
    throw new Error(`Preset ${id} requires a primary model.`);
  }

  return {
    id,
    description: readNonEmptyString(value.description),
    model,
    thinkingLevel: readNonEmptyString(value.thinkingLevel),
    fallbacks: (Array.isArray(value.fallbacks) ? value.fallbacks : []).map((fallback, index) => normalizeTargetState(fallback, `Preset ${id} fallback ${index + 1}`)),
    goodFor: normalizeStringList(value.goodFor),
    avoidFor: normalizeStringList(value.avoidFor),
    instructionAddendum: readNonEmptyString(value.instructionAddendum),
  };
}

export function writeSavedModelPresetPreferences(
  input: SavedModelPresetPreferencesState,
  settingsFile: string,
): SavedModelPresetPreferencesState {
  const settings = readSettingsObject(settingsFile);
  const presets = input.presets.map(normalizePresetState);
  const presetIds = new Set<string>();

  for (const preset of presets) {
    if (presetIds.has(preset.id)) {
      throw new Error(`Duplicate preset id: ${preset.id}`);
    }
    presetIds.add(preset.id);
  }

  const defaultPresetId = readNonEmptyString(input.defaultPresetId);
  if (defaultPresetId && !presetIds.has(defaultPresetId)) {
    throw new Error(`Unknown default preset: ${defaultPresetId}`);
  }

  if (presets.length === 0) {
    delete settings.modelPresets;
    delete settings.defaultModelPreset;
  } else {
    settings.modelPresets = Object.fromEntries(presets.map((preset) => [preset.id, {
      ...(preset.description ? { description: preset.description } : {}),
      model: preset.model,
      ...(preset.thinkingLevel ? { thinkingLevel: preset.thinkingLevel } : {}),
      ...(preset.fallbacks.length > 0 ? {
        fallbacks: preset.fallbacks.map((fallback) => ({
          model: fallback.model,
          ...(fallback.thinkingLevel ? { thinkingLevel: fallback.thinkingLevel } : {}),
        })),
      } : {}),
      ...(preset.goodFor.length > 0 ? { goodFor: preset.goodFor } : {}),
      ...(preset.avoidFor.length > 0 ? { avoidFor: preset.avoidFor } : {}),
      ...(preset.instructionAddendum ? { instructionAddendum: preset.instructionAddendum } : {}),
    }]));

    if (defaultPresetId) {
      settings.defaultModelPreset = defaultPresetId;
      delete settings.defaultModel;
      delete settings.defaultProvider;
      delete settings.defaultThinkingLevel;
    } else {
      delete settings.defaultModelPreset;
    }
  }

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  return readSavedModelPresetPreferences(settingsFile);
}
