export const RESIZE_HANDLE_WIDTH = 5;
export const RAIL_WIDTH_STORAGE_KEY_PREFIX = 'pa:rail-width:';

export function buildRailWidthStorageKey(pageKey: string): string {
  return `${RAIL_WIDTH_STORAGE_KEY_PREFIX}${pageKey}`;
}

export function isRailWidthStorageKey(key: string): boolean {
  return key.startsWith(RAIL_WIDTH_STORAGE_KEY_PREFIX);
}

export function getRailPageKey(pathname: string): string {
  const parts = pathname.split('/').filter(Boolean);
  const section = parts[0] ?? 'default';

  switch (section) {
    case 'workspace':
      if (parts[1] === 'changes') {
        return 'workspace-changes';
      }
      if (parts[1] === 'files') {
        return 'workspace-files';
      }
      return 'workspace';
    case 'scheduled':
    case 'runs':
    case 'conversations':
    case 'inbox':
    case 'system':
    case 'skills':
    case 'nodes':
    case 'pages':
    case 'instructions':
    case 'tools':
    case 'settings':
    case 'memory':
    case 'knowledge':
    case 'capabilities':
      return section === 'pages' ? 'nodes' : section;
    case 'notes':
    case 'memories':
      return 'notes';
    case 'automations':
    case 'tasks':
      return 'scheduled';
    default:
      return 'default';
  }
}

export interface RailLayoutPrefs {
  storageKey: string;
  initialWidth?: number;
  initialMainWidthRatio?: number;
}

export function clampPanelWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) {
    return min;
  }

  return Math.max(min, Math.min(max, width));
}

export function getRailLayoutPrefs(pathname: string): RailLayoutPrefs {
  const pageKey = getRailPageKey(pathname);

  switch (pageKey) {
    case 'scheduled':
      return {
        storageKey: buildRailWidthStorageKey(pageKey),
        initialWidth: 380,
      };
    case 'runs':
    case 'capabilities':
      return {
        storageKey: buildRailWidthStorageKey(pageKey),
        initialWidth: 420,
      };
    case 'conversations':
    case 'inbox':
    case 'memory':
    case 'knowledge':
    case 'workspace':
    case 'workspace-files':
    case 'workspace-changes':
    case 'system':
    case 'settings':
    case 'default':
      return {
        storageKey: buildRailWidthStorageKey(pageKey),
        initialWidth: 380,
      };
    case 'notes':
    case 'nodes':
    case 'tools':
      return {
        storageKey: buildRailWidthStorageKey(pageKey),
        initialMainWidthRatio: 0.7,
      };
    case 'skills':
    case 'instructions':
      return {
        storageKey: buildRailWidthStorageKey(pageKey),
        initialWidth: 460,
      };
    default:
      return {
        storageKey: buildRailWidthStorageKey(pageKey),
        initialWidth: 380,
      };
  }
}

export function getMainViewportWidth(input: {
  viewportWidth: number;
  sidebarWidth: number;
  resizeHandleWidth?: number;
}): number {
  const resizeHandleWidth = input.resizeHandleWidth ?? RESIZE_HANDLE_WIDTH;
  return Math.max(0, input.viewportWidth - input.sidebarWidth - (resizeHandleWidth * 2));
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
  const initialWidth = prefs.initialMainWidthRatio === undefined
    ? (prefs.initialWidth ?? input.railMinWidth)
    : Math.floor(getMainViewportWidth(input) * prefs.initialMainWidthRatio);

  return clampPanelWidth(initialWidth, input.railMinWidth, input.railMaxWidth);
}

export function getArtifactRailTargetWidth(input: {
  viewportWidth: number;
  sidebarWidth: number;
  resizeHandleWidth?: number;
}): number {
  return Math.floor(getMainViewportWidth(input) / 2);
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
