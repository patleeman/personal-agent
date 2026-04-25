export const APP_LAYOUT_MODE_STORAGE_KEY = 'pa:app-layout-mode';

export type AppLayoutMode = 'compact' | 'workbench';

export function isAppLayoutMode(value: unknown): value is AppLayoutMode {
  return value === 'compact' || value === 'workbench';
}

export function readAppLayoutMode(): AppLayoutMode {
  try {
    const stored = localStorage.getItem(APP_LAYOUT_MODE_STORAGE_KEY);
    return isAppLayoutMode(stored) ? stored : 'compact';
  } catch {
    return 'compact';
  }
}

export function writeAppLayoutMode(mode: AppLayoutMode): void {
  try {
    localStorage.setItem(APP_LAYOUT_MODE_STORAGE_KEY, mode);
  } catch {
    // Ignore storage failures; the in-memory selection still applies.
  }
}
