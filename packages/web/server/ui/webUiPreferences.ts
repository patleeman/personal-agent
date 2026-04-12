import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SavedNodeBrowserViewPreference {
  id: string;
  name: string;
  search: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedWebUiPreferences {
  openConversationIds: string[];
  pinnedConversationIds: string[];
  archivedConversationIds: string[];
  workspacePaths: string[];
  nodeBrowserViews: SavedNodeBrowserViewPreference[];
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

function normalizeNodeBrowserView(entry: unknown): SavedNodeBrowserViewPreference | null {
  if (!isRecord(entry)) {
    return null;
  }

  const id = readNonEmptyString(entry.id);
  const name = readNonEmptyString(entry.name);
  const search = typeof entry.search === 'string' ? entry.search.trim() : '';
  const createdAt = readNonEmptyString(entry.createdAt) || new Date().toISOString();
  const updatedAt = readNonEmptyString(entry.updatedAt) || createdAt;
  if (!id || !name) {
    return null;
  }

  return { id, name, search, createdAt, updatedAt };
}

function normalizeNodeBrowserViews(value: unknown): SavedNodeBrowserViewPreference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => normalizeNodeBrowserView(entry))
    .filter((entry): entry is SavedNodeBrowserViewPreference => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
}

function normalizeSavedWebUiPreferences(input: {
  openConversationIds?: unknown;
  pinnedConversationIds?: unknown;
  archivedConversationIds?: unknown;
  workspacePaths?: unknown;
  nodeBrowserViews?: unknown;
}): SavedWebUiPreferences {
  const pinnedConversationIds = normalizeConversationIds(input.pinnedConversationIds);
  const pinnedIdSet = new Set(pinnedConversationIds);
  const openConversationIds = normalizeConversationIds(input.openConversationIds)
    .filter((id) => !pinnedIdSet.has(id));
  const workspaceIdSet = new Set([...openConversationIds, ...pinnedConversationIds]);

  return {
    openConversationIds,
    pinnedConversationIds,
    archivedConversationIds: normalizeConversationIds(input.archivedConversationIds)
      .filter((id) => !workspaceIdSet.has(id)),
    workspacePaths: normalizeConversationIds(input.workspacePaths),
    nodeBrowserViews: normalizeNodeBrowserViews(input.nodeBrowserViews),
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
    archivedConversationIds: webUi.archivedConversationIds,
    workspacePaths: webUi.workspacePaths,
    nodeBrowserViews: webUi.nodeBrowserViews,
  });
}

export function writeSavedWebUiPreferences(
  input: {
    openConversationIds?: string[] | null;
    pinnedConversationIds?: string[] | null;
    archivedConversationIds?: string[] | null;
    workspacePaths?: string[] | null;
    nodeBrowserViews?: SavedNodeBrowserViewPreference[] | null;
  },
  settingsFile: string,
): SavedWebUiPreferences {
  const settings = readSettingsObject(settingsFile);
  const webUi = readWebUiSettings(settings);
  const current = normalizeSavedWebUiPreferences({
    openConversationIds: webUi.openConversationIds,
    pinnedConversationIds: webUi.pinnedConversationIds,
    archivedConversationIds: webUi.archivedConversationIds,
    workspacePaths: webUi.workspacePaths,
    nodeBrowserViews: webUi.nodeBrowserViews,
  });

  const next = normalizeSavedWebUiPreferences({
    openConversationIds: input.openConversationIds !== undefined ? (input.openConversationIds ?? []) : current.openConversationIds,
    pinnedConversationIds: input.pinnedConversationIds !== undefined ? (input.pinnedConversationIds ?? []) : current.pinnedConversationIds,
    archivedConversationIds: input.archivedConversationIds !== undefined ? (input.archivedConversationIds ?? []) : current.archivedConversationIds,
    workspacePaths: input.workspacePaths !== undefined ? (input.workspacePaths ?? []) : current.workspacePaths,
    nodeBrowserViews: input.nodeBrowserViews !== undefined ? (input.nodeBrowserViews ?? []) : current.nodeBrowserViews,
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

  if (next.archivedConversationIds.length > 0) {
    webUi.archivedConversationIds = next.archivedConversationIds;
  } else {
    delete webUi.archivedConversationIds;
  }

  if (next.workspacePaths.length > 0) {
    webUi.workspacePaths = next.workspacePaths;
  } else {
    delete webUi.workspacePaths;
  }

  if (next.nodeBrowserViews.length > 0) {
    webUi.nodeBrowserViews = next.nodeBrowserViews;
  } else {
    delete webUi.nodeBrowserViews;
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
