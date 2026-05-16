import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { DictationSettings } from './types.js';

const DEFAULT_MODEL = 'base.en';

export interface DictationSettingsState {
  settingsFile: string;
  settings: DictationSettings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeDictationSettings(value: unknown): DictationSettings {
  const input = isRecord(value) ? value : {};
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : false;
  const model = typeof input.model === 'string' && input.model.trim().length > 0 ? input.model.trim() : DEFAULT_MODEL;
  return { enabled, model };
}

function readSettingsRoot(settingsFile: string): Record<string, unknown> {
  if (!existsSync(settingsFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf8')) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readDictationSettings(settingsFile: string): DictationSettings {
  const root = readSettingsRoot(settingsFile);
  return normalizeDictationSettings(root.dictation);
}

export function writeDictationSettings(settingsFile: string, update: Partial<DictationSettings>): DictationSettings {
  const currentRoot = readSettingsRoot(settingsFile);
  const current = normalizeDictationSettings(currentRoot.dictation);

  const next = normalizeDictationSettings({
    ...current,
    ...update,
  });

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(
    settingsFile,
    JSON.stringify(
      {
        ...currentRoot,
        dictation: next,
      },
      null,
      2,
    ),
  );

  return next;
}

export function buildDictationSettingsState(settingsFile: string): DictationSettingsState {
  return {
    settingsFile,
    settings: readDictationSettings(settingsFile),
  };
}
