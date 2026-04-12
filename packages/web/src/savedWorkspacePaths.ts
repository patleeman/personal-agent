import { SAVED_WORKSPACE_PATHS_STORAGE_KEY } from './localSettings';

export function normalizeWorkspacePaths(values: Iterable<unknown>): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    paths.push(normalized);
  }

  return paths;
}

export function readStoredWorkspacePaths(): string[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? normalizeWorkspacePaths(parsed) : [];
  } catch {
    return [];
  }
}

export function writeStoredWorkspacePaths(workspacePaths: readonly string[]): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    if (workspacePaths.length > 0) {
      localStorage.setItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY, JSON.stringify(workspacePaths));
      return;
    }

    localStorage.removeItem(SAVED_WORKSPACE_PATHS_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
