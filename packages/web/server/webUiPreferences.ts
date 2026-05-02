import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SavedWebUiPreferences {
  openConversationIds: string[];
  pinnedConversationIds: string[];
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

function normalizeConversationIds(value: unknown): string[] {
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

function normalizeSavedWebUiPreferences(input: {
  openConversationIds?: unknown;
  pinnedConversationIds?: unknown;
}): SavedWebUiPreferences {
  const pinnedConversationIds = normalizeConversationIds(input.pinnedConversationIds);
  const pinnedIdSet = new Set(pinnedConversationIds);

  return {
    openConversationIds: normalizeConversationIds(input.openConversationIds).filter((id) => !pinnedIdSet.has(id)),
    pinnedConversationIds,
  };
}

function readWebUiSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return isRecord(settings.webUi) ? { ...settings.webUi } : {};
}

export function readSavedWebUiPreferences(settingsFile: string): SavedWebUiPreferences {
  const settings = readSettingsObject(settingsFile);
  const webUi = readWebUiSettings(settings);

  return normalizeSavedWebUiPreferences({
    openConversationIds: webUi.openConversationIds,
    pinnedConversationIds: webUi.pinnedConversationIds,
  });
}

export function writeSavedWebUiPreferences(
  input: { openConversationIds?: string[] | null; pinnedConversationIds?: string[] | null },
  settingsFile: string,
): SavedWebUiPreferences {
  const settings = readSettingsObject(settingsFile);
  const webUi = readWebUiSettings(settings);
  const current = normalizeSavedWebUiPreferences({
    openConversationIds: webUi.openConversationIds,
    pinnedConversationIds: webUi.pinnedConversationIds,
  });

  const next = normalizeSavedWebUiPreferences({
    openConversationIds: input.openConversationIds !== undefined ? (input.openConversationIds ?? []) : current.openConversationIds,
    pinnedConversationIds: input.pinnedConversationIds !== undefined ? (input.pinnedConversationIds ?? []) : current.pinnedConversationIds,
  });

  if (next.openConversationIds.length > 0) {
    webUi.openConversationIds = next.openConversationIds;
  } else {
    delete webUi.openConversationIds;
  }

  if (next.pinnedConversationIds.length > 0) {
    webUi.pinnedConversationIds = next.pinnedConversationIds;
  } else {
    delete webUi.pinnedConversationIds;
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
