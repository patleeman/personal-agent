const RESIZE_HANDLE_WIDTH = 5;
const RAIL_WIDTH_STORAGE_KEY_PREFIX = 'pa:rail-width:';

function buildRailWidthStorageKey(pageKey: string): string {
  return `${RAIL_WIDTH_STORAGE_KEY_PREFIX}${pageKey}`;
}

export function isRailWidthStorageKey(key: string): boolean {
  return key.startsWith(RAIL_WIDTH_STORAGE_KEY_PREFIX);
}

function getRailPageKey(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const section = parts[0] ?? 'default';

  switch (section) {
    case 'conversations':
    case 'settings':
    case 'knowledge':
    case 'automations':
      return section;
    default:
      return 'default';
  }
}

interface RailLayoutPrefs {
  storageKey: string;
  initialWidth?: number;
  initialMainWidthRatio?: number;
}

export function clampPanelWidth(width: number, min: number, max: number): number {
  if (!Number.isSafeInteger(width)) {
    return min;
  }

  return Math.max(min, Math.min(max, width));
}

export function getRailLayoutPrefs(pathname: string): RailLayoutPrefs {
  const pageKey = getRailPageKey(pathname);

  switch (pageKey) {
    case 'automations':
      return {
        storageKey: buildRailWidthStorageKey(pageKey),
        initialWidth: 380,
      };
    case 'conversations':
    case 'knowledge':
    case 'settings':
    case 'default':
      return {
        storageKey: buildRailWidthStorageKey(pageKey),
        initialWidth: 380,
      };
    default:
      return {
        storageKey: buildRailWidthStorageKey(pageKey),
        initialWidth: 380,
      };
  }
}

function getMainViewportWidth(input: { viewportWidth: number; sidebarWidth: number; resizeHandleWidth?: number }): number {
  const resizeHandleWidth = input.resizeHandleWidth ?? RESIZE_HANDLE_WIDTH;
  if (![input.viewportWidth, input.sidebarWidth, resizeHandleWidth].every(Number.isSafeInteger)) {
    return 0;
  }

  return Math.max(0, input.viewportWidth - input.sidebarWidth - resizeHandleWidth * 2);
}

export function getRailInitialWidth(input: {
  pathname: string;
  viewportWidth: number;
  sidebarWidth: number;
  railMinWidth: number;
  railMaxWidth: number;
  resizeHandleWidth?: number;
}): number {
  const prefs = getRailLayoutPrefs(input.pathname);
  const initialWidth =
    prefs.initialMainWidthRatio === undefined
      ? (prefs.initialWidth ?? input.railMinWidth)
      : Math.floor(getMainViewportWidth(input) * prefs.initialMainWidthRatio);

  return clampPanelWidth(initialWidth, input.railMinWidth, input.railMaxWidth);
}

export function getRailMaxWidth(input: {
  viewportWidth: number;
  sidebarWidth: number;
  railMinWidth: number;
  mainMinWidth?: number;
  resizeHandleWidth?: number;
}): number {
  const mainMinWidth = input.mainMinWidth ?? 320;
  const mainViewportWidth = getMainViewportWidth(input);
  const remainingWidthAfterMainMinimum = mainViewportWidth - mainMinWidth;

  return Math.max(input.railMinWidth, remainingWidthAfterMainMinimum);
}
