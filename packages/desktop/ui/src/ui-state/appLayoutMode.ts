export const APP_LAYOUT_MODE_STORAGE_KEY = 'pa:app-layout-mode';
export const APP_LAYOUT_MODE_CHANGED_EVENT = 'pa:app-layout-mode-changed';

export type AppLayoutMode = 'compact' | 'workbench';

function isAppLayoutMode(value: unknown): value is AppLayoutMode {
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

  if (typeof window !== 'undefined') {
    window.dispatchEvent(createAppLayoutModeChangedEvent(mode));
  }
}

export function createAppLayoutModeChangedEvent(mode: AppLayoutMode): CustomEvent<{ mode: AppLayoutMode }> {
  return new CustomEvent(APP_LAYOUT_MODE_CHANGED_EVENT, { detail: { mode } });
}
