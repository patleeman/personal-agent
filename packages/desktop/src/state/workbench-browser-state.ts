import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
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

let cachedState: { file: string; state: StoredWorkbenchBrowserState } | null = null;
let pendingWriteTimer: ReturnType<typeof setTimeout> | null = null;
let pendingWrite: { file: string; state: StoredWorkbenchBrowserState } | null = null;
let pendingWritePromise: Promise<void> | null = null;

function readState(): StoredWorkbenchBrowserState {
  const stateFile = resolveStateFile();
  if (cachedState?.file === stateFile) {
    return cachedState.state;
  }

  if (!existsSync(stateFile)) {
    const state = { version: 1, entries: [] } satisfies StoredWorkbenchBrowserState;
    cachedState = { file: stateFile, state };
    return state;
  }

  try {
    const state = normalizeState(JSON.parse(readFileSync(stateFile, 'utf-8')) as unknown);
    cachedState = { file: stateFile, state };
    return state;
  } catch {
    const state = { version: 1, entries: [] } satisfies StoredWorkbenchBrowserState;
    cachedState = { file: stateFile, state };
    return state;
  }
}

function writePendingStateNow(): Promise<void> {
  const pending = pendingWrite;
  pendingWrite = null;
  if (!pending) {
    return pendingWritePromise ?? Promise.resolve();
  }

  mkdirSync(resolveDesktopRuntimePaths().desktopStateDir, { recursive: true, mode: 0o700 });
  pendingWritePromise = writeFile(pending.file, `${JSON.stringify(pending.state, null, 2)}\n`, 'utf-8')
    .catch(() => {
      // Browser URL persistence is best-effort.
    })
    .finally(() => {
      pendingWritePromise = null;
    });
  return pendingWritePromise;
}

function scheduleWriteState(state: StoredWorkbenchBrowserState): void {
  const stateFile = resolveStateFile();
  const normalized = normalizeState(state);
  cachedState = { file: stateFile, state: normalized };
  pendingWrite = { file: stateFile, state: normalized };

  if (pendingWriteTimer) {
    clearTimeout(pendingWriteTimer);
  }

  pendingWriteTimer = setTimeout(() => {
    pendingWriteTimer = null;
    void writePendingStateNow();
  }, 500);
}

export function flushStoredWorkbenchBrowserState(): Promise<void> {
  if (pendingWriteTimer) {
    clearTimeout(pendingWriteTimer);
    pendingWriteTimer = null;
  }

  return writePendingStateNow();
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
  scheduleWriteState({ version: 1, entries });
}
