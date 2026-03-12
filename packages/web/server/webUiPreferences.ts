import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SavedWebUiPreferences {
  openConversationIds: string[];
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readSettingsObject(settingsFile: string): Record<string, unknown> {
  if (!existsSync(settingsFile)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsFile, 'utf-8')) as unknown;
    return isRecord(parsed) ? { ...parsed } : {};
  } catch {
    return {};
  }
}

function normalizeOpenConversationIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    const normalized = readNonEmptyString(entry);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ids.push(normalized);
  }

  return ids;
}

function readWebUiSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return isRecord(settings.webUi) ? { ...settings.webUi } : {};
}

export function readSavedWebUiPreferences(settingsFile: string): SavedWebUiPreferences {
  const settings = readSettingsObject(settingsFile);
  const webUi = readWebUiSettings(settings);

  return {
    openConversationIds: normalizeOpenConversationIds(webUi.openConversationIds),
  };
}

export function writeSavedWebUiPreferences(
  input: { openConversationIds?: string[] | null },
  settingsFile: string,
): SavedWebUiPreferences {
  const settings = readSettingsObject(settingsFile);
  const webUi = readWebUiSettings(settings);

  if (input.openConversationIds !== undefined) {
    const normalizedIds = normalizeOpenConversationIds(input.openConversationIds ?? []);
    if (normalizedIds.length > 0) {
      webUi.openConversationIds = normalizedIds;
    } else {
      delete webUi.openConversationIds;
    }
  }

  if (Object.keys(webUi).length > 0) {
    settings.webUi = webUi;
  } else {
    delete settings.webUi;
  }

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');

  return readSavedWebUiPreferences(settingsFile);
}
