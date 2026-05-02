import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface SavedNodeBrowserViewPreference {
  id: string;
  name: string;
  search: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedUiPreferences {
  openConversationIds: string[];
  pinnedConversationIds: string[];
  archivedConversationIds: string[];
  workspacePaths: string[];
  nodeBrowserViews: SavedNodeBrowserViewPreference[];
}

const ISO_TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?Z$/;

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : '';
}

function readTimestampString(value: unknown, fallback?: string): string {
  const raw = readNonEmptyString(value);
  const match = raw ? raw.match(ISO_TIMESTAMP_PATTERN) : null;
  if (match && hasValidIsoDateParts(match)) {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return fallback ?? new Date().toISOString();
}

function hasValidIsoDateParts(match: RegExpMatchArray): boolean {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const millisecond = match[7] ? Number(match[7].slice(0, 3).padEnd(3, '0')) : 0;
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second, millisecond));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && date.getUTCHours() === hour
    && date.getUTCMinutes() === minute
    && date.getUTCSeconds() === second
    && date.getUTCMilliseconds() === millisecond;
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

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

function trimTrailingPathSeparators(path: string): string {
  if (path === '/' || /^[A-Za-z]:\/$/.test(path)) {
    return path;
  }

  return path.replace(/\/+$/, '');
}

function normalizeWorkspacePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const paths: string[] = [];
  const seen = new Set<string>();

  for (const entry of value) {
    const trimmed = readNonEmptyString(entry);
    if (!trimmed) {
      continue;
    }

    const normalized = trimTrailingPathSeparators(normalizePathSeparators(trimmed)) || normalizePathSeparators(trimmed);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    paths.push(normalized);
  }

  return paths;
}

function normalizeNodeBrowserView(entry: unknown): SavedNodeBrowserViewPreference | null {
  if (!isRecord(entry)) {
    return null;
  }

  const id = readNonEmptyString(entry.id);
  const name = readNonEmptyString(entry.name);
  const search = typeof entry.search === 'string' ? entry.search.trim() : '';
  const createdAt = readTimestampString(entry.createdAt);
  const updatedAt = readTimestampString(entry.updatedAt, createdAt);
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

function normalizeSavedUiPreferences(input: {
  openConversationIds?: unknown;
  pinnedConversationIds?: unknown;
  archivedConversationIds?: unknown;
  workspacePaths?: unknown;
  nodeBrowserViews?: unknown;
}): SavedUiPreferences {
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
    workspacePaths: normalizeWorkspacePaths(input.workspacePaths),
    nodeBrowserViews: normalizeNodeBrowserViews(input.nodeBrowserViews),
  };
}

function readUiSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return isRecord(settings.ui) ? { ...settings.ui } : {};
}

export function readSavedUiPreferences(settingsFile: string): SavedUiPreferences {
  const settings = readSettingsObject(settingsFile);
  const ui = readUiSettings(settings);

  return normalizeSavedUiPreferences({
    openConversationIds: ui.openConversationIds,
    pinnedConversationIds: ui.pinnedConversationIds,
    archivedConversationIds: ui.archivedConversationIds,
    workspacePaths: ui.workspacePaths,
    nodeBrowserViews: ui.nodeBrowserViews,
  });
}

export function writeSavedUiPreferences(
  input: {
    openConversationIds?: string[] | null;
    pinnedConversationIds?: string[] | null;
    archivedConversationIds?: string[] | null;
    workspacePaths?: string[] | null;
    nodeBrowserViews?: SavedNodeBrowserViewPreference[] | null;
  },
  settingsFile: string,
): SavedUiPreferences {
  const settings = readSettingsObject(settingsFile);
  const ui = readUiSettings(settings);
  const current = normalizeSavedUiPreferences({
    openConversationIds: ui.openConversationIds,
    pinnedConversationIds: ui.pinnedConversationIds,
    archivedConversationIds: ui.archivedConversationIds,
    workspacePaths: ui.workspacePaths,
    nodeBrowserViews: ui.nodeBrowserViews,
  });

  const next = normalizeSavedUiPreferences({
    openConversationIds: input.openConversationIds !== undefined ? (input.openConversationIds ?? []) : current.openConversationIds,
    pinnedConversationIds: input.pinnedConversationIds !== undefined ? (input.pinnedConversationIds ?? []) : current.pinnedConversationIds,
    archivedConversationIds: input.archivedConversationIds !== undefined ? (input.archivedConversationIds ?? []) : current.archivedConversationIds,
    workspacePaths: input.workspacePaths !== undefined ? (input.workspacePaths ?? []) : current.workspacePaths,
    nodeBrowserViews: input.nodeBrowserViews !== undefined ? (input.nodeBrowserViews ?? []) : current.nodeBrowserViews,
  });

  if (next.openConversationIds.length > 0) {
    ui.openConversationIds = next.openConversationIds;
  } else {
    delete ui.openConversationIds;
  }

  if (next.pinnedConversationIds.length > 0) {
    ui.pinnedConversationIds = next.pinnedConversationIds;
  } else {
    delete ui.pinnedConversationIds;
  }

  if (next.archivedConversationIds.length > 0) {
    ui.archivedConversationIds = next.archivedConversationIds;
  } else {
    delete ui.archivedConversationIds;
  }

  if (next.workspacePaths.length > 0) {
    ui.workspacePaths = next.workspacePaths;
  } else {
    delete ui.workspacePaths;
  }

  if (next.nodeBrowserViews.length > 0) {
    ui.nodeBrowserViews = next.nodeBrowserViews;
  } else {
    delete ui.nodeBrowserViews;
  }

  if (Object.keys(ui).length > 0) {
    settings.ui = ui;
  } else {
    delete settings.ui;
  }

  mkdirSync(dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');

  return readSavedUiPreferences(settingsFile);
}
