import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveDesktopRuntimePaths } from '../desktop-env.js';

const MAX_BROWSER_STATE_ENTRIES = 200;
const MAX_SESSION_KEY_LENGTH = 180;

interface StoredWorkbenchBrowserEntry {
  sessionKey: string;
  url: string;
  updatedAt: string;
}

interface StoredWorkbenchBrowserState {
  version: 1;
  entries: StoredWorkbenchBrowserEntry[];
}

function resolveStateFile(): string {
  return join(resolveDesktopRuntimePaths().desktopStateDir, 'workbench-browser-state.json');
}

function normalizeSessionKey(value: string | null | undefined): string {
  const normalized = value?.trim() || 'default';
  return normalized.slice(0, MAX_SESSION_KEY_LENGTH);
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function normalizeEntry(value: unknown): StoredWorkbenchBrowserEntry | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Record<string, unknown>;
  const sessionKey = typeof candidate.sessionKey === 'string' ? normalizeSessionKey(candidate.sessionKey) : '';
  const url = normalizeHttpUrl(candidate.url);
  const updatedAt =
    typeof candidate.updatedAt === 'string' && !Number.isNaN(Date.parse(candidate.updatedAt))
      ? new Date(Date.parse(candidate.updatedAt)).toISOString()
      : new Date(0).toISOString();
  if (!sessionKey || !url) {
    return null;
  }

  return { sessionKey, url, updatedAt };
}

function normalizeState(value: unknown): StoredWorkbenchBrowserState {
  if (!value || typeof value !== 'object') {
    return { version: 1, entries: [] };
  }

  const candidate = value as Record<string, unknown>;
  const seen = new Set<string>();
  const entries = Array.isArray(candidate.entries)
    ? candidate.entries
        .map((entry) => normalizeEntry(entry))
        .filter((entry): entry is StoredWorkbenchBrowserEntry => entry !== null)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .filter((entry) => {
          if (seen.has(entry.sessionKey)) {
            return false;
          }
          seen.add(entry.sessionKey);
          return true;
        })
        .slice(0, MAX_BROWSER_STATE_ENTRIES)
    : [];
  return { version: 1, entries };
}

function readState(): StoredWorkbenchBrowserState {
  const stateFile = resolveStateFile();
  if (!existsSync(stateFile)) {
    return { version: 1, entries: [] };
  }

  try {
    return normalizeState(JSON.parse(readFileSync(stateFile, 'utf-8')) as unknown);
  } catch {
    return { version: 1, entries: [] };
  }
}

function writeState(state: StoredWorkbenchBrowserState): void {
  const stateFile = resolveStateFile();
  mkdirSync(resolveDesktopRuntimePaths().desktopStateDir, { recursive: true, mode: 0o700 });
  writeFileSync(stateFile, `${JSON.stringify(normalizeState(state), null, 2)}\n`, 'utf-8');
}

export function readStoredWorkbenchBrowserUrl(sessionKey?: string | null): string | null {
  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  return readState().entries.find((entry) => entry.sessionKey === normalizedSessionKey)?.url ?? null;
}

export function writeStoredWorkbenchBrowserUrl(sessionKey: string | null | undefined, url: string): void {
  const normalizedUrl = normalizeHttpUrl(url);
  if (!normalizedUrl) {
    return;
  }

  const normalizedSessionKey = normalizeSessionKey(sessionKey);
  const state = readState();
  const entries = [
    { sessionKey: normalizedSessionKey, url: normalizedUrl, updatedAt: new Date().toISOString() },
    ...state.entries.filter((entry) => entry.sessionKey !== normalizedSessionKey),
  ].slice(0, MAX_BROWSER_STATE_ENTRIES);
  writeState({ version: 1, entries });
}
